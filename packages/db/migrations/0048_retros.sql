-- The two retros (DATABASE.md §11, METHOD.md §8.1 stages 5 and 6, §8.7,
-- P4-T11a).
--
-- Stage five is the team's: what worked, what did not, written silently and then
-- dot voted. Stage six is leadership's four questions.
--
-- **The two are stored apart because they are read apart.** §8.7 has leadership
-- answering out loud, and Agung decided on 26 August 2026 that the management
-- retro is visible to a space's managers and coordinators only. One table with a
-- visibility column would put both audiences one forgotten predicate away from
-- each other.

-- openokr:soft-delete: a review's record is history the minutes read.
create table retro_notes (
  id               uuid        primary key,
  workspace_id     uuid        not null references workspaces (id) on delete cascade,
  session_id       uuid        not null references okr_sessions (id) on delete cascade,
  -- §8.1's two columns, and the structure is canon: "What worked, what did not".
  -- A third column would be a different retro.
  column_key       text        not null,
  text             text        not null,
  -- The dot count, denormalised from `retro_votes` and written in the same
  -- transaction as every vote, so the two cannot drift. TECHNICAL-PLAN §4
  -- specifies the column and the board sorts on it; a test asserts it equals the
  -- row count rather than trusting that it was maintained.
  votes            smallint    not null default 0,
  -- Optional, so the writing phase can be anonymous. §8.1 asks for silent
  -- writing, and a name on a note changes what people write.
  author_member_id uuid        references workspace_members (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,

  constraint retro_notes_column check (column_key in ('worked', 'didnt')),
  constraint retro_notes_text_present check (length(btrim(text)) > 0),
  -- A negative count is a maintenance bug rather than a state the room reached.
  constraint retro_notes_votes_not_negative check (votes >= 0)
);

create index retro_notes_session_idx
  on retro_notes (workspace_id, session_id)
  where deleted_at is null;

alter table retro_notes enable row level security;
alter table retro_notes force row level security;

create policy retro_notes_tenant on retro_notes
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- openokr:soft-delete: withdrawing a dot should read as withdrawn.
create table retro_votes (
  id           uuid        primary key,
  workspace_id uuid        not null references workspaces (id) on delete cascade,
  note_id      uuid        not null references retro_notes (id) on delete cascade,
  member_id    uuid        not null references workspace_members (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

-- One dot per member per note. Spending two on the same note is how a member
-- turns three dots into one loud opinion, and §8.1's vote is about spread.
-- The total cap across notes is `sessions.retroDotsPerMember`, enforced in the
-- action because it counts across rows this index cannot see.
create unique index retro_votes_one_per_member_idx
  on retro_votes (workspace_id, note_id, member_id)
  where deleted_at is null;

create index retro_votes_member_idx
  on retro_votes (workspace_id, member_id)
  where deleted_at is null;

alter table retro_votes enable row level security;
alter table retro_votes force row level security;

create policy retro_votes_tenant on retro_votes
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- openokr:soft-delete: the minutes read this back.
create table management_answers (
  id                uuid        primary key,
  workspace_id      uuid        not null references workspaces (id) on delete cascade,
  session_id        uuid        not null references okr_sessions (id) on delete cascade,
  -- 1 to 4, indexing METHOD.md §8.7's four questions. The questions themselves
  -- are canon and live in `packages/method`, never in this table: storing the
  -- text would let a workspace edit a question §11 lists as unchangeable
  -- structure, and would leave old rows quoting a question nobody asked.
  question_key      smallint    not null,
  body              text        not null,
  answered_by_id    uuid        not null references workspace_members (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,

  constraint management_answers_question check (question_key between 1 and 4),
  constraint management_answers_body_present check (length(btrim(body)) > 0)
);

-- One answer per question per review. Leadership answers out loud and the
-- facilitator records one answer; a second row would make the stage list the
-- question twice.
create unique index management_answers_one_per_question_idx
  on management_answers (workspace_id, session_id, question_key)
  where deleted_at is null;

alter table management_answers enable row level security;
alter table management_answers force row level security;

create policy management_answers_tenant on management_answers
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
