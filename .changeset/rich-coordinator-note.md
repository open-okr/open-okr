---
"@openokr/web": patch
"@openokr/core": patch
"@openokr/db": patch
"@openokr/ui": patch
---

A weekly session's note for leadership is written with the editor.

The coordinator's note can carry bold, lists and links. The digest, its
narration and a post to the space's channel still carry it as one line
after "For leadership:". Migration 0142 adds a document column beside it,
and data change 0031 (`pnpm db:change`) turns every note written before
into a document with the same paragraphs; until it runs, each reads exactly
as before.

For this release the note is written twice, the document and its plain
text, so the release before still reads it during an upgrade.
`sessions.setCoordinatorNote` takes editor JSON, and still takes plain
text, which is wrapped as a document; `sessions.digest` returns
`noteDocument` beside the plain `note`. The plain column, and the plain
text input, go a release later. `RichTextField` takes `hideLabel`, for a
field a heading beside it already names.
