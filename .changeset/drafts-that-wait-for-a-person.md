---
"@openokr/web": minor
---

"New objectives mid-cycle start as" now does what it says (METHOD.md §2.9).
Under "Draft published by its owner" or "Draft approved by the reviewer", an
objective added after the team publication window starts as a draft that owes
no check-in. Its champion publishes it from the OKR list or the drawer, and it
goes live, or waits for its reviewer's approval where the workspace asks for
that; only the reviewer approves. Two new actions, `goals.publishDraft` and
`goals.approveDraft`, refuse anybody else with a reason that names the
setting. `goals.tree` answers each objective's `draftState` and the reader's
`viewerId`. Under the default, "Live", nothing changes.
