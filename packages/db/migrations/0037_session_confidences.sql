-- Session confidence confirmations (METHOD.md §7.2 step 1, P4-T07b).
--
-- After the vote reveal, the champion confirms a final confidence and writes
-- a what-changed note for each key result. This table stores those confirmed
-- results. Votes themselves are in check_in_votes (which already has a
-- session_id column from P3-T07).
--
-- openokr:soft-delete: a confirmed confidence is part of the session record
-- and must stay visible in history.

create table session_confidences (
  id                    uuid        primary key,
  workspace_id          uuid        not null references workspaces (id) on delete cascade,
  session_id            uuid        not null references okr_sessions (id) on delete cascade,
  key_result_id         uuid        not null references key_results (id) on delete cascade,
  confirmed_confidence  numeric     not null,
  team_average          numeric,
  what_changed          text        not null,
  confirmed_by_id       uuid        not null references workspace_members (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,

  constraint session_confidences_range_check
    check (confirmed_confidence >= 0 and confirmed_confidence <= 1)
);

create unique index session_confidences_session_kr_idx
  on session_confidences (workspace_id, session_id, key_result_id)
  where deleted_at is null;

-- RLS: tenant floor.
alter table session_confidences enable row level security;
alter table session_confidences force row level security;

create policy session_confidences_tenant on session_confidences
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
