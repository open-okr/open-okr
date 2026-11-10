-- A short identifier on every addressable aggregate (docs/design/short-ids.md,
-- plan 0.7.0 D1, approved by Akmal on 10 November 2026).
--
-- TECHNICAL-PLAN §3 gives cycles, goals, key results, KPIs, initiatives,
-- tasks, documents and sessions a `short_id`: ten base58 characters, random,
-- unique per workspace. Only `kpis` had one (migration 0026). This adds it to
-- the other seven.
--
-- **Nullable in this release, on purpose** (S3, PLAN §5.1). During a rolling
-- upgrade a replica of 0.6 is still inserting rows, and it knows nothing of
-- this column. A not-null column added in the same release would refuse those
-- inserts. So every write of 0.7.0 fills it, data change 0034 fills the rows
-- written before (and any a 0.6 replica writes meanwhile), and 0.8.0's
-- migration makes it not null once every instance has run that data change.
--
-- **The index is not partial.** A deleted row keeps its short id, so restoring
-- it can never collide with a row made since, and a link to it never comes to
-- mean something else. The index allows any number of nulls, which is what the
-- rows waiting for the data change are.
--
-- Forward-only and additive: the previous release neither reads nor writes
-- the column. Each table keeps the tenant policy it already has, which a new
-- column does not touch.
alter table cycles add column short_id text;
alter table goals add column short_id text;
alter table key_results add column short_id text;
alter table initiatives add column short_id text;
alter table tasks add column short_id text;
alter table documents add column short_id text;
alter table okr_sessions add column short_id text;

create unique index cycles_short_id_idx on cycles (workspace_id, short_id);
create unique index goals_short_id_idx on goals (workspace_id, short_id);
create unique index key_results_short_id_idx
  on key_results (workspace_id, short_id);
create unique index initiatives_short_id_idx
  on initiatives (workspace_id, short_id);
create unique index tasks_short_id_idx on tasks (workspace_id, short_id);
create unique index documents_short_id_idx
  on documents (workspace_id, short_id);
create unique index okr_sessions_short_id_idx
  on okr_sessions (workspace_id, short_id);
