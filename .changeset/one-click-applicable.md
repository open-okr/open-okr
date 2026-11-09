---
"@openokr/web": minor
---

Each finding `alignment.read` returns now says whether one click applies it (`oneClickApplicable`) and names its second goal (`targetGoalId`, `targetGoalTitle`). Only an open relink naming both goals says yes, and `alignment.applyFinding` decides by the same rule. The alignment panel offers Re-parent only where the read says yes, so a relink with no new parent no longer shows a button that is then refused. The target's title is shown only to a reader who can see that goal.
