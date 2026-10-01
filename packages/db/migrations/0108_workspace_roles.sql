-- Workspace roles with a settable permission matrix (P8-G13a,
-- docs/design/p8-g13-workspace-roles.md).
--
-- **A role is a level per domain, not a second access model.** §4.1's
-- relationship model is unchanged: contexts, groups and bindings all still
-- resolve exactly as they did, and `can()` is still the single door. What
-- changes is that the maximum it takes now includes one more source, the level
-- this member's role grants for the resource type of the context being asked
-- about. Two overlapping grants already compose by taking the highest, so a
-- role composes with a binding the same way.
--
-- **Why a role at all.** Who may edit an objective came from membership of the
-- owning space, through a `space_standard` binding at level 70. That is a rule
-- nobody can state without reading the binding table, it cannot be changed
-- without moving people between spaces, and it has no screen. A role says the
-- same thing in a sentence an administrator can edit.
--
-- The levels are §4.1's own: 10 view, 40 comment, 70 edit, 100 manage. A
-- domain is an access context's `resource_type`, so no translation sits
-- between the matrix and the resolver.

create table workspace_roles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  -- What an administrator sees. Unique per workspace so two roles cannot be
  -- told apart only by their id.
  name text not null,
  -- The four roles every workspace is born with. A built-in role may be
  -- edited and renamed; `owner` additionally may not, which the application
  -- enforces and the check below records.
  builtin_key text,
  -- The role a member gets when nothing else says otherwise. Exactly one per
  -- workspace, held by the partial index below.
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint workspace_roles_builtin_key_known
    check (builtin_key is null or builtin_key in ('owner', 'admin', 'member', 'viewer'))
);

create unique index workspace_roles_name_idx
  on workspace_roles (workspace_id, lower(name))
  where deleted_at is null;

create unique index workspace_roles_builtin_idx
  on workspace_roles (workspace_id, builtin_key)
  where deleted_at is null and builtin_key is not null;

-- One default, or none during the rollout. Two would make "the role a new
-- member gets" a question with two answers.
create unique index workspace_roles_default_idx
  on workspace_roles (workspace_id)
  where deleted_at is null and is_default;

-- One row per role and domain. A domain with no row grants nothing, so an
-- absent row and a zero mean the same thing and the resolver needs no
-- coalesce beyond the one it already has.
create table role_permissions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  role_id uuid not null references workspace_roles(id) on delete cascade,
  -- An access context's resource_type. Not an enum: a resource type added by
  -- a later phase must not need a migration here before a role can speak
  -- about it, and an unknown domain simply matches no context.
  domain text not null,
  -- 0, 10, 40, 70 or 100. Written out rather than referenced, because the
  -- constant lives in TypeScript and a database check cannot read it.
  level integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint role_permissions_level_known
    check (level in (0, 10, 40, 70, 100))
);

create unique index role_permissions_role_domain_idx
  on role_permissions (workspace_id, role_id, domain)
  where deleted_at is null;

-- Which role a member holds. Nullable, and null means exactly what it meant
-- before this migration: the member holds whatever bindings reach them and
-- nothing more. A guest and an agent stay null for good.
alter table workspace_members
  add column role_id uuid references workspace_roles(id) on delete set null;

create index workspace_members_role_idx
  on workspace_members (workspace_id, role_id)
  where deleted_at is null and role_id is not null;

-- Tenant floor on both new tables. `workspace_members` carries its own from
-- migration 0005 and a new column inherits it.
alter table workspace_roles enable row level security;
alter table workspace_roles force row level security;

create policy workspace_roles_tenant on workspace_roles
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

alter table role_permissions enable row level security;
alter table role_permissions force row level security;

create policy role_permissions_tenant on role_permissions
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
