-- A short identifier on every addressable row, now not null (plan 0.8.0 C1,
-- docs/design/short-ids.md, "The 0.8.0 step", approved by Akmal on 11
-- November 2026).
--
-- Migration 0163 added `short_id` to cycles, goals, key results, initiatives,
-- tasks, documents and sessions, nullable for one release so a rolling
-- upgrade from 0.6 could still insert (PLAN.md §5.1). Every write since 0.7.0
-- fills it, and data change 0034 fills the rows written before. This makes
-- the database say what every reader already assumes.
--
-- **The migrator runs 0034 first** when this instance never ran it, because
-- this file declares that it needs it (the line below). 0034 runs in its own
-- batches and transactions before this one opens, so schema and data still
-- never share a statement. Without it, an instance upgrading straight from
-- 0.6, or one whose operator never ran the data changes, would refuse here,
-- and on Compose the container that would run 0034 is the one refusing to
-- start.
--
-- openokr:requires-data-change: 0034_short_ids
--
-- **The guard is a backstop**, as 0144's was, and should never fire: it names
-- each table still holding a row with no short id, which can only happen if
-- such a row arrived after 0034 finished. The count lifts FORCE ROW LEVEL
-- SECURITY on the seven tables for this transaction only, so the owner sees
-- every workspace's rows whatever role runs the migration: a guard that
-- counted under the tenant floor would see nothing. FORCE is restored before
-- the transaction ends, and a refusal rolls the lift back with everything
-- else.
do $$
declare
  waiting text := '';
  n bigint;
begin
  alter table cycles no force row level security;
  alter table goals no force row level security;
  alter table key_results no force row level security;
  alter table initiatives no force row level security;
  alter table tasks no force row level security;
  alter table documents no force row level security;
  alter table okr_sessions no force row level security;

  select count(*) into n from cycles where short_id is null;
  if n > 0 then waiting := waiting || format(' cycles (%s)', n); end if;
  select count(*) into n from goals where short_id is null;
  if n > 0 then waiting := waiting || format(' goals (%s)', n); end if;
  select count(*) into n from key_results where short_id is null;
  if n > 0 then waiting := waiting || format(' key_results (%s)', n); end if;
  select count(*) into n from initiatives where short_id is null;
  if n > 0 then waiting := waiting || format(' initiatives (%s)', n); end if;
  select count(*) into n from tasks where short_id is null;
  if n > 0 then waiting := waiting || format(' tasks (%s)', n); end if;
  select count(*) into n from documents where short_id is null;
  if n > 0 then waiting := waiting || format(' documents (%s)', n); end if;
  select count(*) into n from okr_sessions where short_id is null;
  if n > 0 then waiting := waiting || format(' okr_sessions (%s)', n); end if;

  alter table cycles force row level security;
  alter table goals force row level security;
  alter table key_results force row level security;
  alter table initiatives force row level security;
  alter table tasks force row level security;
  alter table documents force row level security;
  alter table okr_sessions force row level security;

  if waiting <> '' then
    raise exception using message = format(
      'Rows still have no short identifier, so nothing was changed. Rows waiting:%s. Data change 0034_short_ids is recorded as complete, so it will not run again by itself. Remove its ledger row (delete from _data_changes where name = ''0034_short_ids'') and start again: the migrator then runs it before this migration (docs/runbooks/upgrade.md, 0.7 to 0.8).',
      waiting);
  end if;
end $$;

alter table cycles alter column short_id set not null;
alter table goals alter column short_id set not null;
alter table key_results alter column short_id set not null;
alter table initiatives alter column short_id set not null;
alter table tasks alter column short_id set not null;
alter table documents alter column short_id set not null;
alter table okr_sessions alter column short_id set not null;
