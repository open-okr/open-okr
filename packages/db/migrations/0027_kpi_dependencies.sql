-- The KPI formula dependency graph (TECHNICAL-PLAN.md §6.4, design
-- `p3-t00-kpi-engine.md` §7, P3-T13).
--
-- One row per formula edge: this calculated KPI references that one. The table
-- exists rather than being derived from the formula on every read because the
-- cascade walks it in the opposite direction, from a changed source to everything
-- downstream, and reading every formula in the workspace to answer "who depends
-- on this" would be a table scan per keystroke in the grid.
--
-- It is written by the same transaction that writes the formula, so the two
-- cannot drift: a formula without its edges would cascade to nothing.

create table kpi_dependencies (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  -- The calculated KPI whose formula holds the reference.
  dependent_kpi_id uuid not null references kpis (id) on delete cascade,
  -- The KPI it reads.
  depends_on_kpi_id uuid not null references kpis (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- A self-reference is refused here as well as in the service. §7 calls it a
  -- write-time refusal, and a constraint is the only version of that promise a
  -- forgotten code path cannot break. Longer cycles cannot be expressed as a
  -- single-row constraint, so the graph walk in the service handles those.
  constraint kpi_dependencies_not_self check (dependent_kpi_id <> depends_on_kpi_id)
);

alter table kpi_dependencies enable row level security;
alter table kpi_dependencies force row level security;

create policy tenant_isolation on kpi_dependencies
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create unique index kpi_dependencies_edge_idx
  on kpi_dependencies (workspace_id, dependent_kpi_id, depends_on_kpi_id)
  where deleted_at is null;

-- The cascade's own query: everything that depends on a KPI that just changed.
create index kpi_dependencies_depends_on_idx
  on kpi_dependencies (workspace_id, depends_on_kpi_id)
  where deleted_at is null;

-- The other direction, for rebuilding one KPI's edges when its formula changes.
create index kpi_dependencies_dependent_idx
  on kpi_dependencies (workspace_id, dependent_kpi_id)
  where deleted_at is null;

-- A calculated KPI's records carry which formula problem stopped them, so the
-- grid can say "a source is missing" rather than leaving an empty cell that looks
-- like nobody has got round to it yet.
alter table kpi_records
  add column diagnostic text check (
    diagnostic is null
    or diagnostic in ('missing_source', 'divide_by_zero', 'negative_target')
  );

comment on column kpi_records.diagnostic is
  'Why this period has no actual value, when a formula could not produce one (design §5).';
