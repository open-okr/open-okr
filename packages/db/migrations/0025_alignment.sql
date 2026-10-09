-- Alignment: horizontal links, the dependency register and the findings table
-- (TECHNICAL-PLAN.md §4.5, METHOD.md §5, design `p3-t00-alignment-engine.md`,
-- P3-T09).
--
-- Vertical alignment already exists: `goals.parent_goal_id` and
-- `goals.parent_key_result_id` shipped with the goal at P3-T04, with a check
-- constraint allowing at most one of them. This migration adds the horizontal
-- half and the score's output.

-- A link between two goals in different teams. METHOD.md §5.1 calls it "two-way
-- by meaning", and it is stored once rather than twice: a second row saying the
-- same thing backwards is a second thing to keep in step, and the reader of a
-- dependency asks "is there a link between these two", never "which end was
-- typed first".
create table goal_dependencies (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  from_goal_id uuid not null references goals (id) on delete cascade,
  to_goal_id uuid not null references goals (id) on delete cascade,
  note text,
  created_by_id uuid not null references workspace_members (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- A goal cannot depend on itself. Stored in the database rather than checked in
  -- the service, because the alignment engine treats a self-link as a link that
  -- clears a silo, and one forgotten path would let a department clear its own
  -- silo finding by depending on itself.
  constraint goal_dependencies_not_self check (from_goal_id <> to_goal_id)
);

alter table goal_dependencies enable row level security;
alter table goal_dependencies force row level security;

create policy tenant_isolation on goal_dependencies
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- The pair, in canonical order, so "already linked" is a database fact rather
-- than two queries. The service sorts the two ids before writing.
create unique index goal_dependencies_pair_idx
  on goal_dependencies (workspace_id, from_goal_id, to_goal_id)
  where deleted_at is null;

create index goal_dependencies_to_idx
  on goal_dependencies (workspace_id, to_goal_id)
  where deleted_at is null;

-- The dependency register (METHOD.md §5.4). Every dependency records the key
-- result that depends, the providing team, whether that team has confirmed, and
-- if not, a named risk owner. Unconfirmed and unowned blocks publish gate 4.
--
-- `provider_space_id` and `provider_text` are both optional and neither replaces
-- the other. A team inside the workspace is a space; a supplier, a regulator or
-- a team that has not joined yet is a piece of text. Only the first can clear a
-- silo finding, because only the first names something the engine can find.
create table key_result_dependencies (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  key_result_id uuid not null references key_results (id) on delete cascade,
  provider_space_id uuid references spaces (id) on delete set null,
  provider_text text,
  note text,
  confirmed boolean not null default false,
  confirmed_by_id uuid references workspace_members (id),
  confirmed_at timestamptz,
  risk_owner_id uuid references workspace_members (id),
  created_by_id uuid not null references workspace_members (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- A dependency names a provider one way or the other. A register entry that
  -- says something is depended on but not on whom is not a register entry.
  constraint key_result_dependencies_has_provider check (
    provider_space_id is not null
    or nullif(btrim(coalesce(provider_text, '')), '') is not null
  ),
  -- A confirmation carries who confirmed it and when. §5.4 makes confirmation
  -- the providing team's act, so an unattributed one is not one.
  constraint key_result_dependencies_confirmation_is_attributed check (
    confirmed = false
    or (confirmed_by_id is not null and confirmed_at is not null)
  )
);

alter table key_result_dependencies enable row level security;
alter table key_result_dependencies force row level security;

create policy tenant_isolation on key_result_dependencies
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create index key_result_dependencies_key_result_idx
  on key_result_dependencies (workspace_id, key_result_id)
  where deleted_at is null;

-- Gate 4's own query: everything unconfirmed and unowned in one scan.
create index key_result_dependencies_open_risk_idx
  on key_result_dependencies (workspace_id)
  where confirmed = false
    and risk_owner_id is null
    and deleted_at is null;

-- Findings, structural and semantic, in one table so the interface is one list.
--
-- **Decision D-16, approved at the design gate and settled here.**
-- `subject_goal_id` is nullable. The anchor finding ("no company-level objective
-- anchors the tree") has no subject, because no goal caused it: it is the
-- absence of one. TECHNICAL-PLAN.md §4.5 listed the column without a nullable
-- marker, and is corrected in the same change as this migration. The alternative
-- considered and rejected was attaching the finding to an arbitrary goal that is
-- not responsible for it, which would send a facilitator to fix the wrong thing.
create table alignment_findings (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  scope text not null check (scope in ('workspace', 'space')),
  -- Null at workspace scope, the space id at space scope.
  scope_id uuid references spaces (id) on delete cascade,
  cycle_id uuid not null references cycles (id) on delete cascade,
  kind text not null check (
    kind in ('structure', 'relink', 'dependency', 'conflict', 'gap')
  ),
  severity text not null check (severity in ('high', 'medium', 'low')),
  subject_goal_id uuid references goals (id) on delete cascade,
  target_goal_id uuid references goals (id) on delete cascade,
  reason text not null,
  rule_key text,
  -- `engine` is this task. `coach` is P4-T03's semantic sweep. The engine filters
  -- on this before it deletes anything, so a structural recompute cannot wipe the
  -- Coach's work every time somebody edits a weight.
  source text not null default 'engine' check (source in ('engine', 'coach')),
  state text not null default 'open' check (
    state in ('open', 'applied', 'dismissed')
  ),
  decided_by_id uuid references workspace_members (id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- A decision carries who made it and when, the same way a confirmation does.
  constraint alignment_findings_decision_is_attributed check (
    state = 'open'
    or (decided_by_id is not null and decided_at is not null)
  ),
  -- Scope and its identifier agree. A workspace-scoped finding with a space id
  -- would be counted twice by the surface that groups by scope.
  constraint alignment_findings_scope_agrees check (
    (scope = 'workspace' and scope_id is null)
    or (scope = 'space' and scope_id is not null)
  )
);

alter table alignment_findings enable row level security;
alter table alignment_findings force row level security;

create policy tenant_isolation on alignment_findings
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- Finding identity (design §6): a structural finding is re-derived on every
-- recompute, so it needs a stable identity or each run would either duplicate it
-- or resurrect a dismissal. `coalesce` on the two nullable goal columns because
-- a unique index treats two nulls as distinct, which would let the anchor
-- finding be inserted once per recompute forever.
create unique index alignment_findings_identity_idx
  on alignment_findings (
    workspace_id,
    scope,
    coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid),
    cycle_id,
    coalesce(rule_key, ''),
    coalesce(subject_goal_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(target_goal_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where source = 'engine' and deleted_at is null;

-- The studio's own read: one cycle's open findings.
create index alignment_findings_cycle_idx
  on alignment_findings (workspace_id, cycle_id, state)
  where deleted_at is null;

create index alignment_findings_subject_idx
  on alignment_findings (workspace_id, subject_goal_id)
  where deleted_at is null;
