-- Objective narratives and recognition (DATABASE.md §11, METHOD.md §8.1
-- stages 3 and 4, P4-T10c).
--
-- Stage three goes owner by owner: the story behind the score, and what the
-- number does not show. Stage four names the effort that deserved to be seen.
--
-- **The mic is a pointer on the session, not a row per turn.** Exactly one
-- objective holds it at a time, which is the whole property the stage needs, and
-- a single column is the only shape that cannot represent two holders. Same
-- reason `review_scores.revealed_at` sits on the row rather than being derived:
-- one write, and every client reads the same answer from it.

-- openokr:soft-delete: a review's record is history the minutes read.
create table review_narratives (
  id            uuid        primary key,
  workspace_id  uuid        not null references workspaces (id) on delete cascade,
  session_id    uuid        not null references okr_sessions (id) on delete cascade,
  goal_id       uuid        not null references goals (id) on delete cascade,
  -- Rich text, and **nullable on purpose**. Most narratives are spoken and
  -- never typed: §8.1 gives the stage nine minutes of talking, not writing. A
  -- row that exists only because the objective was spoken for carries no body,
  -- and storing an empty document instead would put "somebody wrote nothing" in
  -- the same shape as "nobody wrote". Same nullable-jsonb shape as
  -- `check_ins.narrative`.
  body          jsonb,
  body_version  integer,
  -- Who wrote the body, and null when there is no body. The facilitator who
  -- marked an objective spoken did not author a narrative they never wrote.
  author_member_id uuid     references workspace_members (id),
  -- Set when the mic moves on from this objective, which is §4.4's "facilitator
  -- marks each as spoken". Null means it has not had its turn.
  spoken_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,

  -- A body without its version, or a version without its body, is a row nothing
  -- can safely render.
  constraint review_narratives_body_versioned
    check ((body is null) = (body_version is null)),
  -- An author with no body is the marking facilitator leaking into the author
  -- column, which is the one thing this table must not say.
  constraint review_narratives_author_has_body
    check (author_member_id is null or body is not null)
);

-- One narrative per objective per review. An objective's story is one story;
-- a second row would make the stage list it twice.
create unique index review_narratives_one_per_goal_idx
  on review_narratives (workspace_id, session_id, goal_id)
  where deleted_at is null;

create index review_narratives_session_idx
  on review_narratives (workspace_id, session_id)
  where deleted_at is null;

alter table review_narratives enable row level security;
alter table review_narratives force row level security;

create policy review_narratives_tenant on review_narratives
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- openokr:soft-delete: recognition is part of the record, and withdrawing it
-- should read as withdrawn rather than as never given.
create table kudos (
  id             uuid        primary key,
  workspace_id   uuid        not null references workspaces (id) on delete cascade,
  session_id     uuid        not null references okr_sessions (id) on delete cascade,
  from_member_id uuid        not null references workspace_members (id),
  to_member_id   uuid        not null references workspace_members (id),
  -- §8.1: "Specific beats generous." Plain text, because a paragraph of
  -- formatting is not what three minutes of naming effort produces, and every
  -- other free line in a session (`okr_sessions.shifts`, `decisions.text`) is
  -- plain text for the same reason.
  text           text        not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,

  constraint kudos_text_present check (length(btrim(text)) > 0),
  -- Recognising yourself is not recognition. §8.1 asks the room to name the
  -- effort it saw, and the room is other people.
  constraint kudos_not_self check (from_member_id <> to_member_id)
);

-- Deliberately not unique on anything. One member may recognise another more
-- than once in a review, for different things, and collapsing that to one row
-- would make the second piece of recognition overwrite the first.
create index kudos_session_idx
  on kudos (workspace_id, session_id)
  where deleted_at is null;

alter table kudos enable row level security;
alter table kudos force row level security;

create policy kudos_tenant on kudos
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- Who holds the mic, now. Nullable: nobody holds it before the stage starts and
-- nobody holds it after the last owner has spoken.
alter table okr_sessions
  add column mic_goal_id uuid references goals (id) on delete set null;
