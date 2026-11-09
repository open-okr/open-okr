-- The latest alignment score per scope per cycle (docs/design/alignment-engine.md
-- §10, plan 0.7.0 D2, approved by Akmal on 9 November 2026).
--
-- `recomputeAlignment` already computes the METHOD.md §5.2 share inside every
-- structural write and used to drop it, so the Work Map computed the whole
-- graph again on every load. It now stores the answer in the same transaction
-- as the findings, and `alignment.score` reads one row.
--
-- **The band is not stored** (D3). It is read from the score, `anchored` and
-- the cycle's §11 thresholds when the row is read, so a workspace that moves
-- its bands sees the new band at once. A null score is §5.2's "no score": a
-- scope with nothing below company level.
--
-- `breakdown` holds the counts the share is made of: `measured` (goals below
-- company level), `withParent`, `standingAlone` (no parent, a reason),
-- `unaligned`, and `anchored` (a company-level objective anchors the cycle,
-- always true at space scope), which the band needs.
--
-- openokr:hard-delete: a projection, not a record. A recompute replaces the
-- row and nothing restores an old one; the activity log is the history of
-- the structural changes that moved it.
--
-- Forward-only and safe for a rolling upgrade: a new table the previous
-- release names nowhere. The tenant policy ships in the same migration. Rows
-- for cycles planned before this release are written by the hourly fill and
-- `pnpm alignment:fill`, and computed on read until then.
create table alignment_scores (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  cycle_id uuid not null references cycles(id) on delete cascade,
  scope text not null check (scope in ('workspace', 'space')),
  -- Null at workspace scope, the space id at space scope.
  scope_id uuid references spaces(id) on delete cascade,
  score smallint check (score between 0 and 100),
  breakdown jsonb not null,
  computed_at timestamptz not null default now(),
  constraint alignment_scores_scope_agrees check (
    (scope = 'workspace' and scope_id is null)
    or (scope = 'space' and scope_id is not null)
  )
);

-- One row per scope per cycle. Nulls not distinct, so the workspace scope's
-- null `scope_id` is one row rather than a new one on every recompute.
create unique index alignment_scores_scope_idx
  on alignment_scores (workspace_id, cycle_id, scope, scope_id)
  nulls not distinct;

alter table alignment_scores enable row level security;
alter table alignment_scores force row level security;

create policy tenant_isolation on alignment_scores
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
