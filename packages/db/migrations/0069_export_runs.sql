-- Export runs (TECHNICAL-PLAN §4.13, P5-T15).
--
-- **A row per asked-for file, so a person has somewhere to come back to.** An
-- export above the inline limit is handed to the relay, and the request that
-- asked for it has already returned. Without a row the file exists in storage
-- and nothing in the product knows it does: the person who asked would have to
-- keep the tab open and hope. This is the list they collect it from.
--
-- **`kind` is here from the first row, and `list` is the only value today.**
-- §4.13 names this table for the §7.3 portability engine's whole-workspace
-- archive, which is Phase 7's. That is a different shape of export with the
-- same lifecycle, and giving it a discriminator now costs one column and saves
-- a second table with the same five states in it.
--
-- **The blob is nullable until the worker has one.** A run is `queued` the
-- moment the request commits, and the file is what the relay produces. A schema
-- that required the blob up front would mean the run could only be recorded
-- after the work, which is the one moment a person is most likely to look.
--
-- **`requested_by_id` is not nullable and is what scopes the read.** The file
-- holds exactly the rows that member could see when the worker built it, so
-- nobody else may collect it, not even an administrator. Row-level security is
-- the tenant floor here as everywhere; the member filter is in the read.

-- openokr:soft-delete: a person deleting a finished export is deleting a file
-- that left the product, and the audit trail needs to keep saying it existed.
create table export_runs (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  kind text not null default 'list' check (kind in ('list', 'archive')),
  -- Which list, and how it was narrowed. Free text rather than an enum: the
  -- exportable set lives in `packages/core` and a check constraint here would
  -- be a second list to keep in step.
  list text not null,
  format text not null check (format in ('csv', 'xlsx')),
  cycle_id uuid references cycles (id) on delete set null,
  space_id uuid references spaces (id) on delete set null,
  requested_by_id uuid not null references workspace_members (id) on delete cascade,
  state text not null default 'queued' check (
    state in ('queued', 'building', 'ready', 'failed')
  ),
  row_count integer,
  filename text not null,
  blob_id uuid references blobs (id) on delete set null,
  -- Why it failed, for the person looking at it rather than for a log. Null
  -- while the run has not failed.
  error text,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table export_runs enable row level security;
alter table export_runs force row level security;

create policy tenant_isolation on export_runs
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- The one read this table has: my exports, newest first.
create index export_runs_mine_idx
  on export_runs (workspace_id, requested_by_id, created_at desc)
  where deleted_at is null;
