-- Goals, key results, their value history and the close retrospective
-- (TECHNICAL-PLAN.md §4.4, METHOD.md §2.5, §4, P3-T04).
--
-- The two objects the whole product is about. Three rules are enforced here
-- rather than left to application code, because each one is an invariant a bug
-- in any single write path could otherwise break:
--
--   1. A goal has at most one parent pointer (`num_nonnulls <= 1`). Cycle
--      rejection still needs a walk in the write action, but "two parents" can
--      never happen at all.
--   2. A goal sits in a cycle or carries its own timeframe, never both and
--      never neither, which is METHOD.md OBJ-3 as a check constraint.
--   3. `owner_kind` and the two owner columns agree. A goal owned by a space
--      with no `space_id`, or a workspace goal that also names a member, is not
--      a row this database will hold.
--
-- Closing is a state, not a flag: `closed_at` with an outcome and a decision,
-- and the check constraint refuses a close with either one missing. METHOD.md
-- §8.8 asks for keep, modify or abandon on every closed goal, and a close that
-- skipped it would leave the next cycle's feed-forward with nothing to read.
--
-- `kpi_id` is a plain uuid: KPIs arrive at P3-T12, the same way this table's own
-- id waited inside `cycle_prior_scores` through P3-T03.

create table goals (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  title text not null,
  -- Editor JSON with its version, never Markdown.
  description jsonb,
  description_version integer,
  -- Exactly one of the two: a cycle goal, or a contextual one with its own
  -- window. §4.1: "a goal with neither fails OBJ-3".
  cycle_id uuid references cycles (id) on delete set null,
  timeframe jsonb,
  level text not null check (level in ('company', 'department', 'team', 'individual')),
  owner_kind text not null check (owner_kind in ('workspace', 'space', 'member')),
  space_id uuid references spaces (id) on delete set null,
  member_id uuid references workspace_members (id) on delete set null,
  -- METHOD.md §2.5: "exactly one per goal. Never a team, never a committee."
  champion_id uuid not null references workspace_members (id),
  reviewer_id uuid not null references workspace_members (id),
  parent_goal_id uuid references goals (id) on delete set null,
  -- No foreign key yet in the other direction: key_results is created below and
  -- the constraint is added after it exists.
  parent_key_result_id uuid,
  weight numeric(6, 2) not null default 1 check (weight >= 0 and weight <= 100),
  check_in_frequency text check (
    check_in_frequency is null
    or check_in_frequency in ('daily', 'weekly', 'biweekly', 'monthly')
  ),
  next_check_in_at timestamptz,
  last_check_in_id uuid,
  contribution_statement text,
  closed_at timestamptz,
  closed_by_id uuid references workspace_members (id),
  success_status text check (success_status is null or success_status in ('achieved', 'missed')),
  close_decision text check (
    close_decision is null or close_decision in ('keep', 'modify', 'abandon')
  ),
  close_reason text,
  -- Derived. Written by the recompute path, never by a form.
  progress_pct numeric(5, 2) not null default 0,
  health text not null default 'pending' check (
    health in (
      'pending',
      'on_track',
      'caution',
      'off_track',
      'outdated',
      'achieved',
      'missed'
    )
  ),
  quality_score smallint,
  quality_flags jsonb not null default '[]'::jsonb,
  ai_generated boolean not null default false,
  position integer not null default 0,
  legacy_type text,
  legacy_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint goals_single_parent check (
    num_nonnulls (parent_goal_id, parent_key_result_id) <= 1
  ),
  constraint goals_one_timeframe check (num_nonnulls (cycle_id, timeframe) = 1),
  constraint goals_owner_matches_kind check (
    (owner_kind = 'workspace' and space_id is null and member_id is null)
    or (owner_kind = 'space' and space_id is not null and member_id is null)
    or (owner_kind = 'member' and member_id is not null and space_id is null)
  ),
  -- A close carries its outcome and its decision, or it is not a close.
  constraint goals_close_is_complete check (
    (
      closed_at is null
      and success_status is null
      and close_decision is null
    )
    or (
      closed_at is not null
      and success_status is not null
      and close_decision is not null
    )
  ),
  -- A closed goal reads its outcome, never a live status.
  constraint goals_closed_health check (
    (closed_at is null and health not in ('achieved', 'missed'))
    or (closed_at is not null and health in ('achieved', 'missed'))
  )
);

alter table goals enable row level security;
alter table goals force row level security;

create policy tenant_isolation on goals
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create index goals_cycle_idx on goals (workspace_id, cycle_id) where deleted_at is null;

create index goals_champion_idx on goals (workspace_id, champion_id) where deleted_at is null;

create index goals_reviewer_idx on goals (workspace_id, reviewer_id) where deleted_at is null;

create index goals_parent_goal_idx on goals (parent_goal_id) where deleted_at is null;

create index goals_parent_key_result_idx on goals (parent_key_result_id) where deleted_at is null;

create index goals_space_idx on goals (workspace_id, space_id) where deleted_at is null;

-- Open goals only. Every list, count and alignment walk starts here, and an
-- archive of closed goals should not slow one down.
create index goals_open_idx on goals (workspace_id, level)
where
  deleted_at is null
  and closed_at is null;

-- Import idempotency (TECHNICAL-PLAN §7.2): a second run of the same source
-- updates rather than duplicates.
create unique index goals_legacy_idx on goals (workspace_id, legacy_type, legacy_id)
where
  legacy_id is not null
  and deleted_at is null;

create table key_results (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  goal_id uuid not null references goals (id) on delete cascade,
  title text not null,
  unit text,
  direction text not null check (
    direction in ('increase', 'reduce', 'maintain', 'move')
  ),
  -- METHOD.md KR-4 fails an untagged key result, so this is not nullable: a
  -- key result nobody classified is a key result nobody can weigh.
  indicator_type text not null check (indicator_type in ('leading', 'lagging')),
  baseline_value numeric(18, 4) not null,
  target_value numeric(18, 4) not null,
  -- Defaults to the baseline on create, so progress starts at 0 rather than
  -- undefined (§5.1).
  current_value numeric(18, 4) not null,
  due_on date,
  owner_id uuid references workspace_members (id),
  weight numeric(6, 2) not null default 1 check (weight >= 0 and weight <= 100),
  -- No foreign key: KPIs arrive at P3-T12.
  kpi_id uuid,
  capacity text check (capacity is null or capacity in ('fits', 'tight', 'exceeds')),
  progress_pct numeric(5, 2) not null default 0,
  confidence numeric(3, 2) check (
    confidence is null
    or (confidence >= 0 and confidence <= 1)
  ),
  forecast jsonb,
  score numeric(3, 2) check (score is null or (score >= 0 and score <= 1)),
  carry_forward boolean not null default false,
  quality_flags jsonb not null default '[]'::jsonb,
  position integer not null default 0,
  legacy_type text,
  legacy_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table key_results enable row level security;
alter table key_results force row level security;

create policy tenant_isolation on key_results
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create index key_results_goal_idx on key_results (workspace_id, goal_id, position)
where
  deleted_at is null;

create index key_results_owner_idx on key_results (workspace_id, owner_id) where deleted_at is null;

create index key_results_kpi_idx on key_results (workspace_id, kpi_id)
where
  kpi_id is not null
  and deleted_at is null;

create unique index key_results_legacy_idx on key_results (workspace_id, legacy_type, legacy_id)
where
  legacy_id is not null
  and deleted_at is null;

-- The other half of the alignment pointer, now that both tables exist.
alter table goals
add constraint goals_parent_key_result_fk foreign key (parent_key_result_id) references key_results (id) on delete set null;

-- §5.2: "every change to `current_value` writes a row. There is no path that
-- updates the current value without one." Append-only in practice, though not
-- enforced as such: a mistyped value is corrected by recording the correction.
create table key_result_values (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  key_result_id uuid not null references key_results (id) on delete cascade,
  value numeric(18, 4) not null,
  at timestamptz not null default now(),
  author_member_id uuid references workspace_members (id),
  -- No foreign key: check_ins arrive at P3-T07.
  check_in_id uuid,
  source text not null check (
    source in ('manual', 'check_in', 'kpi', 'import', 'agent')
  ),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table key_result_values enable row level security;
alter table key_result_values force row level security;

create policy tenant_isolation on key_result_values
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- Newest first is how a sparkline and a trend forecast both read it.
create index key_result_values_history_idx on key_result_values (workspace_id, key_result_id, at desc)
where
  deleted_at is null;

-- §4.3: created at close, editable, and kept when the goal reopens. One per
-- goal, so reopening and closing again edits the same record rather than
-- stacking two accounts of the same goal.
create table goal_retrospectives (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  goal_id uuid not null references goals (id) on delete cascade,
  body jsonb not null,
  body_version integer not null,
  author_member_id uuid references workspace_members (id),
  ai_drafted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table goal_retrospectives enable row level security;
alter table goal_retrospectives force row level security;

create policy tenant_isolation on goal_retrospectives
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create unique index goal_retrospectives_goal_idx on goal_retrospectives (workspace_id, goal_id)
where
  deleted_at is null;

-- The three P3-T03 columns that were waiting for these tables. Added now that
-- the targets exist, which is what that migration's comment promised.
alter table cycle_prior_scores
add constraint cycle_prior_scores_source_key_result_fk foreign key (source_key_result_id) references key_results (id) on delete set null;

alter table cycle_focus_key_results
add constraint cycle_focus_key_results_key_result_fk foreign key (annual_key_result_id) references key_results (id) on delete cascade;

alter table cycle_priorities
add constraint cycle_priorities_promoted_goal_fk foreign key (promoted_to_goal_id) references goals (id) on delete set null;
