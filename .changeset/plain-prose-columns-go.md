---
"@openokr/web": minor
"@openokr/core": minor
"@openokr/db": minor
---

Session prose is stored as documents only.

The monthly review's shifts and decisions, the quarterly review's management
answers and private stage notes, the weekly note for leadership and the
revalidation's two notes were written twice in 0.3, as a document and as
plain text. Migration 0144 drops the plain text. It first checks that every
piece of prose has its document, and if any does not, as on an instance that
came straight from 0.2, it refuses before dropping anything and names what is
waiting: run `pnpm db:change`, then start again. Nothing a person sees
changes.

`sessions.setShifts`, `sessions.recordDecision`,
`sessions.setManagementAnswer`, `sessions.setStageNote`,
`sessions.setCoordinatorNote` and `workflow.setRevalidation` take editor JSON
only and refuse a string, as the 0.3 notes announced. The read actions keep
their plain text fields, computed from the document.
