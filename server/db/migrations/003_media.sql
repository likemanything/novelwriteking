-- 图像 / 视频 / 配音模型（声明式适配）与生成的媒体文件

create table media_providers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  kind text not null check (kind in ('image', 'video', 'tts')),
  name text not null,
  spec jsonb not null,
  key_cipher text,
  secret_cipher text,
  key_hint text not null default '',
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index media_providers_org on media_providers(org_id);

-- 每种用途当前使用哪一个服务
create table media_assignments (
  org_id uuid not null references orgs(id) on delete cascade,
  kind text not null check (kind in ('image', 'video', 'tts')),
  provider_id uuid references media_providers(id) on delete set null,
  primary key (org_id, kind)
);

-- 生成的文件存放在服务器本地磁盘，这里只记元数据
create table media_assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  drama_id uuid,
  node_id uuid,
  kind text not null check (kind in ('image', 'video', 'tts')),
  mime text not null,
  bytes bigint not null,
  file text not null,
  meta jsonb not null default '{}',
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index media_assets_node on media_assets(node_id);
create index media_assets_org on media_assets(org_id, created_at);

do $$
declare t text;
begin
  foreach t in array array['media_providers', 'media_assignments', 'media_assets'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid) with check (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid)',
      t
    );
  end loop;
end $$;
