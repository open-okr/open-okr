-- Comments on tasks, replies, and legacy keys for imported files
-- (TECHNICAL-PLAN §4.10, §7.2, P6-T04b).
--
-- **A comment may hang on a task.** §7.2 maps FlowyTeam's `task_comments` onto
-- `comments`, and the subject list this table was created with (migration
-- 0032) predates tasks existing at all. `attachments` already accepts a task
-- for the same reason, and the access resolver has had a `task` entry since
-- P5-T11, so nothing else has to change: a comment on a task is readable by
-- whoever reads the task. On the instance this importer reads, 7223 comments
-- are on tasks and none is on anything else, so refusing them would have meant
-- importing the work and none of the conversation about it.
--
-- **A reply keeps its parent.** FlowyTeam threads comments one level deep. It
-- is a small fact: 8 of those 7223 are replies. It is still a fact somebody
-- wrote, and answering a colleague is not the same as speaking after them, so
-- dropping the pointer would change what the thread says. No surface renders a
-- thread yet; `comments.list` returns the column so the relationship is
-- addressable rather than only stored.
--
-- **Legacy keys on `comments` and `blobs`**, so a second run of the same
-- company writes no second copy. `attachments` needs none: it is already
-- unique on the subject and the blob while live, so re-attaching the same file
-- to the same task is the same row. `subscriptions` needs none for the same
-- reason, being unique per list and member.
--
-- Additive and forward-only. Widening a check constraint is safe in both
-- directions of a rolling upgrade only in the sense that the old release never
-- writes the new value; a task comment written by the new release and read by
-- the old one would be a comment the old code has no subject resolver for,
-- which is why this ships in the release that adds the importer that writes
-- them and not before.
--
-- No new policy. Both tables already carry `workspace_id` and their row-level
-- security policies from their own migrations.

alter table comments
  drop constraint comments_subject_type_check;

alter table comments
  add constraint comments_subject_type_check
    check (
      subject_type in (
        'goal', 'key_result', 'check_in', 'cycle', 'document', 'task'
      )
    );

-- Nullable, and self-referencing. `on delete set null` rather than cascade: a
-- deleted parent must not take the answers with it, because the answer is
-- somebody else's words.
alter table comments
  add column parent_id uuid references comments (id) on delete set null;

create index comments_parent_idx
  on comments (workspace_id, parent_id)
  where parent_id is not null and deleted_at is null;

-- The columns were already here from migration 0032; the index that makes them
-- an identity was not, because nothing imported a comment until now.
create unique index comments_legacy_idx on comments (
  workspace_id, legacy_type, legacy_id
)
where
  legacy_id is not null
  and deleted_at is null;

-- A blob imported from a source needs an identity of its own. Two files can
-- share a name, a size and even a digest and still be two uploads, so the
-- digest is not the key: the source's own id is.
alter table blobs
  add column legacy_id text,
  add column legacy_type text;

create unique index blobs_legacy_idx on blobs (
  workspace_id, legacy_type, legacy_id
)
where
  legacy_id is not null
  and deleted_at is null;
