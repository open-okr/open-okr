---
"@openokr/web": minor
---

An objective or key result started mid-cycle now says so (METHOD.md §2.9).
Once the team publication window has closed and the cycle's set is published,
anything new is marked "Added mid-cycle" with its date in the OKR list, the
drawer, the diagram, the monthly review and the quarterly review's scoring
stage, and it is no longer judged by the set-level publish gates. Where the
workspace's "Reason when adding mid-cycle" is Required, the add rows and
"+ New objective" ask why before they save, and `goals.create` and
`goals.addKeyResult` refuse an addition without a `reason`; the reason is kept
in the objective's activity either way. Imports never mark anything.
