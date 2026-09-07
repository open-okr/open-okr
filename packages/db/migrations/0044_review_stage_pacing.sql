-- The quarterly review's pacing (TECHNICAL-PLAN §4.7, METHOD.md §8.1,
-- P4-T10a-a).
--
-- §8.1 gives each of the eleven stages a duration from §11's
-- `sessions.quarterlyStageMinutes`, and the facilitator an add-a-minute
-- control. The minutes are a workspace parameter and the additions are one
-- room's decision on one day, so they cannot live in the same place: a
-- facilitator adding two minutes to stage one must not retune every future
-- review.
--
-- Keyed by `stage_key`, exactly like `elapsed` beside it, so a stage's budget
-- and the time spent on it are read the same way. `elapsed` holds seconds
-- because it is measured; this holds whole minutes because it is chosen.

alter table okr_sessions
  add column added_minutes jsonb not null default '{}'::jsonb;

-- No policy change: `okr_sessions` already carries the tenant floor from
-- 0036_sessions.sql, and a column on an existing table inherits it.
