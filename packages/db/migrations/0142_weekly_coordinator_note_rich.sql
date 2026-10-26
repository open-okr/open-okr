-- The weekly session's coordinator note becomes rich text, in two releases
-- (docs/design/guided-inputs.md §4.7, change 11c).
--
-- As 0140 and 0141 did for the monthly and quarterly reviews: the plain
-- column gains a document and its schema version beside it, this release
-- writes both, and readers wrap the plain column while data change
-- 0031_digest_note_document has not reached its row. Change 13 drops `note`
-- a release later.
--
-- Forward-only and safe for a rolling upgrade: nullable columns the previous
-- release never reads. `digests` already has its row-level security policy,
-- which covers a new column as it covers the rest of the row. A document and
-- its version are set together or not at all.
alter table digests
  add column note_document jsonb,
  add column note_document_version integer,
  add constraint digests_note_document_versioned
    check ((note_document is null) = (note_document_version is null));
