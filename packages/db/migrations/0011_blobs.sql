-- Files and blobs (TECHNICAL-PLAN §4.9, P2-T05).
--
-- `status` carries a fourth value beyond the three TECHNICAL-PLAN names
-- (`ok` / `scanning` / `quarantined`): `pending`, the state between prepare
-- and claim. The terse table doesn't spell out that gap, but "prepare,
-- upload, claim" needs somewhere for a reservation to sit before the bytes
-- land, and the orphan cleanup job the same row names needs exactly that
-- state to find and discard what never got claimed.
create table blobs (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  filename text not null,
  content_type text not null,
  -- Null until claimed: prepare reserves a key before any byte exists.
  filesize bigint,
  digest text,
  storage_key text not null,
  author_member_id uuid references workspace_members (id),
  status text not null default 'pending'
    check (status in ('pending', 'ok', 'scanning', 'quarantined')),
  width integer,
  height integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table blobs enable row level security;
alter table blobs force row level security;

create policy tenant_isolation on blobs
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create unique index blobs_storage_key_idx
  on blobs (workspace_id, storage_key)
  where deleted_at is null;

-- Byte accounting sums filesize over exactly this set: ok and scanning both
-- hold real bytes on disk, pending does not yet, and quarantined content
-- still occupies space until an operator disposes of it.
create index blobs_workspace_status_idx
  on blobs (workspace_id, status)
  where deleted_at is null;

-- The orphan cleanup job's own query: pending rows older than its cutoff.
create index blobs_pending_age_idx
  on blobs (workspace_id, created_at)
  where status = 'pending' and deleted_at is null;
