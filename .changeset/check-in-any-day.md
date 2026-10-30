---
"@openokr/web": minor
"@openokr/core": minor
"@openokr/method": minor
"@openokr/ui": minor
---

A member can check in on any day, not only when the goal is due.

The check-in page lists the member's other goals under "Update any time". A
goal that is not due offers "Post an update", which opens the usual composer.
An update posted more than the cadence tolerance before the due date is an
extra update: it moves health and progress, and the due date, its nudge and
the blocker clock stay where they were. Before this, an early check-in used up
the next period and that Monday's reminder never came.

The check-in page and the Review inbox now list the same goals, so the Review
can no longer say a check-in is owed while the check-in page says nothing is
due. The rhythm share in the review diagnostic counts an extra update as
answering nothing, the way the cadence does. `goals.due` accepts up to 366
days ahead.
