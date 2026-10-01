/** 请求上下文：当前用户、当前组织与角色、请求体解析、客户端 IP。 */
import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { OrgRole, ProjectRole, EffectiveRole } from '@/shared/permissions';
import { config } from './config.ts';
import { sql, withTenant } from './db/pool.ts';
import { badRequest, forbidden, unauthorized } from './lib/errors.ts';

export interface SessionUser {
  id: string;
  phone: string;
  name: string;
  platformAdmin: boolean;
}

export type AppEnv = { Variables: { user: SessionUser | null; sessionHash: string | null } };
export type Ctx = Context<AppEnv>;

export function requireUser(c: Ctx): SessionUser {
  const u = c.get('user');
  if (!u) throw unauthorized();
  return u;
}

export function clientIp(c: Ctx): string {
  if (config.trustProxy) {
    const fwd = c.req.header('x-forwarded-for');
    if (fwd) return fwd.split(',')[0].trim();
    const real = c.req.header('x-real-ip');
    if (real) return real.trim();
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function readJson<T = Record<string, unknown>>(c: Ctx): Promise<T> {
  try {
    const body = await c.req.json();
    if (!body || typeof body !== 'object') throw new Error();
    return body as T;
  } catch {
    throw badRequest('请求内容格式不正确');
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(s: unknown): s is string {
  return typeof s === 'string' && UUID.test(s);
}

export interface OrgContext {
  orgId: string;
  orgName: string;
  kind: 'personal' | 'team';
  role: OrgRole;
  grants: Map<string, ProjectRole>;
  user: SessionUser;
}

/** 当前请求所在的组织：来自请求头 X-Org-Id（SSE 连接用查询参数 org）。必须是成员。 */
export async function requireOrg(c: Ctx, explicit?: string): Promise<OrgContext> {
  const user = requireUser(c);
  const orgId = explicit ?? c.req.header('x-org-id') ?? c.req.query('org');
  if (!isUuid(orgId)) throw badRequest('缺少或无效的团队标识');
  const [m] = await sql<{ role: OrgRole; kind: 'personal' | 'team'; name: string }[]>`
    select m.role, o.kind, o.name from members m join orgs o on o.id = m.org_id
    where m.org_id = ${orgId} and m.user_id = ${user.id}`;
  if (!m) throw forbidden('你不是这个团队的成员，或已被移出团队', 'not_member');
  const grants = new Map<string, ProjectRole>();
  if (m.role === 'guest') {
    const rows = await withTenant(orgId, (tx) => tx<{ project_id: string; role: ProjectRole }[]>`
      select project_id, role from project_grants where user_id = ${user.id}`);
    for (const r of rows) grants.set(r.project_id, r.role);
  }
  return { orgId, orgName: m.name, kind: m.kind, role: m.role, grants, user };
}

/** 在某部作品里的实际角色：外部协作者看授权，其他人看组织角色。 */
export function roleInProject(org: OrgContext, projectId: string | null | undefined): EffectiveRole | null {
  if (org.role !== 'guest') return org.role;
  if (!projectId) return null;
  return org.grants.get(projectId) ?? null;
}

export function requireOrgRole(org: OrgContext, ...roles: OrgRole[]) {
  if (!roles.includes(org.role)) throw forbidden();
}
