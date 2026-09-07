-- Blockers (TECHNICAL-PLAN §4, METHOD.md §7.3, P4-T07c).
--
-- A blocker is opened during the weekly session's diagnose step for every
-- key result with confidence below the low boundary. It carries the five-type
-- taxonomy from §7.3, a named owner, a next action, and a 24-hour clock.
--
-- The due_at column is opened_at plus the workspace's blocker clock (§11
-- cadence.blockerClockHours, 24h default). The caller computes this rather
-- than using a generated column, because the threshold is per workspace and
-- can change after the blocker is opened without retroactively moving its
-- deadline.
--
-- openokr:soft-delete: a resolved blocker is historical data the retro reads.

create table blockers (
  id              uuid        primary key,
  workspace_id    uuid        not null references workspaces (id) on delete cascade,
  key_result_id   uuid        references key_results (id) on delete cascade,
  goal_id         uuid        references goals (id) on delete cascade,
  type            text        not null,
  description     text,
  owner_id        uuid        not null references workspace_members (id),
  next_action     text        not null,
  opened_at       timestamptz not null,
  due_at          timestamptz not null,
  resolved_at     timestamptz,
  escalated_at    timestamptz,
  escalated_to_id uuid        references workspace_members (id),
  session_id      uuid        references okr_sessions (id) on delete set null,
  source          text        not null default 'session',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,

  constraint blockers_type_check
    check (type in ('resource', 'dependency', 'clarity', 'priority_conflict', 'external')),
  constraint blockers_source_check
    check (source in ('session', 'manual', 'channel', 'agent'))
);

create index blockers_kr_open_idx
  on blockers (workspace_id, key_result_id)
  where resolved_at is null and deleted_at is null;

create index blockers_due_idx
  on blockers (workspace_id, due_at)
  where resolved_at is null and deleted_at is null;

-- RLS: tenant floor.
alter table blockers enable row level security;
alter table blockers force row level security;

create policy blockers_tenant on blockers
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
