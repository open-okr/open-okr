-- Comments and reactions (TECHNICAL-PLAN.md §4.10, P3-T16).
--
-- Comments are rich text (editor JSON in jsonb) on goals, key results,
-- check-ins, cycles and documents. Deep-linkable. Edit history through
-- activities, not stored revisions.
--
-- Reactions are on every major subject, not only comments: a goal, a
-- check-in, a comment itself. One emoji per member per subject.
--
-- Both tables inherit access from their parent subject through the
-- subject-to-context resolver in packages/core/src/access/reads.ts.
-- Neither owns an access context of its own.

-- ── Comments ────────────────────────────────────────────────────────────

create table comments (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  subject_type text not null
    constraint comments_subject_type_check
      check (subject_type in ('goal', 'key_result', 'check_in', 'cycle', 'document')),
  subject_id uuid not null,
  author_member_id uuid not null references workspace_members (id),
  body jsonb not null,
  body_version integer not null default 1,
  edited_at timestamptz,
  legacy_type text,
  legacy_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index comments_subject_idx
  on comments (workspace_id, subject_type, subject_id)
  where deleted_at is null;

create index comments_author_idx
  on comments (workspace_id, author_member_id)
  where deleted_at is null;

-- RLS: tenant floor
alter table comments enable row level security;

create policy comments_tenant on comments
  using (workspace_id = current_setting('app.workspace_id')::uuid);

-- ── Reactions ───────────────────────────────────────────────────────────

create table reactions (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  subject_type text not null,
  subject_id uuid not null,
  member_id uuid not null references workspace_members (id),
  emoji text not null
    constraint reactions_emoji_length check (char_length(emoji) between 1 and 32),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- One emoji per member per subject, including soft-deleted rows: restoring
-- a deleted reaction must not collide with a new one for the same emoji.
create unique index reactions_unique_idx
  on reactions (workspace_id, subject_type, subject_id, member_id, emoji);

create index reactions_subject_idx
  on reactions (workspace_id, subject_type, subject_id)
  where deleted_at is null;

-- RLS: tenant floor
alter table reactions enable row level security;

create policy reactions_tenant on reactions
  using (workspace_id = current_setting('app.workspace_id')::uuid);
