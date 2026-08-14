-- Performance snapshots, and the points layer that stays off (TECHNICAL-PLAN.md
-- §4.6, METHOD.md §8.9, P3-T15).
--
-- 0029 is deliberately skipped here: it belongs to P3-T16's comments and
-- reactions, agreed up front in `PHASE-4-SPLIT.md` so two people adding a
-- migration in the same week do not both pick the same number.
--
-- A snapshot is written when a cycle is archived and never imported: it is
-- derived from the scores, and a legacy figure would be a number nobody in this
-- product can explain.

create table performance_snapshots (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  cycle_id uuid not null references cycles (id) on delete cascade,
  owner_kind text not null check (
    owner_kind in ('workspace', 'space', 'member')
  ),
  space_id uuid references spaces (id) on delete cascade,
  member_id uuid references workspace_members (id) on delete cascade,
  -- The average score across the key results in scope, 0.00 to 1.00.
  result_value numeric(3, 2),
  -- §3.3's four bands as counts. Four columns rather than one jsonb, because a
  -- trend across cycles reads them as numbers and a chart should not have to
  -- unpack a document per row.
  fully_achieved_count integer not null default 0,
  strong_count integer not null default 0,
  partial_count integer not null default 0,
  little_count integer not null default 0,
  -- §3.4's portfolio verdict. Null when nothing was scored, which is a real
  -- answer: a cycle nobody scored has no verdict rather than a bad one.
  verdict text check (
    verdict in ('too_safe', 'healthy', 'partial', 'outran_capacity')
  ),
  -- The owner has to agree with its kind, the same invariant `goals` and `kpis`
  -- carry, because an owner_kind nobody enforces is a column that lies.
  constraint performance_snapshots_owner_agrees check (
    (owner_kind = 'workspace' and space_id is null and member_id is null)
    or (owner_kind = 'space' and space_id is not null and member_id is null)
    or (owner_kind = 'member' and member_id is not null and space_id is null)
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table performance_snapshots enable row level security;
alter table performance_snapshots force row level security;

create policy tenant_isolation on performance_snapshots
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- One snapshot per owner per cycle, so archiving twice updates rather than
-- doubling the trend. Coalesced because two nulls read as distinct to a unique
-- index, which is the same trap `alignment_findings` fell into at P3-T09.
create unique index performance_snapshots_owner_idx
  on performance_snapshots (
    workspace_id,
    cycle_id,
    owner_kind,
    coalesce(space_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(member_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- The points layer. Off by default and with no rows unless somebody turns it
-- on, which REQUIREMENTS.md words as a paid-tier question nobody has answered.
-- The table exists so the switch has something to switch, not so the product
-- starts counting points.
create table scorecard_settings (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  enabled boolean not null default false,
  -- What each contribution is worth. Empty until somebody enables the layer.
  points jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table scorecard_settings enable row level security;
alter table scorecard_settings force row level security;

create policy tenant_isolation on scorecard_settings
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create unique index scorecard_settings_workspace_idx
  on scorecard_settings (workspace_id)
  where deleted_at is null;

create table score_entries (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  member_id uuid not null references workspace_members (id) on delete cascade,
  cycle_id uuid references cycles (id) on delete set null,
  points integer not null default 0,
  reason text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table score_entries enable row level security;
alter table score_entries force row level security;

create policy tenant_isolation on score_entries
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create index score_entries_member_idx
  on score_entries (workspace_id, member_id)
  where deleted_at is null;
