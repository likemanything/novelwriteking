/**
 * 登录与会话：手机号 + 短信验证码。
 *
 * - 注册与登录是同一个流程：验证码正确且手机号已注册 → 登录；未注册 → 按注册规则建号；
 * - 邀请制：新用户需要内测邀请码，或一条有效的团队邀请链接；ADMIN_PHONES 里的号码例外；
 * - 会话令牌放在 HttpOnly Cookie 里，数据库只存摘要；30 天有效，活跃使用会自动续期。
 */
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { MeResponse, OrgSummary } from '@/shared/api';
import type { OrgRole, ProjectRole } from '@/shared/permissions';
import { config } from './config.ts';
import { sql, withTenant, type Tx } from './db/pool.ts';
import { clientIp, readJson, requireUser, type AppEnv, type Ctx, type SessionUser } from './http.ts';
import { hmac, otpCode, randomToken, safeEqual, sha256 } from './lib/crypto.ts';
import { badRequest, forbidden, HttpError } from './lib/errors.ts';
import { maskPhone, normalizePhone } from './lib/phone.ts';
import { limit } from './lib/ratelimit.ts';
import { sendOtp } from './lib/sms.ts';

const COOKIE = 'inkloom_sid';
const SESSION_DAYS = 30;
const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;

// ─────────────────────────── 会话中间件 ───────────────────────────

export async function sessionMiddleware(c: Ctx, next: () => Promise<void>) {
  c.set('user', null);
  c.set('sessionHash', null);
  const token = getCookie(c, COOKIE);
  if (token && token.length < 200) {
    const hash = sha256(token);
    const [row] = await sql<{ id: string; phone: string; name: string; platform_admin: boolean; expires_at: Date }[]>`
      select u.id, u.phone, u.name, u.platform_admin, s.expires_at
      from sessions s join users u on u.id = s.user_id
      where s.token_hash = ${hash} and s.expires_at > now() and not u.disabled`;
    if (row) {
      c.set('user', { id: row.id, phone: row.phone, name: row.name, platformAdmin: row.platform_admin });
      c.set('sessionHash', hash);
      // 剩余不到一半有效期时续期
      if (row.expires_at.getTime() - Date.now() < (SESSION_DAYS / 2) * 86400_000) {
        const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
        await sql`update sessions set expires_at = ${expires} where token_hash = ${hash}`;
        writeCookie(c, token, expires);
      }
    }
  }
  await next();
}

function writeCookie(c: Ctx, token: string, expires: Date) {
  setCookie(c, COOKIE, token, { httpOnly: true, secure: config.secureCookies, sameSite: 'Lax', path: '/', expires });
}

async function createSession(c: Ctx, userId: string) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await sql`insert into sessions (token_hash, user_id, expires_at, ip, user_agent)
    values (${sha256(token)}, ${userId}, ${expires}, ${clientIp(c)}, ${(c.req.header('user-agent') ?? '').slice(0, 300)})`;
  await sql`update users set last_login_at = now() where id = ${userId}`;
  // 顺手清理这个用户已过期的会话
  await sql`delete from sessions where user_id = ${userId} and expires_at < now()`;
  writeCookie(c, token, expires);
}

// ─────────────────────────── 当前用户信息 ───────────────────────────

export async function loadMe(user: SessionUser): Promise<MeResponse> {
  const rows = await sql<{ id: string; name: string; kind: 'personal' | 'team'; role: OrgRole }[]>`
    select o.id, o.name, o.kind, m.role from members m join orgs o on o.id = m.org_id
    where m.user_id = ${user.id} order by (o.kind = 'personal') desc, m.joined_at`;
  const orgs: OrgSummary[] = [];
  for (const r of rows) {
    const o: OrgSummary = { id: r.id, name: r.name, kind: r.kind, role: r.role };
    if (r.role === 'guest') {
      o.grants = (
        await withTenant(r.id, (tx) => tx<{ project_id: string; role: ProjectRole }[]>`select project_id, role from project_grants where user_id = ${user.id}`)
      ).map((g) => ({ projectId: g.project_id, role: g.role }));
    }
    orgs.push(o);
  }
  return { user: { id: user.id, phone: maskPhone(user.phone), name: user.name, platformAdmin: user.platformAdmin }, orgs, signupMode: config.signupMode };
}

// ─────────────────────────── 邀请 ───────────────────────────

export interface InvitationRow {
  id: string;
  org_id: string;
  role: OrgRole;
  project_ids: string[];
  grant_role: ProjectRole | null;
  expires_at: Date;
  max_uses: number;
  used_count: number;
  revoked: boolean;
}

export function invitationProblem(inv: InvitationRow | undefined): string | null {
  if (!inv) return '邀请链接无效';
  if (inv.revoked) return '这条邀请已被撤销';
  if (inv.expires_at.getTime() < Date.now()) return '这条邀请已过期';
  if (inv.used_count >= inv.max_uses) return '这条邀请的使用次数已满';
  return null;
}

export async function findInvitation(db: typeof sql | Tx, token: string, forUpdate = false): Promise<InvitationRow | undefined> {
  if (!token || token.length > 200) return undefined;
  const hash = sha256(token);
  const rows = forUpdate
    ? await db<InvitationRow[]>`select * from invitations where token_hash = ${hash} for update`
    : await db<InvitationRow[]>`select * from invitations where token_hash = ${hash}`;
  return rows[0];
}

/** 接受邀请（在事务里调用）：加入团队；外部协作者同时写入作品授权。 */
export async function acceptInvitation(tx: Tx, inv: InvitationRow, userId: string): Promise<'joined' | 'already'> {
  const [existing] = await tx<{ role: OrgRole }[]>`select role from members where org_id = ${inv.org_id} and user_id = ${userId}`;
  if (existing && existing.role !== 'guest') return 'already';
  if (!existing) await tx`insert into members (org_id, user_id, role) values (${inv.org_id}, ${userId}, ${inv.role})`;
  else if (inv.role !== 'guest') await tx`update members set role = ${inv.role} where org_id = ${inv.org_id} and user_id = ${userId}`;
  if (inv.role === 'guest' && inv.project_ids.length) {
    await tx`select set_config('app.org_id', ${inv.org_id}, true)`;
    for (const pid of inv.project_ids) {
      await tx`insert into project_grants (org_id, project_id, user_id, role) values (${inv.org_id}, ${pid}, ${userId}, ${inv.grant_role ?? 'viewer'})
        on conflict (org_id, project_id, user_id) do update set role = excluded.role`;
    }
  }
  await tx`update invitations set used_count = used_count + 1 where id = ${inv.id}`;
  await tx`select set_config('app.org_id', ${inv.org_id}, true)`;
  await tx`insert into audit_logs (org_id, user_id, action, target, detail) values (${inv.org_id}, ${userId}, 'member.join', ${userId}, ${tx.json({ role: inv.role, invitation: inv.id })})`;
  return existing ? 'already' : 'joined';
}

// ─────────────────────────── 路由 ───────────────────────────

export const authRoutes = new Hono<AppEnv>();

authRoutes.post('/otp', async (c) => {
  const body = await readJson<{ phone?: string }>(c);
  const phone = normalizePhone(body.phone);
  const ip = clientIp(c);
  limit(`otp:ip:${ip}`, 30, 3600_000, '这个网络发送验证码太频繁，请一小时后再试');
  limit(`otp:day:${phone}`, 10, 86400_000, '这个手机号今天发送验证码的次数已达上限');
  const [prev] = await sql<{ sent_at: Date }[]>`select sent_at from otp_codes where phone = ${phone}`;
  if (prev && Date.now() - prev.sent_at.getTime() < 60_000) {
    const wait = Math.ceil((60_000 - (Date.now() - prev.sent_at.getTime())) / 1000);
    throw new HttpError(429, 'otp_cooldown', `请 ${wait} 秒后再重新发送`, { retryAfter: wait });
  }
  const code = otpCode();
  await sql`insert into otp_codes (phone, code_hash, expires_at, attempts, sent_at)
    values (${phone}, ${hmac(`${phone}:${code}`)}, ${new Date(Date.now() + OTP_TTL_MS)}, 0, now())
    on conflict (phone) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, sent_at = now()`;
  try {
    await sendOtp(phone, code);
  } catch (error) {
    await sql`delete from otp_codes where phone = ${phone}`;
    console.error('[短信] 发送失败', error);
    throw new HttpError(502, 'sms_failed', '验证码发送失败，请稍后重试');
  }
  // 开发环境直接把验证码返回给页面，方便测试；生产环境禁止（见 assertConfig）
  const devCode = !config.production && config.smsProvider === 'console' ? code : undefined;
  return c.json({ ok: true, devCode });
});

authRoutes.post('/verify', async (c) => {
  const body = await readJson<{ phone?: string; code?: string; signupCode?: string; invitation?: string; name?: string }>(c);
  const phone = normalizePhone(body.phone);
  const code = String(body.code ?? '').trim();
  if (!/^\d{6}$/.test(code)) throw badRequest('请输入 6 位验证码', 'invalid_code');
  limit(`verify:ip:${clientIp(c)}`, 60, 3600_000);

  const [otp] = await sql<{ code_hash: string; expires_at: Date; attempts: number }[]>`select code_hash, expires_at, attempts from otp_codes where phone = ${phone}`;
  if (!otp || otp.expires_at.getTime() < Date.now()) throw badRequest('验证码已过期，请重新获取', 'code_expired');
  if (otp.attempts >= OTP_MAX_ATTEMPTS) throw badRequest('验证码错误次数过多，请重新获取', 'code_locked');
  if (!safeEqual(otp.code_hash, hmac(`${phone}:${code}`))) {
    await sql`update otp_codes set attempts = attempts + 1 where phone = ${phone}`;
    throw badRequest(`验证码不正确（还可以再试 ${OTP_MAX_ATTEMPTS - otp.attempts - 1} 次）`, 'invalid_code');
  }

  const [user] = await sql<{ id: string; disabled: boolean }[]>`select id, disabled from users where phone = ${phone}`;
  let userId: string;
  if (user) {
    if (user.disabled) throw forbidden('这个账号已被停用，请联系管理员', 'disabled');
    userId = user.id;
    await sql`delete from otp_codes where phone = ${phone}`;
    // 已注册用户通过邀请链接登录时，顺便加入团队
    if (body.invitation) {
      await sql.begin(async (tx) => {
        const inv = await findInvitation(tx, body.invitation!, true);
        if (!invitationProblem(inv)) await acceptInvitation(tx, inv!, userId);
      });
    }
  } else {
    const isAdmin = config.adminPhones.some((p) => {
      try {
        return normalizePhone(p) === phone;
      } catch {
        return false;
      }
    });
    const name = String(body.name ?? '').trim().slice(0, 24) || `作者${phone.slice(-4)}`;
    userId = await sql.begin(async (tx) => {
      let invitation: InvitationRow | undefined;
      let signupCode: string | null = null;
      if (body.invitation) {
        invitation = await findInvitation(tx, body.invitation, true);
        const problem = invitationProblem(invitation);
        if (problem) throw badRequest(problem, 'invalid_invitation');
      } else if (body.signupCode) {
        const sc = String(body.signupCode).trim().toUpperCase();
        const [row] = await tx<{ code: string; max_uses: number; used_count: number; expires_at: Date | null }[]>`select * from signup_codes where code = ${sc} for update`;
        if (!row) throw badRequest('邀请码不正确', 'invalid_signup_code');
        if (row.expires_at && row.expires_at.getTime() < Date.now()) throw badRequest('邀请码已过期', 'invalid_signup_code');
        if (row.used_count >= row.max_uses) throw badRequest('邀请码已被用完', 'invalid_signup_code');
        signupCode = row.code;
      } else if (config.signupMode === 'invite' && !isAdmin) {
        throw new HttpError(403, 'need_invite', '墨织目前是邀请制内测，注册需要邀请码或团队邀请链接');
      }
      const [u] = await tx<{ id: string }[]>`insert into users (phone, name, platform_admin) values (${phone}, ${name}, ${isAdmin}) returning id`;
      const [org] = await tx<{ id: string }[]>`insert into orgs (name, kind, owner_id) values (${`${name}的个人空间`}, 'personal', ${u.id}) returning id`;
      await tx`insert into members (org_id, user_id, role) values (${org.id}, ${u.id}, 'owner')`;
      if (signupCode) await tx`update signup_codes set used_count = used_count + 1 where code = ${signupCode}`;
      if (invitation) await acceptInvitation(tx, invitation, u.id);
      await tx`delete from otp_codes where phone = ${phone}`;
      return u.id;
    });
  }
  await createSession(c, userId);
  const [u] = await sql<{ id: string; phone: string; name: string; platform_admin: boolean }[]>`select id, phone, name, platform_admin from users where id = ${userId}`;
  return c.json(await loadMe({ id: u.id, phone: u.phone, name: u.name, platformAdmin: u.platform_admin }));
});

authRoutes.post('/logout', async (c) => {
  const hash = c.get('sessionHash');
  if (hash) await sql`delete from sessions where token_hash = ${hash}`;
  deleteCookie(c, COOKIE, { path: '/' });
  return c.json({ ok: true });
});

export const meRoutes = new Hono<AppEnv>();

meRoutes.get('/', async (c) => c.json(await loadMe(requireUser(c))));

meRoutes.patch('/', async (c) => {
  const user = requireUser(c);
  const body = await readJson<{ name?: string }>(c);
  const name = String(body.name ?? '').trim().slice(0, 24);
  if (!name) throw badRequest('昵称不能为空');
  await sql`update users set name = ${name} where id = ${user.id}`;
  return c.json(await loadMe({ ...user, name }));
});

/** 退出所有设备 */
meRoutes.post('/logout-all', async (c) => {
  const user = requireUser(c);
  await sql`delete from sessions where user_id = ${user.id}`;
  deleteCookie(c, COOKIE, { path: '/' });
  return c.json({ ok: true });
});
