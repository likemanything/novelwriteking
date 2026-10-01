/** 团队、成员、邀请。 */
import { Hono } from 'hono';
import type { InvitationInfo, InvitationPreview, MemberInfo, OrgDetail } from '@/shared/api';
import { INVITABLE_ROLES, type OrgRole, type ProjectRole } from '@/shared/permissions';
import { acceptInvitation, findInvitation, invitationProblem, loadMe } from './auth.ts';
import { config } from './config.ts';
import { sql, withTenant, type Tx } from './db/pool.ts';
import { clientIp, isUuid, readJson, requireOrg, requireOrgRole, requireUser, type AppEnv, type OrgContext } from './http.ts';
import { randomToken, sha256 } from './lib/crypto.ts';
import { badRequest, forbidden, notFound } from './lib/errors.ts';
import { maskPhone } from './lib/phone.ts';
import { limit } from './lib/ratelimit.ts';
import { notifyOrg } from './realtime.ts';

const PROJECT_ROLES: ProjectRole[] = ['editor', 'author', 'viewer'];

export async function audit(tx: Tx, org: Pick<OrgContext, 'orgId'>, userId: string | null, action: string, target: string, detail: Record<string, unknown> = {}, ip?: string) {
  await tx`insert into audit_logs (org_id, user_id, action, target, detail, ip) values (${org.orgId}, ${userId}, ${action}, ${target}, ${tx.json(detail as never)}, ${ip ?? null})`;
}

function monthStart() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export const orgRoutes = new Hono<AppEnv>();

/** 新建团队：创建者成为所有者。 */
orgRoutes.post('/', async (c) => {
  const user = requireUser(c);
  const body = await readJson<{ name?: string }>(c);
  const name = String(body.name ?? '').trim().slice(0, 40);
  if (!name) throw badRequest('请填写团队名称');
  limit(`org:create:${user.id}`, 10, 86400_000, '今天新建的团队太多了');
  const id = await sql.begin(async (tx) => {
    const [o] = await tx<{ id: string }[]>`insert into orgs (name, kind, owner_id) values (${name}, 'team', ${user.id}) returning id`;
    await tx`insert into members (org_id, user_id, role) values (${o.id}, ${user.id}, 'owner')`;
    await tx`select set_config('app.org_id', ${o.id}, true)`;
    await audit(tx, { orgId: o.id }, user.id, 'org.create', o.id, { name });
    return o.id;
  });
  return c.json({ id, me: await loadMe(user) });
});

orgRoutes.get('/:orgId', async (c) => {
  const org = await requireOrg(c, c.req.param('orgId'));
  const [o] = await sql<{ id: string; name: string; kind: 'personal' | 'team'; monthly_token_limit: string | null; member_monthly_token_limit: string | null }[]>`
    select id, name, kind, monthly_token_limit, member_monthly_token_limit from orgs where id = ${org.orgId}`;
  const detail: OrgDetail = {
    id: o.id,
    name: o.name,
    kind: o.kind,
    monthlyTokenLimit: o.monthly_token_limit === null ? null : Number(o.monthly_token_limit),
    memberMonthlyTokenLimit: o.member_monthly_token_limit === null ? null : Number(o.member_monthly_token_limit),
  };
  return c.json(detail);
});

orgRoutes.patch('/:orgId', async (c) => {
  const org = await requireOrg(c, c.req.param('orgId'));
  requireOrgRole(org, 'owner', 'admin');
  const body = await readJson<{ name?: string; monthlyTokenLimit?: number | null; memberMonthlyTokenLimit?: number | null }>(c);
  const lim = (v: unknown) => {
    if (v === null) return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1e12) throw badRequest('额度需要是不小于 0 的整数');
    return Math.round(n);
  };
  await sql.begin(async (tx) => {
    if (body.name !== undefined) {
      const name = String(body.name).trim().slice(0, 40);
      if (!name) throw badRequest('团队名称不能为空');
      await tx`update orgs set name = ${name} where id = ${org.orgId}`;
    }
    if ('monthlyTokenLimit' in body) await tx`update orgs set monthly_token_limit = ${lim(body.monthlyTokenLimit)} where id = ${org.orgId}`;
    if ('memberMonthlyTokenLimit' in body) await tx`update orgs set member_monthly_token_limit = ${lim(body.memberMonthlyTokenLimit)} where id = ${org.orgId}`;
    await tx`select set_config('app.org_id', ${org.orgId}, true)`;
    await audit(tx, org, org.user.id, 'org.update', org.orgId, body as Record<string, unknown>, clientIp(c));
  });
  return c.json({ ok: true });
});

/** 删除团队：只有所有者可以删，需要输入团队名确认。个人空间不能删除。 */
orgRoutes.delete('/:orgId', async (c) => {
  const org = await requireOrg(c, c.req.param('orgId'));
  requireOrgRole(org, 'owner');
  if (org.kind === 'personal') throw badRequest('个人空间不能删除');
  const body = await readJson<{ confirmName?: string }>(c);
  if (String(body.confirmName ?? '').trim() !== org.orgName) throw badRequest('团队名称输入不一致');
  await sql`delete from orgs where id = ${org.orgId}`;
  return c.json({ ok: true });
});

// ─────────────────────────── 成员 ───────────────────────────

orgRoutes.get('/:orgId/members', async (c) => {
  const org = await requireOrg(c, c.req.param('orgId'));
  const rows = await sql<{ user_id: string; name: string; phone: string; role: OrgRole; joined_at: Date }[]>`
    select m.user_id, u.name, u.phone, m.role, m.joined_at from members m join users u on u.id = m.user_id
    where m.org_id = ${org.orgId}
    order by array_position(array['owner','admin','editor','author','viewer','guest'], m.role), m.joined_at`;
  const { grants, usage } = await withTenant(org.orgId, async (tx) => ({
    grants: await tx<{ user_id: string; project_id: string; role: ProjectRole }[]>`select user_id, project_id, role from project_grants`,
    usage: await tx<{ user_id: string; tokens: string }[]>`
      select user_id, sum(input_tokens + output_tokens) as tokens from usage_events where created_at >= ${monthStart()} group by user_id`,
  }));
  const canSeePhones = org.role === 'owner' || org.role === 'admin';
  const members: MemberInfo[] = rows
    // 外部协作者只能看到自己和管理者
    .filter((r) => org.role !== 'guest' || r.user_id === org.user.id || r.role === 'owner' || r.role === 'admin')
    .map((r) => ({
      userId: r.user_id,
      name: r.name,
      phone: canSeePhones || r.user_id === org.user.id ? maskPhone(r.phone) : '',
      role: r.role,
      joinedAt: r.joined_at.toISOString(),
      grants: grants.filter((g) => g.user_id === r.user_id).map((g) => ({ projectId: g.project_id, role: g.role })),
      monthTokens: Number(usage.find((u) => u.user_id === r.user_id)?.tokens ?? 0),
    }));
  return c.json({ members });
});

/** 管理员可以调整非所有者成员；只有所有者能调整管理员。 */
function assertCanManage(org: OrgContext, target: { role: OrgRole; user_id: string }) {
  if (target.user_id === org.user.id) throw badRequest('不能修改自己的角色');
  if (target.role === 'owner') throw forbidden('不能修改所有者；如需更换，请所有者转让');
  if (target.role === 'admin' && org.role !== 'owner') throw forbidden('只有所有者可以调整管理员');
}

orgRoutes.patch('/:orgId/members/:userId', async (c) => {
  const org = await requireOrg(c, c.req.param('orgId'));
  requireOrgRole(org, 'owner', 'admin');
  const userId = c.req.param('userId');
  if (!isUuid(userId)) throw notFound();
  const body = await readJson<{ role?: OrgRole; grants?: { projectId: string; role: ProjectRole }[] }>(c);
  const [target] = await sql<{ role: OrgRole; user_id: string }[]>`select role, user_id from members where org_id = ${org.orgId} and user_id = ${userId}`;
  if (!target) throw notFound('这位成员不在团队里');
  assertCanManage(org, target);
  if (body.role !== undefined) {
    if (!INVITABLE_ROLES.includes(body.role)) throw badRequest('角色无效');
    if (body.role === 'admin' && org.role !== 'owner') throw forbidden('只有所有者可以设置管理员');
  }
  await sql.begin(async (tx) => {
    if (body.role) await tx`update members set role = ${body.role} where org_id = ${org.orgId} and user_id = ${userId}`;
    await tx`select set_config('app.org_id', ${org.orgId}, true)`;
    const finalRole = body.role ?? target.role;
    if (finalRole !== 'guest') await tx`delete from project_grants where user_id = ${userId}`;
    if (body.grants && finalRole === 'guest') {
      await tx`delete from project_grants where user_id = ${userId}`;
      for (const g of body.grants.slice(0, 200)) {
        if (typeof g.projectId !== 'string' || !g.projectId || g.projectId.length > 64) continue;
        if (!PROJECT_ROLES.includes(g.role)) throw badRequest('作品权限无效');
        await tx`insert into project_grants (org_id, project_id, user_id, role) values (${org.orgId}, ${g.projectId}, ${userId}, ${g.role})`;
      }
    }
    await audit(tx, org, org.user.id, 'member.update', userId, { from: target.role, to: finalRole, grants: body.grants }, clientIp(c));
  });
  notifyOrg(org.orgId, { type: 'members' });
  return c.json({ ok: true });
});

orgRoutes.delete('/:orgId/members/:userId', async (c) => {
  const org = await requireOrg(c, c.req.param('orgId'));
  const userId = c.req.param('userId');
  if (!isUuid(userId)) throw notFound();
  const [target] = await sql<{ role: OrgRole; user_id: string }[]>`select role, user_id from members where org_id = ${org.orgId} and user_id = ${userId}`;
  if (!target) throw notFound('这位成员不在团队里');
  const self = userId === org.user.id;
  if (self) {
    if (target.role === 'owner') throw badRequest('所有者不能直接退出，请先转让所有权');
  } else {
    requireOrgRole(org, 'owner', 'admin');
    assertCanManage(org, target);
  }
  await sql.begin(async (tx) => {
    await tx`delete from members where org_id = ${org.orgId} and user_id = ${userId}`;
    await tx`select set_config('app.org_id', ${org.orgId}, true)`;
    await tx`delete from chapter_locks where user_id = ${userId}`;
    await audit(tx, org, org.user.id, self ? 'member.leave' : 'member.remove', userId, { role: target.role }, clientIp(c));
  });
  notifyOrg(org.orgId, { type: 'members' });
  return c.json({ ok: true });
});

/** 转让所有权：对方成为所有者，自己变为管理员。 */
orgRoutes.post('/:orgId/transfer', async (c) => {
  const org = await requireOrg(c, c.req.param('orgId'));
  requireOrgRole(org, 'owner');
  if (org.kind === 'personal') throw badRequest('个人空间不能转让');
  const body = await readJson<{ userId?: string }>(c);
  if (!isUuid(body.userId) || body.userId === org.user.id) throw badRequest('请选择要转让给的成员');
  const [target] = await sql<{ role: OrgRole }[]>`select role from members where org_id = ${org.orgId} and user_id = ${body.userId}`;
  if (!target || target.role === 'guest') throw badRequest('只能转让给团队内的正式成员');
  await sql.begin(async (tx) => {
    await tx`update members set role = 'owner' where org_id = ${org.orgId} and user_id = ${body.userId!}`;
    await tx`update members set role = 'admin' where org_id = ${org.orgId} and user_id = ${org.user.id}`;
    await tx`update orgs set owner_id = ${body.userId!} where id = ${org.orgId}`;
    await tx`select set_config('app.org_id', ${org.orgId}, true)`;
    await audit(tx, org, org.user.id, 'org.transfer', body.userId!, {}, clientIp(c));
  });
  notifyOrg(org.orgId, { type: 'members' });
  return c.json({ ok: true });
});

// ─────────────────────────── 邀请 ───────────────────────────

orgRoutes.get('/:orgId/invitations', async (c) => {
  const org = await requireOrg(c, c.req.param('orgId'));
  requireOrgRole(org, 'owner', 'admin');
  const rows = await sql<{ id: string; role: OrgRole; project_ids: string[]; grant_role: ProjectRole | null; note: string; expires_at: Date; max_uses: number; used_count: number; revoked: boolean; created_at: Date; created_by_name: string | null }[]>`
    select i.*, u.name as created_by_name from invitations i left join users u on u.id = i.created_by
    where i.org_id = ${org.orgId} order by i.created_at desc limit 100`;
  const list: InvitationInfo[] = rows.map((r) => ({
    id: r.id,
    role: r.role,
    projectIds: r.project_ids,
    grantRole: r.grant_role,
    note: r.note,
    expiresAt: r.expires_at.toISOString(),
    maxUses: r.max_uses,
    usedCount: r.used_count,
    revoked: r.revoked,
    createdAt: r.created_at.toISOString(),
    createdByName: r.created_by_name ?? '',
  }));
  return c.json({ invitations: list });
});

orgRoutes.post('/:orgId/invitations', async (c) => {
  const org = await requireOrg(c, c.req.param('orgId'));
  requireOrgRole(org, 'owner', 'admin');
  if (org.kind === 'personal') throw badRequest('个人空间不能邀请成员。请先新建一个团队。', 'personal_org');
  limit(`invite:${org.orgId}`, 100, 86400_000);
  const body = await readJson<{ role?: OrgRole; projectIds?: string[]; grantRole?: ProjectRole; maxUses?: number; expiresInDays?: number; note?: string }>(c);
  const role = body.role ?? 'author';
  if (!INVITABLE_ROLES.includes(role)) throw badRequest('角色无效');
  if (role === 'admin' && org.role !== 'owner') throw forbidden('只有所有者可以邀请管理员');
  const projectIds = role === 'guest' ? (body.projectIds ?? []).filter((p) => typeof p === 'string' && p && p.length <= 64).slice(0, 50) : [];
  if (role === 'guest' && !projectIds.length) throw badRequest('邀请外部协作者时，请至少选择一部作品');
  const grantRole = role === 'guest' ? (PROJECT_ROLES.includes(body.grantRole as ProjectRole) ? body.grantRole! : 'viewer') : null;
  const maxUses = Math.min(100, Math.max(1, Math.round(Number(body.maxUses ?? 1)) || 1));
  const days = Math.min(30, Math.max(1, Math.round(Number(body.expiresInDays ?? 7)) || 7));
  const token = randomToken(24);
  const [inv] = await sql<{ id: string; expires_at: Date }[]>`
    insert into invitations (token_hash, org_id, role, project_ids, grant_role, note, created_by, expires_at, max_uses)
    values (${sha256(token)}, ${org.orgId}, ${role}, ${projectIds}, ${grantRole}, ${String(body.note ?? '').slice(0, 60)}, ${org.user.id}, ${new Date(Date.now() + days * 86400_000)}, ${maxUses})
    returning id, expires_at`;
  await withTenant(org.orgId, (tx) => audit(tx, org, org.user.id, 'invitation.create', inv.id, { role, maxUses, days }, clientIp(c)));
  return c.json({ id: inv.id, url: `${config.publicUrl}/invite/${token}`, expiresAt: inv.expires_at.toISOString() });
});

orgRoutes.delete('/:orgId/invitations/:id', async (c) => {
  const org = await requireOrg(c, c.req.param('orgId'));
  requireOrgRole(org, 'owner', 'admin');
  const id = c.req.param('id');
  if (!isUuid(id)) throw notFound();
  const r = await sql`update invitations set revoked = true where id = ${id} and org_id = ${org.orgId}`;
  if (!r.count) throw notFound('邀请不存在');
  await withTenant(org.orgId, (tx) => audit(tx, org, org.user.id, 'invitation.revoke', id, {}, clientIp(c)));
  return c.json({ ok: true });
});

// ─────────────────────────── 邀请链接（被邀请人） ───────────────────────────

export const invitationRoutes = new Hono<AppEnv>();

/** 不需要登录：展示“谁邀请你加入哪个团队” */
invitationRoutes.get('/:token', async (c) => {
  limit(`inv:peek:${c.req.param('token').slice(0, 8)}`, 60, 60_000);
  const inv = await findInvitation(sql, c.req.param('token'));
  if (!inv) throw notFound('邀请链接无效');
  const [o] = await sql<{ name: string }[]>`select name from orgs where id = ${inv.org_id}`;
  const [inviter] = await sql<{ name: string }[]>`select u.name from invitations i left join users u on u.id = i.created_by where i.id = ${inv.id}`;
  const problem = invitationProblem(inv);
  const preview: InvitationPreview = { orgName: o?.name ?? '', role: inv.role, inviterName: inviter?.name ?? '', valid: !problem, reason: problem ?? undefined };
  return c.json(preview);
});

invitationRoutes.post('/:token/accept', async (c) => {
  const user = requireUser(c);
  const result = await sql.begin(async (tx) => {
    const inv = await findInvitation(tx, c.req.param('token'), true);
    const problem = invitationProblem(inv);
    if (problem) throw badRequest(problem, 'invalid_invitation');
    const r = await acceptInvitation(tx, inv!, user.id);
    return { orgId: inv!.org_id, result: r };
  });
  if (result.result === 'already') {
    // 已经是正式成员：直接进入团队即可
    return c.json({ orgId: result.orgId, already: true, me: await loadMe(user) });
  }
  notifyOrg(result.orgId, { type: 'members' });
  return c.json({ orgId: result.orgId, me: await loadMe(user) });
});
