-- Named KPI driver trees, and the one column the recovery loop was missing
-- (TECHNICAL-PLAN.md §4.6, METHOD.md §6.3 and §6.5, design `p3-t00-kpi-engine.md`
-- §8 and §9, P3-T14).
--
-- 0026 left `kpis.tree_id` as a bare uuid with a comment saying P3-T14 decides
-- whether a tree is a row of its own or just the root of a parent chain.
-- TECHNICAL-PLAN.md §4.6 answers it: `kpi_trees` is a table, because a tree has
-- a name and a description of its own and a workspace may have several. The
-- parent chain still describes the shape inside one tree; the row describes the
-- tree itself.

create table kpi_trees (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name text not null,
  description jsonb,
  description_version integer,
  -- The root is a KPI in this same tree. Nullable, because a tree is named and
  -- created before anybody has decided what sits at the top of it, and a tree
  -- that cannot exist until its root does would have to be built backwards.
  root_kpi_id uuid references kpis (id) on delete set null,
  position integer not null default 0,
  legacy_type text,
  legacy_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table kpi_trees enable row level security;
alter table kpi_trees force row level security;

create policy tenant_isolation on kpi_trees
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create unique index kpi_trees_name_idx
  on kpi_trees (workspace_id, lower(name))
  where deleted_at is null;

create unique index kpi_trees_legacy_idx
  on kpi_trees (workspace_id, legacy_type, legacy_id)
  where legacy_id is not null;

-- The pointer 0026 declared without a target now has one.
alter table kpis
  add constraint kpis_tree_id_fkey
  foreign key (tree_id) references kpi_trees (id) on delete set null;

create index kpis_tree_idx on kpis (workspace_id, tree_id)
  where deleted_at is null;

-- §6.5 closes the loop the other way: when real achievement re-enters the
-- healthy corridor the coach proposes closing the recovery goal, **exactly
-- once**. "Exactly once" needs somewhere to remember that it happened, and the
-- alternative, a row in `proposed_changes`, needs an `agent_runs` row to hang
-- off. No agent runs in Phase 3, and inventing one to record a fact would be
-- fabricating an agent. The stamp is the fact; P4-T06 turns it into a message
-- with a rule key. Cleared whenever a recovery is launched or closed, so a
-- second recovery on the same KPI proposes its own closure.
alter table kpis add column recovery_close_proposed_at timestamptz;
