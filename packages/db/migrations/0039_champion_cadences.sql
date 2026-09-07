-- The Champion's remaining cadences (P4-T05b).
--
-- 1. `agents.schedule` gains 'daily' and 'weekly'.
--
-- 0035 added 'hourly' and said in as many words that "the daily and weekly
-- values arrive with P4-T05b, which is the task that has something to run on
-- them". This is that task. AI-NATIVE-PLAN.md §6.2's four cadences are now all
-- expressible, which matters for the custom agents an admin creates through
-- `agents.create` as much as for the Champion.
--
-- The Champion's own row stays 'hourly'. Its schedule column names the finest
-- cadence it runs, and the daily, weekly and per-cycle sweeps are separate runs
-- with their own trigger strings and their own rows in `agent_runs`. A column
-- that tried to hold four values would be a list pretending to be an enum.
--
-- 2. `nudges.subject_type` gains 'member'.
--
-- The morning summary is about a person's day rather than about a row, and the
-- nudge engine deduplicates per (member, subject). Storing the member id under
-- `goal` would have read as a goal to every query that joins on it, so the
-- subject gets the type it actually is. 0033 shipped the other six.
--
-- **No column for the morning summary itself, and that is the point.**
-- `notification_settings.daily_summary` and `daily_summary_time` have existed
-- since 0013, defaulting to on at 08:00 in the member's own timezone, which is
-- exactly what TECHNICAL-PLAN §4.14 specifies and exactly what §6.4's
-- `digest.daily` needs. The first draft of this migration added a second pair of
-- columns to `workspace_members` before that table was found. Two homes for one
-- preference is a preference nobody owns.
--
-- Forward-only and additive: both check constraints only widen, so no existing
-- row changes and nothing that reads either table today behaves differently.

alter table agents drop constraint if exists agents_schedule_check;

alter table agents
  add constraint agents_schedule_check
  check (schedule in ('manual', 'continuous', 'nightly', 'hourly', 'daily', 'weekly'));

alter table nudges drop constraint if exists nudges_subject_type_check;

alter table nudges
  add constraint nudges_subject_type_check
  check (subject_type in ('goal', 'check_in', 'blocker', 'kpi', 'session', 'cycle', 'member'));
