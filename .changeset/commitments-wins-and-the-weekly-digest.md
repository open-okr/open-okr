---
"@openokr/web": minor
---

The weekly check-in's third step is now "Commitments and wins" (METHOD.md
§7.2). Last week's commitments are closed with a line on why where it helps,
each with its own delivered or not-delivered answer; until now the form let
only one be answered per press. This week's are three or four, where it was
two or three, and the session names the week's wins.

The weekly digest names the wins, lists open blockers with their next
actions, and names the space's stale goals when there are any, which is how
the sponsor sees them now that the check-in ladder stops at the coordinator.

`sessions.setWins` names the wins, `sessions.closeCommitments` takes a note
per commitment, and `sessions.read` returns `wins` (migration 0130).
