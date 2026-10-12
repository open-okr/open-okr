-- KPI categories, KPIs and their records (TECHNICAL-PLAN.md §4.6, METHOD.md §6,
-- design `p3-t00-kpi-engine.md`, P3-T12).
--
-- The metrics module. A KPI is a measure that runs continuously, unlike a key
-- result which lives inside one cycle, and that difference is why it has its own
-- table rather than a flag on `key_results`.
--
-- `tree_id`, `formula`, `recovery_goal_id` and the calculated columns arrive with
-- their own tasks (P3-T13 the formula engine, P3-T14 trees and recovery). They
-- are declared here because the state machine reads them, and a column added
-- later would mean a second migration touching a table this one already defines.

create table kpi_categories (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name text not null,
  position integer not null default 0,
  legacy_type text,
  legacy_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table kpi_categories enable row level security;
alter table kpi_categories force row level security;

create policy tenant_isolation on kpi_categories
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create unique index kpi_categories_name_idx
  on kpi_categories (workspace_id, lower(name))
  where deleted_at is null;

create unique index kpi_categories_legacy_idx
  on kpi_categories (workspace_id, legacy_type, legacy_id)
  where legacy_id is not null;

create table kpis (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  short_id text not null,
  -- The tree is the parent pointer. No foreign key to a trees table: P3-T14
  -- decides whether a tree is a row of its own or the root of a parent chain,
  -- and inventing the table here would pre-empt that task's own design.
  tree_id uuid,
  category_id uuid references kpi_categories (id) on delete set null,
  parent_kpi_id uuid references kpis (id) on delete set null,
  title text not null,
  description jsonb,
  description_version integer,
  owner_kind text not null default 'workspace' check (
    owner_kind in ('workspace', 'space', 'member')
  ),
  space_id uuid references spaces (id) on delete set null,
  member_id uuid references workspace_members (id) on delete set null,
  frequency text not null check (
    frequency in ('daily', 'weekly', 'monthly', 'quarterly', 'yearly')
  ),
  unit text,
  direction text not null default 'higher_better' check (
    direction in ('higher_better', 'lower_better')
  ),
  indicator_type text not null default 'lagging' check (
    indicator_type in ('leading', 'lagging')
  ),
  tier text not null default 'output' check (
    tier in ('input', 'output', 'outcome', 'impact')
  ),
  target_default numeric,
  aggregate text not null default 'sum' check (
    aggregate in ('sum', 'avg', 'max', 'min', 'count')
  ),
  is_calculated boolean not null default false,
  formula jsonb,
  -- The corridor, per KPI, defaulting to the §11 registry values. Stored rather
  -- than resolved on every read because a KPI may deviate from the workspace
  -- corridor by design, and the grid colours thousands of cells from it.
  healthy_pct numeric(6, 2) not null default 90,
  watch_pct numeric(6, 2) not null default 70,
  -- Derived, written only by the recompute entry point.
  state text not null default 'no_data' check (
    state in ('healthy', 'watch', 'unhealthy', 'recovering', 'no_data')
  ),
  achievement_pct numeric(6, 2),
  effective_pct numeric(6, 2),
  recovery_goal_id uuid references goals (id) on delete set null,
  recovery_started_pct numeric(6, 2),
  starts_on date,
  ends_on date,
  position integer not null default 0,
  legacy_type text,
  legacy_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- An owner that agrees with its kind, the same invariant goals carry.
  constraint kpis_owner_matches_kind check (
    (owner_kind = 'workspace' and space_id is null and member_id is null)
    or (owner_kind = 'space' and space_id is not null and member_id is null)
    or (owner_kind = 'member' and member_id is not null and space_id is null)
  ),
  -- A KPI cannot be its own parent. The corridor walk at P3-T14 follows this
  -- chain, and a self-parent would hang it.
  constraint kpis_not_own_parent check (parent_kpi_id is null or parent_kpi_id <> id),
  -- The corridor reads from below in both bands, so watch must not sit above
  -- healthy or every KPI would land in `watch` and none in `healthy`.
  constraint kpis_corridor_ordered check (watch_pct <= healthy_pct),
  -- A calculated KPI has a formula, and a formula belongs to a calculated KPI.
  -- Either half alone is a KPI nobody can compute or a formula nobody runs.
  constraint kpis_formula_matches_calculated check (
    (is_calculated = true and formula is not null)
    or (is_calculated = false and formula is null)
  )
);

alter table kpis enable row level security;
alter table kpis force row level security;

create policy tenant_isolation on kpis
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create unique index kpis_short_id_idx on kpis (workspace_id, short_id)
  where deleted_at is null;

create unique index kpis_legacy_idx
  on kpis (workspace_id, legacy_type, legacy_id)
  where legacy_id is not null;

create index kpis_category_idx on kpis (workspace_id, category_id, position)
  where deleted_at is null;

create index kpis_parent_idx on kpis (workspace_id, parent_kpi_id)
  where deleted_at is null;

-- The recovery lookup at P3-T14: every KPI currently held in `recovering`.
create index kpis_recovering_idx on kpis (workspace_id)
  where state = 'recovering' and deleted_at is null;

-- One value per KPI per normalised period. The uniqueness is the whole point:
-- design §1 says "recording a second value for a period updates the row rather
-- than adding one, which is what makes the grid safe under two people typing at
-- once". A convention could not promise that; an index can.
create table kpi_records (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  kpi_id uuid not null references kpis (id) on delete cascade,
  period_start date not null,
  target_value numeric,
  actual_value numeric,
  remark text,
  author_member_id uuid not null references workspace_members (id),
  legacy_type text,
  legacy_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table kpi_records enable row level security;
alter table kpi_records force row level security;

create policy tenant_isolation on kpi_records
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- Not partial on `deleted_at`. A soft-deleted record still occupies its period:
-- if the index ignored it, re-recording that period would insert a second row
-- and the two would both be live the moment anybody restored the first.
create unique index kpi_records_period_idx
  on kpi_records (workspace_id, kpi_id, period_start);

create index kpi_records_kpi_idx
  on kpi_records (workspace_id, kpi_id, period_start desc)
  where deleted_at is null;

create unique index kpi_records_legacy_idx
  on kpi_records (workspace_id, legacy_type, legacy_id)
  where legacy_id is not null;

-- Narrow sharing. Broad scoping uses the normal access bindings; this is for the
-- one person outside the space who needs to see or update a single KPI.
create table kpi_shares (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  kpi_id uuid not null references kpis (id) on delete cascade,
  member_id uuid not null references workspace_members (id) on delete cascade,
  access text not null check (access in ('read', 'update')),
  created_by_id uuid not null references workspace_members (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table kpi_shares enable row level security;
alter table kpi_shares force row level security;

create policy tenant_isolation on kpi_shares
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create unique index kpi_shares_one_per_member_idx
  on kpi_shares (workspace_id, kpi_id, member_id)
  where deleted_at is null;

-- The key result link from METHOD.md §6.5. `key_results.kpi_id` has been a plain
-- uuid column since P3-T04, waiting for this table.
alter table key_results
  add constraint key_results_kpi_fk
  foreign key (kpi_id) references kpis (id) on delete set null;
