-- The guided cycle workflow: the eight phases as rows (TECHNICAL-PLAN.md §4.3,
-- METHOD.md §2, P3-T03).
--
-- Every table here is a phase's evidence. METHOD.md §2.3 is emphatic that phase
-- completion "is not self-reported": the product computes it from these rows, so
-- none of them holds a "phase 2 complete" boolean. The same goes for the six
-- publish gates, which is why `cycle_gate_state` stores an evaluation with its
-- detail rather than a decision somebody made.
--
-- Three columns point at tables that do not exist yet (goals and key results
-- arrive at P3-T04). They are plain uuid columns with no foreign key, the same
-- way `access_groups.space_id` waited for spaces through P2-T01, and the
-- reference is enforced when the target lands.

-- METHOD.md §2.6: the seven input-pack items, "the single most common failure
-- point in an OKR programme". One row per item per cycle rather than seven
-- booleans on the cycle, so each carries its own note and its own gathered flag.
create table cycle_pack_items (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  cycle_id uuid not null references cycles (id) on delete cascade,
  item_key smallint not null check (item_key between 1 and 7),
  gathered boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table cycle_pack_items enable row level security;
alter table cycle_pack_items force row level security;

create policy tenant_isolation on cycle_pack_items
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create unique index cycle_pack_items_unique_idx
  on cycle_pack_items (workspace_id, cycle_id, item_key)
  where deleted_at is null;

-- Phase 2's scoring of the previous cycle. Auto-populated at the previous
-- cycle's close (P3-T15), and editable in the room during the scoring reveal.
create table cycle_prior_scores (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  cycle_id uuid not null references cycles (id) on delete cascade,
  -- No foreign key: key_results arrive at P3-T04. A prior score also outlives
  -- the key result it came from, since the text is snapshotted here.
  source_key_result_id uuid,
  text text not null,
  score numeric(3, 2) check (score is null or (score >= 0 and score <= 1)),
  note text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table cycle_prior_scores enable row level security;
alter table cycle_prior_scores force row level security;

create policy tenant_isolation on cycle_prior_scores
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create index cycle_prior_scores_cycle_idx
  on cycle_prior_scores (workspace_id, cycle_id, position)
  where deleted_at is null;

-- Phase 2's KPI reading, in the three columns METHOD.md §8.5 names: what is
-- stable, what is declining, and what is fine as business as usual. One row per
-- cycle. Rich text, because this is a paragraph a facilitator writes.
create table cycle_baseline_health (
  cycle_id uuid primary key references cycles (id) on delete cascade,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  stable jsonb,
  stable_version integer,
  declining jsonb,
  declining_version integer,
  business_as_usual jsonb,
  business_as_usual_version integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table cycle_baseline_health enable row level security;
alter table cycle_baseline_health force row level security;

create policy tenant_isolation on cycle_baseline_health
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- Phase 3's priorities, before the issues that point at them, because an issue
-- may be promoted into one and the reference has to exist.
create table cycle_priorities (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  cycle_id uuid not null references cycles (id) on delete cascade,
  text text not null,
  -- METHOD.md §2.3: an annual phase 3 completes only when each priority carries
  -- a twelve-month success statement. Nullable so a draft can exist mid-session.
  success_statement text,
  position integer not null default 0,
  -- No foreign key: goals arrive at P3-T04.
  promoted_to_goal_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table cycle_priorities enable row level security;
alter table cycle_priorities force row level security;

create policy tenant_isolation on cycle_priorities
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create index cycle_priorities_cycle_idx
  on cycle_priorities (workspace_id, cycle_id, position)
  where deleted_at is null;

-- Phase 2's ranked strategic issues. `source` records where one came from,
-- because a carried-forward issue and one somebody raised in the room are read
-- differently, and the feed-forward mapping (METHOD.md §8.9) writes the first.
create table cycle_issues (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  cycle_id uuid not null references cycles (id) on delete cascade,
  text text not null,
  impact smallint not null default 3 check (impact between 1 and 5),
  source text not null default 'manual'
    check (source in ('manual', 'carry_forward', 'process_health', 'coach')),
  promoted_to_priority_id uuid references cycle_priorities (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table cycle_issues enable row level security;
alter table cycle_issues force row level security;

create policy tenant_isolation on cycle_issues
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- Ranked by impact, which is what the phase 2 surface reorders live on.
create index cycle_issues_cycle_idx
  on cycle_issues (workspace_id, cycle_id, impact desc)
  where deleted_at is null;

-- The quarterly phase 3: the frame is revalidated, never rewritten (§2.1). One
-- row per cycle, recording that it either holds or changed with a reason.
create table cycle_revalidations (
  cycle_id uuid primary key references cycles (id) on delete cascade,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  holds boolean not null default false,
  changed boolean not null default false,
  change_note text,
  focus_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table cycle_revalidations enable row level security;
alter table cycle_revalidations force row level security;

create policy tenant_isolation on cycle_revalidations
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- Which annual key results this quarter has to move. The reference waits for
-- P3-T04 like the others.
create table cycle_focus_key_results (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  cycle_id uuid not null references cycles (id) on delete cascade,
  annual_key_result_id uuid not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table cycle_focus_key_results enable row level security;
alter table cycle_focus_key_results force row level security;

create policy tenant_isolation on cycle_focus_key_results
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create unique index cycle_focus_key_results_unique_idx
  on cycle_focus_key_results (workspace_id, cycle_id, annual_key_result_id)
  where deleted_at is null;

-- METHOD.md §5.5: what was cut. Required to pass publish gate 5, because "if the
-- answer is nothing, capacity was not checked".
create table cycle_capacity_notes (
  cycle_id uuid primary key references cycles (id) on delete cascade,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  cuts jsonb,
  cuts_version integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table cycle_capacity_notes enable row level security;
alter table cycle_capacity_notes force row level security;

create policy tenant_isolation on cycle_capacity_notes
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- The six publish gates (METHOD.md §4.5), recomputed on every write that could
-- change one. Never a boolean somebody sets: `detail` carries what is missing,
-- so the refusal can name it.
create table cycle_gate_state (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  cycle_id uuid not null references cycles (id) on delete cascade,
  gate_key smallint not null check (gate_key between 1 and 6),
  passed boolean not null default false,
  -- Distinct from `passed = false`: a gate whose input does not exist yet has
  -- not failed, it cannot answer. Publication is blocked either way, which is
  -- the safe direction, and the surface says which it is.
  evaluable boolean not null default true,
  evaluated_at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table cycle_gate_state enable row level security;
alter table cycle_gate_state force row level security;

create policy tenant_isolation on cycle_gate_state
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create unique index cycle_gate_state_unique_idx
  on cycle_gate_state (workspace_id, cycle_id, gate_key)
  where deleted_at is null;

-- METHOD.md §7.6: the mid-cycle calibration, at most one per cycle. The unique
-- index is what makes "a calibration beyond the first is refused" true in the
-- database rather than only in a check somebody remembered to write.
create table cycle_calibrations (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  cycle_id uuid not null references cycles (id) on delete cascade,
  used boolean not null default true,
  reason text not null,
  at timestamptz not null default now(),
  author_member_id uuid references workspace_members (id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table cycle_calibrations enable row level security;
alter table cycle_calibrations force row level security;

create policy tenant_isolation on cycle_calibrations
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create unique index cycle_calibrations_one_per_cycle_idx
  on cycle_calibrations (workspace_id, cycle_id)
  where deleted_at is null;
