-- An hourly schedule for an agent (P4-T05a).
--
-- AI-NATIVE-PLAN.md §6.2 gives the Champion four cadences: hourly for the
-- nudge queue, daily for the sweep, weekly for the session, and per cycle for
-- the countdown. The column shipped at P2-T17 with 'manual', 'continuous' and
-- 'nightly', which was written before either agent existed and matches none of
-- those four.
--
-- Only 'hourly' is added here, because only the hourly run ships in this task.
-- The daily and weekly values arrive with P4-T05b, which is the task that has
-- something to run on them. A value nothing can produce is a value nobody can
-- test.
--
-- Forward-only, and additive: no existing row changes, and 'manual' remains
-- the default, so an agent created by hand still starts silent.

alter table agents drop constraint if exists agents_schedule_check;

alter table agents
  add constraint agents_schedule_check
  check (schedule in ('manual', 'continuous', 'nightly', 'hourly'));
