-- Copilot threads and messages (AI-NATIVE-PLAN.md §7, screen S-39, P4-T14a-a).
--
-- A conversation anchored to the workspace or to one entity, with the roles and
-- the cost of each turn.

-- openokr:soft-delete: a thread a member closes should read as closed, not
-- vanish from the usage and cost record that references its messages.
create table ai_threads (
  id             uuid        primary key,
  workspace_id   uuid        not null references workspaces (id) on delete cascade,
  -- Whose conversation it is. A copilot thread is one member's: §2.4's grounded
  -- answering is "across everything the user may see", so a thread shared
  -- between two readers would answer differently depending on who opened it.
  member_id      uuid        not null references workspace_members (id),
  -- The anchor. Null subject means the whole workspace, which is the side
  -- panel opened from anywhere; a subject narrows the question to one thing.
  subject_type   text,
  subject_id     uuid,
  title          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,

  -- An anchor is both columns or neither. Half an anchor is a thread nothing
  -- can resolve.
  constraint ai_threads_anchor
    check ((subject_type is null) = (subject_id is null))
);

create index ai_threads_member_idx
  on ai_threads (workspace_id, member_id, updated_at)
  where deleted_at is null;

alter table ai_threads enable row level security;
alter table ai_threads force row level security;

create policy ai_threads_tenant on ai_threads
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- openokr:soft-delete: a message is part of the record the usage events point at.
create table ai_messages (
  id           uuid        primary key,
  workspace_id uuid        not null references workspaces (id) on delete cascade,
  thread_id    uuid        not null references ai_threads (id) on delete cascade,
  role         text        not null,
  content      text        not null,
  /**
   * What the answer was grounded in, as an array of {entityType, entityId}.
   *
   * Stored on the message rather than resolved at read time, because a citation
   * is a claim about what this answer used and that does not change when the
   * content later does. Whether the reader may *see* a cited thing is decided at
   * read time, which is a different question and the one that matters for leaks.
   */
  citations    jsonb       not null default '[]'::jsonb,
  -- Cost, per §7's own column list. Null on a member's own turn, and null on an
  -- answer whose model is not in the catalogue with a price.
  model        text,
  tokens_in    integer,
  tokens_out   integer,
  cost         numeric(12, 6),
  -- Set when a stream was stopped before it finished (P4-T14a-b writes it). The
  -- column ships here so the stop control is a write and not a schema change.
  stopped_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,

  constraint ai_messages_role check (role in ('member', 'assistant')),
  constraint ai_messages_content_present check (length(btrim(content)) > 0)
);

create index ai_messages_thread_idx
  on ai_messages (workspace_id, thread_id, created_at)
  where deleted_at is null;

alter table ai_messages enable row level security;
alter table ai_messages force row level security;

create policy ai_messages_tenant on ai_messages
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
