-- A thumbs up or down on a copilot answer (docs/design/copilot-feedback.md,
-- plan 0.9.0 FB1, approved by Agung on 13 November 2026).
--
-- The evaluation set is written from what we guess goes wrong. A member who
-- reads a poor answer knows what went wrong, so the rating is kept with the
-- answer for the people who tune the copilot.
--
-- One row per member per answer. The note is the member's own words, plain
-- text, at most 500 characters. `shared` is the member's own choice to let AI
-- administrators read the question and the answer on this rating: the
-- conversation stays the member's unless they share it (FB-D4).
--
-- `model` is copied from the answer when it is rated, so the administrator's
-- list needs no join through a message that may be gone.
--
-- openokr:soft-delete: a rating is removed when the member presses the same
-- thumb again and when its conversation is deleted. The retention sweep
-- (`agentToolCallRetentionDays`, FB-D6) is what removes rows for good, and
-- erasure deletes them with the member's threads.
--
-- Forward-only and safe for a rolling upgrade: a new table the previous
-- release names nowhere. The tenant policy ships in the same migration.
create table ai_answer_ratings (
  id           uuid        primary key,
  workspace_id uuid        not null references workspaces (id) on delete cascade,
  -- The answer rated. Core checks that it is an assistant message in a thread
  -- of the rater, which a foreign key cannot say.
  message_id   uuid        not null references ai_messages (id) on delete cascade,
  -- The rater, always the owner of the thread.
  member_id    uuid        not null references workspace_members (id),
  rating       text        not null,
  note         text,
  shared       boolean     not null default false,
  model        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,

  constraint ai_answer_ratings_rating check (rating in ('up', 'down')),
  constraint ai_answer_ratings_note_length
    check (note is null or char_length(note) <= 500)
);

-- One live rating per member per answer. Pressing the other thumb changes
-- this row, and a removed rating does not block the next one.
create unique index ai_answer_ratings_one_per_member_idx
  on ai_answer_ratings (workspace_id, message_id, member_id)
  where deleted_at is null;

-- The administrator's list, newest first, and the retention sweep.
create index ai_answer_ratings_created_idx
  on ai_answer_ratings (workspace_id, created_at desc);

alter table ai_answer_ratings enable row level security;
alter table ai_answer_ratings force row level security;

create policy ai_answer_ratings_tenant on ai_answer_ratings
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
