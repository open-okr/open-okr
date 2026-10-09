---
"@openokr/web": patch
"@openokr/ui": patch
"@openokr/core": patch
"@openokr/formats": patch
---

A goal's retrospective, an initiative's description in the decompose panel,
and what the number does not show in a quarterly review can be formatted.

All three use the same small editor as comments and check-ins: bold, italic,
strikethrough, code, bulleted and numbered lists, and links. The closed goal
and the review stage show what was written with its formatting, where they
showed one line of plain text.

The decompose panel still takes up to 1000 characters for each description.
Near the limit the field counts what is used, and past it says how much to
take out, and Create waits until it fits. The limit applies to that panel
only: an initiative created through the API or an import keeps its whole
description.

A retrospective of nothing but spaces is refused, as an empty one always was.
