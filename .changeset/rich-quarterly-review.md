---
"@openokr/web": patch
"@openokr/core": patch
"@openokr/db": patch
---

A quarterly review's management retro answers and the facilitator's private
stage notes are written with the editor.

Each answer and each note can carry bold, lists and links, and an answer
shows as written on the review. The minutes still give each answer on one
line. Migration 0141 adds a document column beside each answer, and data
changes 0029 and 0030 (`pnpm db:change`) turn every answer and stage note
written before into a document with the same paragraphs; until they run,
each reads exactly as before.

For this release an answer is written twice, the document and its plain
text, so the release before still reads it during an upgrade. A stage note
lives in a map with no second column, so the release before shows a note
written in this one as empty; the facilitator alone reads it.
`sessions.setManagementAnswer` and `sessions.setStageNote` take editor JSON,
and still take plain text, which is wrapped as a document;
`sessions.managementRetro` returns each answer's `bodyDocument` beside the
plain text, and `sessions.read` returns each stage note as a document. The
plain column, and the plain text input, go a release later.
