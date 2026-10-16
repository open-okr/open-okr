---
"@openokr/web": patch
"@openokr/core": patch
"@openokr/db": patch
---

A workspace archive from an earlier release imports cleanly into this one.

A column the archive carries that this release no longer has is left out of
each row, and the preview says which, where the row used to fail and be
counted as skipped. Session prose an earlier release stored as plain text
arrives as a document with the same paragraphs, so moving a 0.2 workspace
into a later release loses none of it.

`pnpm db:change` also counts a data change as done once the migration that
removed the columns it read has run and found nothing left to convert.
