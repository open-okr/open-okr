-- Session participants and the room pulse (TECHNICAL-PLAN §4.7, METHOD.md
-- §8.2, P4-T10a-b).
--
-- One row per person per session. It carries attendance, and for a quarterly
-- review it carries §8.2's pulse and one word.
--
-- **A row is created when somebody gives a pulse, not when a session is made.**
-- Seeding the whole space would claim attendance nobody confirmed, and a room
-- pulse averaged over people who never arrived is not the room's pulse. The
-- participant list on the screen is still every active space member, which is
-- what `sessions.participants` already reads: this table records what people
-- did, not who was invited.

-- openokr:soft-delete: a review's record is history the minutes read.
create table session_participants (
  id           uuid        primary key,
  workspace_id uuid        not null references workspaces (id) on delete cascade,
  session_id   uuid        not null references okr_sessions (id) on delete cascade,
  member_id    uuid        not null references workspace_members (id) on delete cascade,
  attended     boolean     not null default true,
  -- §8.2's one-to-five pulse, and the one word beside it. Null until the person
  -- gives them, because a missing pulse and a pulse of one are different facts.
  pulse        smallint,
  word         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,

  constraint session_participants_pulse_range
    check (pulse is null or (pulse >= 1 and pulse <= 5)),
  -- A word is one word. §8.2 asks for one, and a sentence in this column would
  -- turn the read of the room into a paragraph nobody scans.
  constraint session_participants_word_length
    check (word is null or (length(word) between 1 and 40))
);

-- One row per person per session. Giving a pulse again corrects it rather than
-- adding a second voice to the average.
create unique index session_participants_one_per_member_idx
  on session_participants (workspace_id, session_id, member_id)
  where deleted_at is null;

-- RLS: tenant floor.
alter table session_participants enable row level security;
alter table session_participants force row level security;

create policy session_participants_tenant on session_participants
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
