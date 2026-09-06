-- Import runs (TECHNICAL-PLAN §4.13 and §7.1 step 7, P6-T01a).
--
-- **A row per run, including the ones that failed and the ones that wrote
-- nothing.** §7.1's last step asks for counts per table, skips with reasons,
-- lossy items and a reconciliation, and says a dry run produces the same
-- report without writing. A report that exists only in a terminal is a report
-- nobody can go back to: the person who ran the dry run is often not the person
-- who asks, an hour later, what it said it would do.
--
-- **`source` carries `flowyteam` from the first row.** P6-T02 imports a
-- FlowyTeam company through the same pipeline and the same lifecycle. Giving it
-- a discriminator now costs one column and saves a second table with the same
-- three states in it, the way `export_runs.kind` did for the Phase 7 archive.
--
-- **`entity` is nullable, and that is the difference between the two sources.**
-- A spreadsheet run loads one entity, named here, because a file holds one
-- kind of thing. A FlowyTeam run loads a company across every domain in
-- dependency order, so it names none.
--
-- **`mode` is on the row rather than inferred from the counts.** A real run
-- that wrote nothing and a dry run that would have written nothing produce the
-- same numbers, and they are not the same event.
--
-- **`report` is jsonb rather than columns.** Its shape belongs to the importer
-- and it differs per source: a spreadsheet run reports per-row errors against
-- line numbers, and a FlowyTeam run reports per-table reconciliation. Freezing
-- either into columns here would make the table the thing that has to change
-- when a mapper learns to say something new.

-- openokr:soft-delete: a run is the record that an import happened, and
-- deleting the row while the imported data stays would leave the workspace
-- holding rows nothing accounts for.
create table import_runs (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  source text not null check (source in ('csv', 'flowyteam')),
  -- Which entity template a spreadsheet run loaded. Free text rather than an
  -- enum: the templates live in `packages/importer` and a check constraint
  -- here would be a second list to keep in step.
  entity text,
  mode text not null check (mode in ('dry_run', 'real')),
  status text not null default 'running' check (
    status in ('running', 'completed', 'failed')
  ),
  -- What the file was called, for the person reading the list rather than for
  -- the machine. Null for a source that is not a file.
  filename text,
  rows_read integer not null default 0,
  rows_written integer not null default 0,
  rows_skipped integer not null default 0,
  report jsonb not null default '{}'::jsonb,
  -- Why the run failed as a whole, phrased for the person who ran it. A row
  -- that could not be read is a skip inside `report`, not this.
  error text,
  requested_by_id uuid not null references workspace_members (id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table import_runs enable row level security;
alter table import_runs force row level security;

create policy tenant_isolation on import_runs
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- The one read this table has: this workspace's runs, newest first.
create index import_runs_recent_idx
  on import_runs (workspace_id, started_at desc)
  where deleted_at is null;
