-- The monthly review's shifts and decisions become rich text, in two
-- releases (docs/design/guided-inputs.md §4.7, change 11a).
--
-- Each plain column gains a document and its schema version beside it. This
-- release writes both: the document, and its plain text into the old column,
-- so the previous release, still running during a rolling upgrade, reads
-- what it always read. Readers take the document, and wrap the old column
-- while data changes 0027_session_shifts_document and
-- 0028_decision_text_document have not reached its row. Change 13 drops the
-- old columns a release later.
--
-- Forward-only and safe for a rolling upgrade: nullable columns the previous
-- release never reads. `okr_sessions` and `decisions` already have their
-- row-level security policies, which cover a new column as they cover the
-- rest of the row. A document and its version are set together or not at all.
alter table okr_sessions
  add column shifts_document jsonb,
  add column shifts_document_version integer,
  add constraint okr_sessions_shifts_document_versioned
    check ((shifts_document is null) = (shifts_document_version is null));

alter table decisions
  add column text_document jsonb,
  add column text_document_version integer,
  add constraint decisions_text_document_versioned
    check ((text_document is null) = (text_document_version is null));
