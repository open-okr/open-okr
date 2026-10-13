---
"@openokr/web": patch
"@openokr/core": patch
"@openokr/db": patch
---

A monthly review's shifts note and its decisions are written with the editor.

The resource or priority shifts and each decision can carry bold, lists and
links, and a decision shows as written on the review, the goal page and the
cycle page. Migration 0140 adds a document column beside each, and data
changes 0027 and 0028 (`pnpm db:change`) turn every note and decision
written before into a document with the same paragraphs; until they run,
each reads exactly as before.

For this release both are written, the document and its plain text, so the
release before still reads them during an upgrade. `sessions.setShifts` and
`sessions.recordDecision` take editor JSON, and still take plain text, which
is wrapped as a document; the read actions return `shiftsDocument` and each
decision's `textDocument` beside the plain text. The plain columns, and the
plain text input, go a release later.
