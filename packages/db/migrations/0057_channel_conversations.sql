-- A chat conversation in progress (AI-NATIVE-PLAN.md §5.3, design §8.1,
-- P5-T06b).
--
-- **A row rather than memory, and that is the whole point of the table.** The
-- relay and the web process are both stateless and either can restart between
-- two messages, so a half-finished check-in held in a process would be lost by
-- a deploy. §8.1 says so in one line and this is that line.
--
-- **Nothing partial is ever a check-in.** `collected` holds the answers so far
-- and nothing else in the product reads it. The registry action runs once, when
-- every required field is in, in one transaction. A draft check-in somebody did
-- not know they had created is worse than starting again.
--
-- One live conversation per member per provider: a second one would make "the
-- next message on this thread continues it" ambiguous, and the product cannot
-- ask which of two half-finished check-ins somebody meant.
--
-- openokr:hard-delete: a conversation is a thirty-minute artefact of a flow, not a record of anything that happened. Finishing or abandoning one removes it, and a tombstone would hold the unique index so the same member could never start another.
create table channel_conversations (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  member_id uuid not null references workspace_members (id) on delete cascade,
  provider text not null
    check (provider in ('slack', 'teams', 'whatsapp', 'telegram')),
  -- The provider's own thread, when it has one. Null for a provider where a
  -- direct message is the only thread there is.
  external_thread_id text,
  -- The command being run, from the chat command catalogue.
  command text not null,
  -- What the command is about: the goal a check-in is for, and so on.
  subject_id uuid,
  -- The answers so far, keyed by field name. Read by nothing but the state
  -- machine, and never by a surface: a partial answer is not a value.
  collected jsonb not null default '{}'::jsonb,
  -- Which field is being asked for right now, so a reply has somewhere to go.
  awaiting text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table channel_conversations enable row level security;
alter table channel_conversations force row level security;

create policy tenant_isolation on channel_conversations
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create unique index channel_conversations_member_idx
  on channel_conversations (workspace_id, member_id, provider);
