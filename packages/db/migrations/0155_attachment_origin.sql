-- Attachment rows from the text (docs/design/rich-text-editor.md section 11,
-- plan 0.7.0 R2, approved by Akmal on 9 November 2026).
--
-- A file pasted into a comment or a document becomes an `attachment` node
-- that names a blob, and no row said the file belonged to anything, so only
-- its uploader could open it. The writes that save a comment or a document
-- now record a row for each file in the text, and two things change here:
--
--   - `comment` joins the subjects a row may hang on. A file reaches a
--     comment through its text only; the files panel never offers one.
--   - `origin` says who placed the row: `panel` for a file attached through
--     the files panel, `text` for one the text named. A write reconciles only
--     its `text` rows, so editing a document never takes off a file somebody
--     attached through the panel.
--
-- Forward-only and additive. The constant default changes only the catalogue,
-- with no table rewrite, and every existing row is a panel row, which is what
-- each one is. No new policy: `attachments` has carried `workspace_id` and its
-- tenant policy since 0066.
--
-- Safe for a rolling upgrade: a pod on the previous release writes rows
-- without `origin` and gets `panel`, which is right, and never writes a
-- `comment` row.
alter table attachments drop constraint attachments_subject_type_check;

alter table attachments add constraint attachments_subject_type_check check (
  subject_type in (
    'space',
    'goal',
    'key_result',
    'initiative',
    'cycle',
    'session',
    'task',
    'document',
    'check_in',
    'comment'
  )
);

alter table attachments
add column origin text not null default 'panel' check (
  origin in ('panel', 'text')
);
