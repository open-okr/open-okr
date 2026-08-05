-- Test fixture, never shipped. A minimal business table exercising everything
-- the P1-T03 floor guarantees: tenant key, row-level security in the same
-- file, forced for the owner too, and soft delete.
create table tenant_probes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  title text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table tenant_probes enable row level security;
alter table tenant_probes force row level security;

-- The tenant floor. `current_setting(..., true)` returns NULL when the setting
-- is absent, and NULL never equals anything, so a connection with no workspace
-- applied reads and writes zero rows.
create policy tenant_isolation on tenant_probes
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
