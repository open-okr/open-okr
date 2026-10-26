-- The quarterly review's management retro answers become rich text, in two
-- releases (docs/design/guided-inputs.md §4.7, change 11b).
--
-- As 0140 did for the monthly review: the plain column gains a document and
-- its schema version beside it, this release writes both, and readers wrap
-- the plain column while data change 0029_management_answer_document has not
-- reached its row. Change 13 drops `body` a release later. The facilitator's
-- private stage notes need no column: they are values in `okr_sessions.notes`,
-- which already holds JSON, and data change 0030_stage_note_documents turns
-- each one written as text into a document.
--
-- Forward-only and safe for a rolling upgrade: nullable columns the previous
-- release never reads. `management_answers` already has its row-level
-- security policy, which covers a new column as it covers the rest of the
-- row. A document and its version are set together or not at all.
alter table management_answers
  add column body_document jsonb,
  add column body_document_version integer,
  add constraint management_answers_body_document_versioned
    check ((body_document is null) = (body_document_version is null));
