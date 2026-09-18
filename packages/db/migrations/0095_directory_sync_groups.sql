-- Directory groups mapped to spaces (P8-T08b).
--
-- SCIM's Groups resource is how an identity provider says who belongs
-- together. The product's own answer to that question is a space, so a
-- group maps to a space and the group's membership becomes the space's.
--
-- **The mapping is a row rather than a name match**, because a group that
-- gets renamed in the directory is the same group. Matching on the display
-- name would make a rename look like a new group and leave the workspace
-- with two spaces holding the same people, which is exactly the mess an
-- integration is supposed to prevent.
--
-- One row per group per workspace, keyed on the directory's own id.

-- openokr:hard-delete: a mapping is a pointer, not content. Unmapping a
-- group leaves its space and its members alone; there is nothing here worth
-- restoring, and a tombstone would hold the unique index against the same
-- group being mapped again.
create table directory_sync_groups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  -- The directory's own id for the group. Opaque, and never a person.
  external_id text not null,
  -- What the directory last called it, so a rename is visible in the log
  -- without asking the provider.
  display_name text not null,
  space_id uuid not null references spaces(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One mapping per group, and one per space: two directory groups pointing at
-- one space would make "who should be in this space" ambiguous, and the
-- reconciliation would fight itself on every sync.
create unique index directory_sync_groups_external_idx
  on directory_sync_groups (workspace_id, external_id);
create unique index directory_sync_groups_space_idx
  on directory_sync_groups (workspace_id, space_id);

-- Tenant floor. No second key: unlike the token table, every read here
-- happens after a bearer token has already named the workspace.
alter table directory_sync_groups enable row level security;
alter table directory_sync_groups force row level security;

create policy directory_sync_groups_tenant on directory_sync_groups
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
