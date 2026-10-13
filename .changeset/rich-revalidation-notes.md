---
"@openokr/web": patch
"@openokr/core": patch
"@openokr/db": patch
---

A quarter's revalidation notes, what changed and the focus areas, are
written with the editor.

Both notes can carry bold, lists and links. A member who cannot edit the
cycle sees them as written rather than as a form they cannot submit.
Migration 0143 adds a document column beside each, and data change 0032
(`pnpm db:change`) turns every note written before into a document with
the same paragraphs; until it runs, each reads exactly as before.

For this release each note is written twice, the document and its plain
text, so the release before still reads it during an upgrade.
`workflow.setRevalidation` takes editor JSON, and still takes plain text,
which is wrapped as a document; `workflow.read` returns
`revalidationDocuments` beside the plain `revalidation`. The plain columns,
and the plain text input, go a release later.
