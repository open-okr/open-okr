-- The review and the retrospective apart (METHOD.md §8, §12, P9-T20b-a).
--
-- "A workspace may split it into a review session and a separate
-- retrospective. When split, the review session holds the Open and Review
-- acts (stages 1 to 4) and the retrospective holds the Retro and Reset acts
-- (stages 5 to 11)." `review_part` says which half a quarterly session is,
-- null being the whole review in one session, which is every session the
-- previous release wrote.
--
-- **The retrospective names its review session.** Every stage after the
-- fourth reads what the scoring recorded: the root causes are asked of the
-- key results scored below their threshold, the diagnostic reads the cycle
-- score, the close decisions and the minutes read the grades. Those rows are
-- keyed on the session that scored them, so the retrospective carries the
-- review session's id rather than a copy of its scores.
--
-- Forward-only and safe for a rolling upgrade: two nullable columns the
-- previous release never reads.
alter table okr_sessions
  add column review_part text
    check (review_part in ('review', 'retrospective')),
  add column review_session_id uuid
    references okr_sessions(id) on delete set null;

-- Only a retrospective names a review session, and only a quarterly session
-- is ever split.
alter table okr_sessions
  add constraint okr_sessions_review_link check (
    (review_session_id is null or review_part = 'retrospective')
    and (review_part is null or kind = 'quarterly')
  );
