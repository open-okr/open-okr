-- The response an unhealthy KPI was given (METHOD.md §6.5, P9-T18b).
--
-- §6.5 offers three: fix it now, as day-to-day work with an owner and a date;
-- add a key result for it to an existing objective; or launch a recovery OKR.
-- A recovery already has its column, `recovery_goal_id`. The other two are the
-- work that answers the KPI, a task or a key result, created through their own
-- writes and linked here, so the recovery board can show the answer rather
-- than offer the three again.
--
-- The latest answer only: a KPI that falls over twice gets a second answer,
-- and the board needs to know whether the current one is still open, not the
-- history, which is in the activity feed.
--
-- `response_task_id` and `response_key_result_id` point forward from `kpis` to
-- tables an archive writes later, so the workspace export writes them in its
-- second pass, as it does `recovery_goal_id`.
--
-- Forward-only and safe for a rolling upgrade: five nullable columns the
-- previous release names nowhere. `kpis` keeps its tenant policy from
-- migration 0026, which none of this touches.
alter table kpis
  add column response_kind text check (
    response_kind is null or response_kind in ('fix_now', 'key_result')
  ),
  add column response_task_id uuid references tasks (id),
  add column response_key_result_id uuid references key_results (id),
  add column responded_by_member_id uuid references workspace_members (id),
  add column responded_at timestamptz,
  add constraint kpis_response_is_complete check (
    (response_kind is null) = (responded_at is null)
    and (response_kind is distinct from 'fix_now' or response_task_id is not null)
    and (response_kind is distinct from 'key_result' or response_key_result_id is not null)
  );
