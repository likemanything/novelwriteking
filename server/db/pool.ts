/**
 * 数据库连接与租户事务。
 *
 * 所有租户数据都必须在 withTenant(orgId, …) 里读写：事务开始时设置 app.org_id，
 * 行级安全策略据此过滤。即使某条 SQL 漏写了 org_id 条件，也读不到别的组织的数据。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { config } from '../config.ts';

export type Sql = postgres.Sql<Record<string, never>>;
export type Tx = postgres.TransactionSql<Record<string, never>>;
export type Db = Sql | Tx;

export const sql: Sql = postgres(config.databaseUrl, {
  max: 12,
  idle_timeout: 30,
  connect_timeout: 10,
  onnotice: () => {},
  transform: { undefined: null },
});

export async function withTenant<T>(orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await sql.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${orgId}, true)`;
    return fn(tx);
  })) as T;
}

export async function tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await sql.begin(fn)) as T;
}

const MIGRATIONS = resolve(import.meta.dirname, 'migrations');

/** 依次执行尚未执行的迁移文件，每个文件一个事务。 */
export async function migrate(db: Sql = sql, log = console.log) {
  await db.begin(async (t) => {
    // 多个实例同时启动时，用事务级咨询锁保证只有一个在执行迁移
    await t`select pg_advisory_xact_lock(7271)`;
    await t`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  });
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const text = readFileSync(resolve(MIGRATIONS, file), 'utf8');
    const applied = await db.begin(async (t) => {
      await t`select pg_advisory_xact_lock(7271)`;
      const [row] = await t`select 1 from schema_migrations where name = ${file}`;
      if (row) return false;
      await t.unsafe(text);
      await t`insert into schema_migrations (name) values (${file})`;
      return true;
    });
    if (applied) log(`已执行迁移 ${file}`);
  }
}

/** 启动时自检：应用账号不能是超级用户或绕过行级安全的角色。 */
export async function assertSafeRole(db: Sql = sql) {
  const [r] = await db<{ rolsuper: boolean; rolbypassrls: boolean; rolname: string }[]>`
    select rolsuper, rolbypassrls, rolname from pg_roles where rolname = current_user`;
  if (r && (r.rolsuper || r.rolbypassrls)) {
    throw new Error(`数据库账号 ${r.rolname} 是超级用户或可绕过行级安全，租户隔离会失效。请为应用单独创建普通账号。`);
  }
}
