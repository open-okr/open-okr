-- An abandoned objective says so (METHOD.md §3.5, P9-T15b-a).
--
-- **Closed as achieved, missed or abandoned.** §3.5's first rule names three
-- closed outcomes. A stop (§2.9, P9-T13-c-a) closes an objective that no
-- longer matters, and until now it had to record "missed", which reads as a
-- failure to deliver something that was deliberately set down. The outcome
-- and the health it gives the goal now include `abandoned`.
--
-- Forward-only and safe for a rolling upgrade: the constraints only widen,
-- so every row the previous release writes still passes. That release does
-- not validate what it reads, so a goal stopped by this one shows it the word
-- `abandoned` rather than failing. `goals` keeps its tenant policy from
-- migration 0022, which a constraint change does not touch.
alter table goals
  drop constraint goals_success_status_check,
  add constraint goals_success_status_check
    check (
      success_status is null
      or success_status in ('achieved', 'missed', 'abandoned')
    ),
  drop constraint goals_health_check,
  add constraint goals_health_check
    check (
      health in (
        'pending',
        'on_track',
        'caution',
        'off_track',
        'outdated',
        'achieved',
        'missed',
        'abandoned'
      )
    ),
  drop constraint goals_closed_health,
  add constraint goals_closed_health
    check (
      (closed_at is null and health not in ('achieved', 'missed', 'abandoned'))
      or (closed_at is not null and health in ('achieved', 'missed', 'abandoned'))
    );
