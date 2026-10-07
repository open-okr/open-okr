-- The kind of key result, and when a milestone or a baseline was done
-- (METHOD.md §2.10, P9-T12b).
--
-- **Four kinds.** A metric moves a number from a baseline to a target; a
-- maintain holds one inside a band; a milestone is a verifiable thing done by
-- a date; a baseline establishes the number nobody measures yet. P9-T12a
-- taught the method all four; this is where a key result keeps its own.
--
-- **Every existing key result reads as a metric**, which is what it was. The
-- ones written as `direction = 'maintain'` are maintain key results, and the
-- data-change script `0017_key_result_kind_from_direction` says so, because a
-- backfill does not belong in a schema change. Until it runs nothing reads
-- differently: progress already treats a maintain direction as a band.
--
-- **`done_at`** is when a milestone was done or a baseline recorded. Null is
-- not yet, and is the only value a metric or a maintain key result ever has.
--
-- Forward-only and safe for a rolling upgrade: the previous release names
-- neither column, and the defaults fill both for every row it inserts.
-- `key_results` carries its tenant policy from migration 0022, which new
-- columns do not touch.
alter table key_results
  add column kind text not null default 'metric'
    check (kind in ('metric', 'maintain', 'milestone', 'baseline')),
  add column done_at timestamptz;
