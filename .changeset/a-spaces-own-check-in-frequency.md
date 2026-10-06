---
"@openokr/web": minor
---

A space's check-in frequency now takes effect (METHOD.md §7.1). It was stored
and read by nothing, so a team that chose every two weeks went on being asked
every week. A goal created in the space takes the space's frequency, and
changing it moves the open goals that follow it, each with its next due date
counted from the new frequency; a goal set to a frequency of its own keeps it.
The space card no longer offers "quarterly", which no goal checks in at.

A quarter's planning now opens four weeks before it starts, where it was
three.
