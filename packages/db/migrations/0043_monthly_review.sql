-- The monthly review (TECHNICAL-PLAN §4.7, METHOD.md §7.5, P4-T09).
--
-- §7.5 records four things. Two of them need storage here and TECHNICAL-PLAN
-- §4.7 already specifies both tables, so this migration follows that shape
-- rather than inventing one:
--
--   objective_trends  goal_id, month, trend, author_member_id
--   decisions         cycle_id?, key_result_id?, goal_id?, at, text,
--                     author_member_id, session_id?
--
-- The other two are not tables. The dependency and risk log is a read of
-- P3-T09's alignment register, and a second copy would give a facilitator two
-- answers about one dependency. Resource or priority shifts are one free-text
-- note for the meeting, so they are a column on the session.
--
-- **A trend belongs to a month, not to a meeting.** That is the plan's shape
-- and it is the right one: a space that reschedules and holds two reviews in
-- one March still has one March opinion per objective, and the quarterly
-- review reads three months of trend without joining sessions.
--
-- **A decision carries its own cycle.** Deriving it by joining through the
-- goal looks equivalent and is not: `goals.moveToCycle` exists, so a goal
-- moved into the next cycle would silently drag every past decision with it,
-- and a decision taken in Q1 would start reading as a Q2 decision.

-- openokr:soft-delete: a review's record is history the quarterly reads.
create table objective_trends (
  id               uuid        primary key,
  workspace_id     uuid        not null references workspaces (id) on delete cascade,
  goal_id          uuid        not null references goals (id) on delete cascade,
  -- The first day of the month the review covers, so a rescheduled review
  -- lands on the month it is about rather than the day it happened.
  month            date        not null,
  trend            text        not null,
  author_member_id uuid        not null references workspace_members (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,

  constraint objective_trends_trend_check
    check (trend in ('improving', 'flat', 'declining'))
);

-- One opinion per objective per month. Recording again corrects the first
-- rather than adding a second, because two rows would leave a reader asking
-- which of them the room actually agreed.
create unique index objective_trends_one_per_month_idx
  on objective_trends (workspace_id, goal_id, month)
  where deleted_at is null;

-- openokr:soft-delete: §7.5 calls the decision log "the artifact that
-- survives the meeting", which is exactly a row that must not disappear.
create table decisions (
  id               uuid        primary key,
  workspace_id     uuid        not null references workspaces (id) on delete cascade,
  -- Stamped at the time rather than joined through the goal, so a later
  -- `goals.moveToCycle` cannot rewrite which cycle decided this.
  cycle_id         uuid        references cycles (id) on delete set null,
  -- Nullable, and today always set: a decision is recorded inside a monthly
  -- review and nowhere else. The column does not enforce that, so opening a
  -- second path later needs no rename and no two-release migration.
  session_id       uuid        references okr_sessions (id) on delete set null,
  goal_id          uuid        references goals (id) on delete cascade,
  key_result_id    uuid        references key_results (id) on delete cascade,
  at               date        not null,
  text             text        not null,
  author_member_id uuid        not null references workspace_members (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,

  -- §7.5: "Every decision names the key result it affects." A decision with no
  -- subject is a meeting note, and the log is not a notepad.
  constraint decisions_names_a_subject
    check (goal_id is not null or key_result_id is not null)
);

create index decisions_goal_idx
  on decisions (workspace_id, goal_id)
  where deleted_at is null;

create index decisions_cycle_idx
  on decisions (workspace_id, cycle_id)
  where deleted_at is null;

create index decisions_session_idx
  on decisions (workspace_id, session_id)
  where deleted_at is null;

-- Resource or priority shifts (§7.5), one note for the meeting. Its own column
-- rather than a key inside `okr_sessions.notes`, which holds the facilitator's
-- private per-stage notes (P4-T10a). A shared record living inside a
-- private-by-design column is one refactor away from being published.
alter table okr_sessions add column shifts text;

-- RLS: tenant floor.
alter table objective_trends enable row level security;
alter table objective_trends force row level security;

create policy objective_trends_tenant on objective_trends
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

alter table decisions enable row level security;
alter table decisions force row level security;

create policy decisions_tenant on decisions
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
