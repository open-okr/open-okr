-- The relationship access model (TECHNICAL-PLAN §4.1, P2-T01).
--
-- Four tables. `access_contexts` is one row per protected aggregate: the
-- thing being shared. `access_groups` is the principal side: every workspace
-- gets exactly one `workspace_standard` group and one `anonymous` group,
-- every member gets exactly one `member` group of their own, and every space
-- (P3-T01) will get one `space_standard` group. `access_group_memberships`
-- enumerates who belongs to a group whose membership is real data rather
-- than structural — `space_standard` today. It is deliberately not used for
-- `workspace_standard`: every active member of the workspace already belongs
-- to it by definition, so a row per person would be state kept only to agree
-- with `workspace_members`. `access_bindings` is the grant itself: a level on
-- a context, held by a group, optionally tagged with a role.
--
-- `can()` and the access-aware getter that read these tables are P2-T02.
-- Every active member still resolves to `full` until then (see the comment
-- on `resolveActor` in packages/core/src/operations/operation.ts).

create table access_contexts (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  resource_type text not null,
  resource_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table access_groups (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  kind text not null
    check (kind in ('member', 'workspace_standard', 'space_standard', 'anonymous')),
  -- Set only for kind `member`: the one person this group speaks for.
  member_id uuid references workspace_members (id) on delete cascade,
  -- Set only for kind `space_standard`. No foreign key: spaces are P3-T01.
  space_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- Each kind owns exactly the column that scopes it, so a group can never
  -- claim to be both a member's own group and a space's standard group.
  check (
    (kind = 'member' and member_id is not null and space_id is null) or
    (kind = 'space_standard' and space_id is not null and member_id is null) or
    (kind in ('workspace_standard', 'anonymous')
      and member_id is null and space_id is null)
  )
);

create table access_group_memberships (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  group_id uuid not null references access_groups (id) on delete cascade,
  member_id uuid not null references workspace_members (id) on delete cascade,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table access_bindings (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  group_id uuid not null references access_groups (id) on delete cascade,
  context_id uuid not null references access_contexts (id) on delete cascade,
  -- Mirrors ACCESS_LEVELS in packages/core/src/access/levels.ts. A check here
  -- rather than a foreign key to a levels table, because the four values are
  -- a fixed part of the method, not data that changes.
  level integer not null check (level in (10, 40, 70, 100)),
  tag text
    check (tag in ('champion', 'reviewer', 'sponsor', 'facilitator', 'coordinator')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table access_contexts enable row level security;
alter table access_contexts force row level security;
alter table access_groups enable row level security;
alter table access_groups force row level security;
alter table access_group_memberships enable row level security;
alter table access_group_memberships force row level security;
alter table access_bindings enable row level security;
alter table access_bindings force row level security;

create policy tenant_isolation on access_contexts
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create policy tenant_isolation on access_groups
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create policy tenant_isolation on access_group_memberships
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create policy tenant_isolation on access_bindings
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- One live context per resource.
create unique index access_contexts_resource_idx
  on access_contexts (workspace_id, resource_type, resource_id)
  where deleted_at is null;

-- One live workspace_standard group, and one live anonymous group, per
-- workspace.
create unique index access_groups_workspace_standard_idx
  on access_groups (workspace_id)
  where kind = 'workspace_standard' and deleted_at is null;

create unique index access_groups_anonymous_idx
  on access_groups (workspace_id)
  where kind = 'anonymous' and deleted_at is null;

-- One live group per member, and one live group per space.
create unique index access_groups_member_idx
  on access_groups (member_id)
  where kind = 'member' and deleted_at is null;

create unique index access_groups_space_idx
  on access_groups (space_id)
  where kind = 'space_standard' and deleted_at is null;

create index access_group_memberships_group_idx
  on access_group_memberships (group_id)
  where deleted_at is null;

create index access_group_memberships_member_idx
  on access_group_memberships (workspace_id, member_id)
  where deleted_at is null;

-- Who belongs to a given group, once, while live.
create unique index access_group_memberships_one_per_group_idx
  on access_group_memberships (group_id, member_id)
  where deleted_at is null;

create index access_bindings_context_idx
  on access_bindings (context_id)
  where deleted_at is null;

create index access_bindings_group_idx
  on access_bindings (group_id)
  where deleted_at is null;

-- One live binding per group and context at a given tag. A group may hold a
-- plain binding and a tagged one on the same context (a champion binding
-- alongside the workspace group's baseline, say), but not two of the same
-- shape at once.
create unique index access_bindings_untagged_idx
  on access_bindings (group_id, context_id)
  where tag is null and deleted_at is null;

create unique index access_bindings_tagged_idx
  on access_bindings (group_id, context_id, tag)
  where tag is not null and deleted_at is null;
