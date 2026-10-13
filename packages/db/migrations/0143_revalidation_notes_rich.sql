-- The quarterly revalidation's two notes become rich text, in two releases
-- (docs/design/guided-inputs.md §4.7, change 12).
--
-- As 0140 to 0142 did for the session prose: each plain column gains a
-- document and its schema version beside it, this release writes both, and
-- readers wrap the plain column while data change
-- 0032_revalidation_note_documents has not reached its row. Change 13 drops
-- `change_note` and `focus_note` a release later.
--
-- Forward-only and safe for a rolling upgrade: nullable columns the previous
-- release never reads. `cycle_revalidations` already has its row-level
-- security policy, which covers a new column as it covers the rest of the
-- row. A document and its version are set together or not at all.
alter table cycle_revalidations
  add column change_note_document jsonb,
  add column change_note_document_version integer,
  add column focus_note_document jsonb,
  add column focus_note_document_version integer,
  add constraint cycle_revalidations_change_note_document_versioned
    check ((change_note_document is null) = (change_note_document_version is null)),
  add constraint cycle_revalidations_focus_note_document_versioned
    check ((focus_note_document is null) = (focus_note_document_version is null));
