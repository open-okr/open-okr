-- The diagnostic's rhythm, measured (METHOD.md §8.6, P9-T20d).
--
-- v2's §8.6: "the rhythm score: the share of due check-ins published within
-- tolerance, measured by the product. Holiday periods (§7.4) are not due, so
-- they are not counted. Process-health statements 2 and 5 are shown beside it
-- as a cross-check." The verdict is now read on the measured share, kept in
-- `on_time_share` with the two counts it was taken from, and `rhythm_score`
-- stays what it always held, the two statements' average, as the cross-check.
--
-- **Old rows are left as they are.** A review read before this stored a
-- survey rhythm and the verdict read on it. Its `on_time_share` stays null,
-- which the screen reads as a diagnostic taken on the survey, and its verdict
-- is shown as recorded rather than recomputed.
--
-- Forward-only and safe for a rolling upgrade: three nullable columns the
-- previous release never reads.
alter table review_diagnostics
  add column on_time_share numeric,
  add column due_check_ins integer,
  add column on_time_check_ins integer,
  add constraint review_diagnostics_share_counted check (
    on_time_share is null
    or (due_check_ins > 0 and on_time_check_ins between 0 and due_check_ins)
  );
