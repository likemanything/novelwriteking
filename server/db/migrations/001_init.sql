-- 墨织 2.0 初始结构
--
-- 两类表：
-- 1. 平台表（用户、会话、组织、成员、邀请……）：由服务端代码按用户与成员关系校验访问；
-- 2. 租户表（写作数据、模型密钥、用量、章节锁、审计）：带 org_id，开启并强制行级安全，
--    每个请求在事务里设置 app.org_id，数据库层面兜底防止跨组织读写。

-- ─────────────────────────── 平台表 ───────────────────────────

create table users (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  name text not null default '',
  platform_admin boolean not null default false,
  disabled boolean not null default false,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  ip text,
  user_agent text
);
create index sessions_user on sessions(user_id);

create table otp_codes (
  phone text primary key,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  sent_at timestamptz not null default now()
);

-- 内测邀请码：邀请制下，没有团队邀请链接的新用户凭它注册
create table signup_codes (
  code text primary key,
  note text not null default '',
  max_uses int not null default 1 check (max_uses > 0),
  used_count int not null default 0,
  expires_at timestamptz,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('personal', 'team')),
  owner_id uuid references users(id) on delete set null,
  -- 每月文本 token 上限（空值表示不限）
  monthly_token_limit bigint check (monthly_token_limit is null or monthly_token_limit >= 0),
  member_monthly_token_limit bigint check (member_monthly_token_limit is null or member_monthly_token_limit >= 0),
  created_at timestamptz not null default now()
);

create table members (
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'editor', 'author', 'viewer', 'guest')),
  joined_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index members_user on members(user_id);

create table invitations (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  org_id uuid not null references orgs(id) on delete cascade,
  role text not null check (role in ('admin', 'editor', 'author', 'viewer', 'guest')),
  -- 外部协作者（guest）只能访问这些作品，权限为 grant_role
  project_ids text[] not null default '{}',
  grant_role text check (grant_role in ('editor', 'author', 'viewer')),
  note text not null default '',
  created_by uuid references users(id) on delete set null,
  expires_at timestamptz not null,
  max_uses int not null default 1 check (max_uses > 0),
  used_count int not null default 0,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);
create index invitations_org on invitations(org_id);

-- ─────────────────────────── 租户表 ───────────────────────────

-- 外部协作者的作品授权
create table project_grants (
  org_id uuid not null,
  project_id text not null,
  user_id uuid not null,
  role text not null check (role in ('editor', 'author', 'viewer')),
  primary key (org_id, project_id, user_id),
  foreign key (org_id, user_id) references members(org_id, user_id) on delete cascade
);

-- 写作数据：与浏览器本地数据库一一对应的行（作品、人物、世界观、故事线、章节、版本……）
create sequence record_seq;
create table records (
  org_id uuid not null references orgs(id) on delete cascade,
  tbl text not null,
  id text not null,
  project_id text not null,
  data jsonb,
  deleted boolean not null default false,
  seq bigint not null,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (org_id, tbl, id)
);
create index records_seq on records(org_id, seq);
create index records_project on records(org_id, project_id);

-- 模型接入：密钥用信封加密保存，永不返回浏览器
create table credentials (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  provider text not null check (provider in ('openai', 'anthropic')),
  base_url text not null,
  model text not null,
  models jsonb not null default '[]',
  protocol_label text not null default '',
  temperature real not null default 0.85,
  max_tokens int not null default 4096,
  key_cipher text,
  key_hint text not null default '',
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index credentials_org on credentials(org_id);

-- 环节分工：构思 / 写作 / 审稿 / 改写分别用哪个模型（空值表示离线演示引擎）
create table stage_assignments (
  org_id uuid not null references orgs(id) on delete cascade,
  stage text not null check (stage in ('plan', 'write', 'review', 'muse')),
  credential_id uuid references credentials(id) on delete set null,
  primary key (org_id, stage)
);

create table usage_events (
  id bigserial primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid,
  project_id text,
  stage text not null,
  credential_id uuid,
  model text not null default '',
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  estimated boolean not null default true,
  status text not null check (status in ('ok', 'error', 'aborted')),
  error text,
  duration_ms int not null default 0,
  created_at timestamptz not null default now()
);
create index usage_org_time on usage_events(org_id, created_at);

-- 章节锁：同一时间只有一个人编辑某一章，超时自动释放
create table chapter_locks (
  org_id uuid not null references orgs(id) on delete cascade,
  chapter_id text not null,
  user_id uuid not null,
  user_name text not null default '',
  expires_at timestamptz not null,
  primary key (org_id, chapter_id)
);

create table audit_logs (
  id bigserial primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid,
  action text not null,
  target text not null default '',
  detail jsonb not null default '{}',
  ip text,
  created_at timestamptz not null default now()
);
create index audit_org_time on audit_logs(org_id, created_at);

-- 行级安全：只能看到、写入当前事务所属组织的数据
do $$
declare t text;
begin
  foreach t in array array['project_grants', 'records', 'credentials', 'stage_assignments', 'usage_events', 'chapter_locks', 'audit_logs'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid) with check (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid)',
      t
    );
  end loop;
end $$;
