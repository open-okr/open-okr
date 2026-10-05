-- The computed score kept beside the one a person gave (METHOD.md §3.3,
-- P9-T14a).
--
-- **Both numbers are kept.** METHOD v2 scores a key result from its progress
-- at the close (§2.10), and lets a person adjust it with a written reason.
-- `score` stays what the review decided; `score_computed` is what §2.10
-- computed at the close; `score_reason` is why they differ, and null where
-- they agree. The scorecard shows an adjusted score beside its computed one.
--
-- Every key result already scored predates the computation, so the
-- data-change script `0018_key_result_score_computed` copies its score into
-- `score_computed`: nobody adjusted anything before adjusting existed. A
-- backfill does not belong in a schema change.
--
-- Forward-only and safe for a rolling upgrade: the previous release names
-- neither column, and both are nullable. `key_results` carries its tenant
-- policy from migration 0022, which new columns do not touch.
alter table key_results
  add column score_computed numeric,
  add column score_reason text;
