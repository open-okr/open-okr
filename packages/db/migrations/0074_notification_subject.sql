-- A notification carries its own subject (TECHNICAL-PLAN §4.11, P6-G07a).
--
-- **The subject reached `notifyRecipients` and was thrown away.** It takes
-- `subjectType` and `subjectId`, uses them to resolve who is watching, and
-- stores neither. The only subject a row could be traced back to was through
-- `activity_id`, and that column is nullable for a reason that is not going
-- away: the Operation pipeline writes the activity row *after* `execute`
-- returns, so a fan-out that happens inside `execute` has no activity id to
-- record. Two of the three producers are exactly that shape.
--
-- `documents.publish` notifies the watchers of the document's *subject*, which
-- is the goal or the initiative the document hangs off, not the document the
-- activity names. The task fan-out notifies a task's watchers. Neither can use
-- the pipeline's own fan-out, because the pipeline fans out on the activity's
-- subject, and neither had an activity id, so both wrote rows with no subject
-- at all: no group to sit in, and no target to link to.
--
-- So the inbox (S-03) could not be built on the join. It is built on these two
-- columns, and every producer sets them from the subject it already holds.
--
-- Nullable, and forward-only in both directions. The previous release ignores
-- columns it does not know; this one falls back to the activity's subject for a
-- row written before this migration, which is why the read coalesces rather
-- than requiring the column. Nothing is backfilled here: a backfill is the data
-- -change runner's job and these rows are recoverable from `activity_id` where
-- they have one and were never recoverable where they do not.
--
-- No new policy. The table already carries `workspace_id` and its row-level
-- security policy from migration 0013.

alter table notifications
  add column subject_type text,
  add column subject_id uuid;

-- The read the screen makes: one member's unread rows, newest first, grouped by
-- the subject they are about. The recipient is first because every query on
-- this table starts by naming one, and the partial clause keeps snoozed and
-- deleted rows out of the index rather than out of the scan.
create index notifications_subject_idx
  on notifications (workspace_id, recipient_member_id, subject_type, subject_id)
  where deleted_at is null and subject_type is not null;
