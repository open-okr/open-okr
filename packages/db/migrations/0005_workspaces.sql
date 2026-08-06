-- Workspaces and the per-workspace person (TECHNICAL-PLAN §4.1).
--
-- Identity is two-level. `users`, from 0004, is global to the deployment and
-- owned by Better Auth. `workspace_members` is the person inside one
-- workspace, and everything downstream (authorship, mentions, assignment,
-- audit) references the member rather than the user. That is what lets
-- somebody leave or be suspended without their history breaking.
--
-- Two transaction-local settings appear here:
--
--   app.workspace_id  the tenant floor, applied on every scoped request
--   app.user_id       the authenticated identity, applied when the question
--                     genuinely spans workspaces
--
-- Only one question does span them: "which workspaces do I belong to", which
-- the switcher asks on every page. Answering it with a second policy keyed on
-- the user keeps the answer inside row-level security. The alternative, a
-- privileged query that steps around the floor, would put a cross-tenant read
-- in the one place a bug is least likely to be noticed.

-- openokr:tenant-root: this is the table every other workspace_id points at,
-- so it has no workspace_id of its own. Its policy keys on the primary key
-- instead, and the tenant-root marker keeps every other floor check in force.
create table workspaces (
  -- Application-generated and time-ordered (§3). No database default: a row
  -- arriving without an id is a bug, not something to paper over.
  id uuid primary key,
  name text not null,
  -- Unique across the instance because it addresses the workspace in a URL.
  -- Row-level security hides other workspaces from a reader, but the unique
  -- index still refuses a duplicate, which is what makes a slug dependable.
  slug text not null unique,
  state text not null default 'active'
    check (state in ('active', 'read_only', 'frozen')),
  -- Branding, timezone, trusted email domains and default language, per the
  -- §4.14 settings map. Provisioning fills every key from the registry, so a
  -- fresh workspace never holds an unanswered setting.
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- openokr:hard-delete is deliberately absent: a workspace is soft-deleted, so
-- an accidental removal is recoverable while the tenant floor still hides it.

create table workspace_members (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  -- Null for placeholder people and for agents before anybody claims them. An
  -- import creates members for colleagues who have never signed in, and they
  -- gain a user_id when they register against the same email address.
  user_id text references users (id) on delete set null,
  name text not null,
  title text,
  -- No foreign key yet: blobs arrive with P2-T05, and a dangling reference
  -- here is better than a table that does not exist.
  avatar_blob_id uuid,
  timezone text,
  -- Self-referencing. The cycle-safe chain and its query land in P2-T03.
  manager_id uuid references workspace_members (id) on delete set null,
  kind text not null default 'human'
    check (kind in ('human', 'guest', 'agent', 'placeholder')),
  status text not null default 'active'
    check (status in ('active', 'invited', 'suspended')),
  suspended_at timestamptz,
  -- Rich text is editor JSON plus a version column, never Markdown (§4).
  bio jsonb,
  bio_version integer,
  primary_channel text not null default 'email'
    check (primary_channel in
      ('app', 'email', 'slack', 'teams', 'whatsapp', 'telegram')),
  quiet_hours jsonb,
  -- Importable (§7.2): FlowyTeam employees become members, and a re-run must
  -- update the same row rather than duplicate it.
  legacy_id text,
  legacy_type text check (legacy_type in ('flowyteam', 'csv')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table workspaces enable row level security;
alter table workspaces force row level security;
alter table workspace_members enable row level security;
alter table workspace_members force row level security;

-- The tenant floor, the same shape as every other table: `current_setting`
-- with the missing-ok flag returns NULL when nothing is applied, and NULL
-- never equals anything, so an unscoped connection reads and writes nothing.
create policy tenant_isolation on workspaces
  using (id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create policy tenant_isolation on workspace_members
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- The cross-workspace half, read-only and scoped to the signed-in person.
-- Postgres combines permissive policies with OR, so these widen what a request
-- may read without loosening anything the tenant policy protects. There is no
-- matching `with check`, so neither policy grants a write.
create policy own_memberships on workspace_members
  for select
  using (user_id = nullif(current_setting('app.user_id', true), ''));

create policy own_workspaces on workspaces
  for select
  using (exists (
    select 1
      from workspace_members m
     where m.workspace_id = workspaces.id
       and m.user_id = nullif(current_setting('app.user_id', true), '')
       and m.deleted_at is null
  ));

create index workspace_members_workspace_idx
  on workspace_members (workspace_id)
  where deleted_at is null;

create index workspace_members_user_idx
  on workspace_members (user_id)
  where deleted_at is null;

create index workspace_members_manager_idx
  on workspace_members (manager_id)
  where deleted_at is null;

-- One live membership per person per workspace. Partial, so a member who left
-- and was re-added does not collide with their own soft-deleted row.
create unique index workspace_members_one_per_user_idx
  on workspace_members (workspace_id, user_id)
  where user_id is not null and deleted_at is null;

-- Import idempotency (§3): re-running an import updates rather than duplicates.
create unique index workspace_members_legacy_idx
  on workspace_members (workspace_id, legacy_type, legacy_id)
  where legacy_id is not null;
