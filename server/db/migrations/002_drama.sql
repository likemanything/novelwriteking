-- 小说 → 短剧画布
-- 一部小说对应一张画布（drama_projects）；画布由节点（drama_nodes）与连线（drama_edges）组成。
-- 节点的输出（拆解、大纲、剧本、分镜……）以 jsonb 保存，input_hash 用来判断上游是否变了（过期）。

create table drama_projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  novel_id text not null,
  preset jsonb not null default '{}',
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, novel_id)
);

create table drama_nodes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  drama_id uuid not null references drama_projects(id) on delete cascade,
  type text not null,
  title text not null default '',
  x real not null default 0,
  y real not null default 0,
  params jsonb not null default '{}',
  status text not null default 'idle' check (status in ('idle', 'running', 'done', 'failed')),
  output jsonb,
  output_hash text not null default '',
  input_hash text not null default '',
  error text,
  approved boolean not null default false,
  run_ms int not null default 0,
  started_at timestamptz,
  updated_at timestamptz not null default now()
);
create index drama_nodes_drama on drama_nodes(drama_id);

create table drama_edges (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  drama_id uuid not null references drama_projects(id) on delete cascade,
  from_id uuid not null references drama_nodes(id) on delete cascade,
  to_id uuid not null references drama_nodes(id) on delete cascade,
  unique (from_id, to_id)
);
create index drama_edges_drama on drama_edges(drama_id);

do $$
declare t text;
begin
  foreach t in array array['drama_projects', 'drama_nodes', 'drama_edges'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid) with check (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid)',
      t
    );
  end loop;
end $$;
