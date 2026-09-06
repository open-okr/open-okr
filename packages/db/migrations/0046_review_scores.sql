-- Scoring the key results (TECHNICAL-PLAN §4.8, METHOD.md §8.3, P4-T10b-a).
--
-- Stage two of the quarterly review grades every key result 0.0 to 1.0 against
-- the key result as written, with a one-line reason.
--
-- **The score lives here first and reaches `key_results.score` on close.**
-- §8.3's whole point is that the room grades together and the objective score is
-- hidden until they reveal it. A score written straight onto the key result
-- would be visible immediately to anybody reading the goal page, which is the
-- reveal leaking through the back door. It also has to be revisable: a room
-- talks itself from 0.6 to 0.4 and back inside one stage, and each of those is
-- not a fact about the key result until the session closes.
--
-- `revealed_at` is on the row rather than on the objective, so the reveal is one
-- update over an objective's rows and every client reads the same answer from
-- it. Same shape and same reason as `check_in_votes.revealed_at` (P3-T07).
-- P4-T10b-b is what writes it; this migration ships the column so the reveal is
-- a write rather than a schema change.

-- openokr:soft-delete: a review's record is history the minutes read.
create table review_scores (
  id            uuid        primary key,
  workspace_id  uuid        not null references workspaces (id) on delete cascade,
  session_id    uuid        not null references okr_sessions (id) on delete cascade,
  key_result_id uuid        not null references key_results (id) on delete cascade,
  score         numeric     not null,
  -- §8.3 asks for a one-line reason and the action requires it. "Facts, not
  -- feelings" is unenforceable, but a score nobody explained is refusable.
  reason        text        not null,
  scored_by_id  uuid        not null references workspace_members (id),
  revealed_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,

  constraint review_scores_range
    check (score >= 0 and score <= 1)
);

-- One score per key result per session. Regrading corrects it, because a room
-- that changes its mind has one answer and not two.
create unique index review_scores_one_per_key_result_idx
  on review_scores (workspace_id, session_id, key_result_id)
  where deleted_at is null;

create index review_scores_session_idx
  on review_scores (workspace_id, session_id)
  where deleted_at is null;

-- RLS: tenant floor.
alter table review_scores enable row level security;
alter table review_scores force row level security;

create policy review_scores_tenant on review_scores
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
