-- Documents, their versions and attachments (TECHNICAL-PLAN §4.9, P5-T12).
--
-- **A draft is visible to its author and to nobody else, and that is enforced
-- in the query rather than in a component.** Every read of this table adds
-- `(state = 'published' or author_member_id = $me)` to its own where clause, so
-- there is no code path that returns a draft to somebody else, including a
-- direct identifier probe. That answers not-found, the same as everything else
-- a reader may not see. The work-layer design's §4.2 is explicit about it: a
-- filter in a component is a filter one careless read forgets.
--
-- **A document has no access context of its own.** It inherits its subject's:
-- a document on a goal is readable by whoever reads the goal, one on a space by
-- whoever reads the space. Giving it a context would be a second answer about
-- who can see a goal's material, and the draft rule above is the only thing
-- that narrows it further.
--
-- **Every publish writes a version row, and nothing else does.** A draft edited
-- forty times is one document with whatever versions it has published, because
-- a version is a thing somebody decided to show other people. The difference a
-- reader sees is computed from the stored editor JSON through the one shared
-- rich-text module, so the visual difference, the excerpt, the plain text for
-- search and the email rendering all come from the same parser.

-- openokr:soft-delete: a document is authored material, and its history is the
-- point of the version table beside it.
create table documents (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  subject_type text not null check (
    subject_type in ('space', 'goal', 'key_result', 'initiative', 'cycle', 'session')
  ),
  subject_id uuid not null,
  title text not null,
  body jsonb,
  body_version integer,
  state text not null default 'draft' check (state in ('draft', 'published')),
  published_at timestamptz,
  author_member_id uuid not null references workspace_members (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  -- A published document has a moment it was published. Nothing else may.
  constraint documents_published_at_matches_state check (
    (state = 'published' and published_at is not null)
    or (state = 'draft' and published_at is null)
  )
);

alter table documents enable row level security;
alter table documents force row level security;

create policy tenant_isolation on documents
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- The read every surface makes: this subject's documents, newest first.
create index documents_subject_idx
  on documents (workspace_id, subject_type, subject_id, updated_at desc)
  where deleted_at is null;

-- A person's own drafts, which is the other half of the privacy rule.
create index documents_author_idx
  on documents (workspace_id, author_member_id)
  where deleted_at is null and state = 'draft';

-- openokr:hard-delete: a version is a snapshot of a document that still exists.
-- When the document goes, the cascade takes its history with it; a surviving
-- version row would be a readable copy of something the reader was told is
-- gone.
create table document_versions (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  document_id uuid not null references documents (id) on delete cascade,
  -- One, two, three. The number a reader sees beside a change.
  version integer not null,
  title text not null,
  body jsonb,
  body_version integer,
  author_member_id uuid not null references workspace_members (id),
  created_at timestamptz not null default now()
);

alter table document_versions enable row level security;
alter table document_versions force row level security;

create policy tenant_isolation on document_versions
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- One row per version number per document. Publishing twice in the same
-- transaction is a bug, not two versions.
create unique index document_versions_number_idx
  on document_versions (workspace_id, document_id, version);

-- openokr:soft-delete: an attachment is somebody's decision that a file belongs
-- to a thing, and undoing it is a decision too.
create table attachments (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  -- Any subject. Wider than the document list above on purpose: §4.9 says
  -- "files on any subject", and a task or a check-in is as likely to carry one
  -- as a goal.
  subject_type text not null check (
    subject_type in (
      'space', 'goal', 'key_result', 'initiative', 'cycle', 'session',
      'task', 'document', 'check_in'
    )
  ),
  subject_id uuid not null,
  blob_id uuid not null references blobs (id) on delete cascade,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table attachments enable row level security;
alter table attachments force row level security;

create policy tenant_isolation on attachments
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create index attachments_subject_idx
  on attachments (workspace_id, subject_type, subject_id, position)
  where deleted_at is null;

-- One attachment per file per subject. Attaching the same blob twice is the
-- same decision made twice.
create unique index attachments_pair_idx
  on attachments (workspace_id, subject_type, subject_id, blob_id)
  where deleted_at is null;
