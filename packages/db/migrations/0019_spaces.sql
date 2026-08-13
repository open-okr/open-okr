-- Spaces: team homes (TECHNICAL-PLAN.md §4.2, §4.14, P3-T01).
--
-- A space is the second protected aggregate the product has, after the
-- workspace itself. Everything the access model needs for it already exists:
-- `access_groups.kind` has carried `space_standard` since P2-T01, and
-- `access_group_memberships` was built for exactly this case, "a group whose
-- membership is real data rather than structural". This migration adds the
-- rows those columns were waiting for, and the foreign key that P2-T01 could
-- not write because spaces did not exist yet.
create table spaces (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name text not null,
  -- Plain text, not editor JSON. TECHNICAL-PLAN §4.2 lists `mission?` with no
  -- rich-text marker, unlike `annual_frames.mission (rich)` in §4.3, so a
  -- space's mission is one line rather than a document.
  mission text,
  -- §4.14 gives this three future contents, each arriving with its feature:
  -- team voting opt-in (P3-T07), the coach strictness override (Phase 4), and
  -- space defaults. Empty is a complete answer, not an unanswered question.
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table spaces enable row level security;
alter table spaces force row level security;

create policy tenant_isolation on spaces
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- Two spaces in one workspace may not share a name: a member choosing which
-- space to file a goal under has nothing else to tell them apart.
create unique index spaces_workspace_name_idx
  on spaces (workspace_id, lower(name))
  where deleted_at is null;

create table space_members (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  space_id uuid not null references spaces (id) on delete cascade,
  member_id uuid not null references workspace_members (id) on delete cascade,
  role text not null default 'member'
    check (role in ('member', 'manager', 'coordinator')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table space_members enable row level security;
alter table space_members force row level security;

create policy tenant_isolation on space_members
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- One membership row per person per space. A role change updates this row
-- rather than adding a second one, so "who is in this space" has one answer.
create unique index space_members_unique_idx
  on space_members (workspace_id, space_id, member_id)
  where deleted_at is null;

-- METHOD.md §2.5: the coordinator runs the weekly session, one per space.
-- Managers are not capped: a department with two leads is ordinary, and
-- nothing in the method says otherwise.
create unique index space_members_one_coordinator_idx
  on space_members (workspace_id, space_id)
  where deleted_at is null and role = 'coordinator';

create index space_members_member_idx
  on space_members (workspace_id, member_id)
  where deleted_at is null;

-- The foreign key P2-T01 left as a comment ("No foreign key: spaces are
-- P3-T01"). A space_standard group is meaningless without the space it speaks
-- for, so the reference is enforced now that there is something to reference.
alter table access_groups
  add constraint access_groups_space_id_fkey
  foreign key (space_id) references spaces (id) on delete cascade;

-- One space_standard group per space, which is what makes
-- `ensureSpaceStandardGroup` safe to call from any Operation without checking
-- first.
create unique index access_groups_space_standard_idx
  on access_groups (workspace_id, space_id)
  where deleted_at is null and kind = 'space_standard';
