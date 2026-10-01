/** 平台管理：内测邀请码（只有平台管理员可用）。 */
import { Hono } from 'hono';
import type { SignupCodeInfo } from '@/shared/api';
import { sql } from './db/pool.ts';
import { readJson, requireUser, type AppEnv, type Ctx } from './http.ts';
import { readableCode } from './lib/crypto.ts';
import { forbidden, notFound } from './lib/errors.ts';

function requireAdmin(c: Ctx) {
  const u = requireUser(c);
  if (!u.platformAdmin) throw forbidden('只有平台管理员可以管理内测邀请码');
  return u;
}

export async function createSignupCode(opts: { note?: string; maxUses?: number; expiresInDays?: number | null; createdBy?: string | null }) {
  const code = readableCode();
  const maxUses = Math.min(1000, Math.max(1, Math.round(Number(opts.maxUses ?? 1)) || 1));
  const expires = opts.expiresInDays ? new Date(Date.now() + Math.min(365, Math.max(1, opts.expiresInDays)) * 86400_000) : null;
  await sql`insert into signup_codes (code, note, max_uses, expires_at, created_by) values (${code}, ${String(opts.note ?? '').slice(0, 60)}, ${maxUses}, ${expires}, ${opts.createdBy ?? null})`;
  return code;
}

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.get('/signup-codes', async (c) => {
  requireAdmin(c);
  const rows = await sql<{ code: string; note: string; max_uses: number; used_count: number; expires_at: Date | null; created_at: Date }[]>`
    select code, note, max_uses, used_count, expires_at, created_at from signup_codes order by created_at desc limit 200`;
  const codes: SignupCodeInfo[] = rows.map((r) => ({
    code: r.code,
    note: r.note,
    maxUses: r.max_uses,
    usedCount: r.used_count,
    expiresAt: r.expires_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
  }));
  return c.json({ codes });
});

adminRoutes.post('/signup-codes', async (c) => {
  const u = requireAdmin(c);
  const body = await readJson<{ note?: string; maxUses?: number; expiresInDays?: number }>(c);
  const code = await createSignupCode({ ...body, createdBy: u.id });
  return c.json({ code });
});

adminRoutes.delete('/signup-codes/:code', async (c) => {
  requireAdmin(c);
  const r = await sql`delete from signup_codes where code = ${c.req.param('code')}`;
  if (!r.count) throw notFound('邀请码不存在');
  return c.json({ ok: true });
});
