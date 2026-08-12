-- Test fixture, never shipped. A minimal business table carrying a
-- context_id column, so P2-T02's composable access-scope filter has
-- something with several rows to list against, the way a real protected
-- table (a goal, a space) will once Phase 3 adds one.
create table access_probes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  context_id uuid not null,
  title text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table access_probes enable row level security;
alter table access_probes force row level security;

create policy tenant_isolation on access_probes
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
