---
"@openokr/web": patch
---

One scrollbar on a long screen, not two.

Tailwind's `sr-only` is `position: absolute`, and an absolutely positioned box
with no positioned ancestor resolves against the initial containing block. Its
scrollable overflow then lands on the document rather than on the pane it sits
in.

The cycle drafting phase carries one `sr-only` label per form field, a few
hundred rows down, so the browser drew a document scrollbar beside the one the
content pane already had. The outer one moved nothing. Measured at 1440x900 on
`/cycle?phase=4`: `html.scrollHeight` 6151px against a `body` of 900px.

The content pane is now the containing block, so that overflow stays inside the
pane that owns it. Every screen keeps its own single scrollbar.
