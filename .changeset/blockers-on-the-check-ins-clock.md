---
"@openokr/web": minor
---

A blocker's next action is now due by the next check-in of the goal it
blocks, not 24 hours after it is opened (METHOD.md §7.3). The owner is
reminded the day before that check-in, and the coordinator hears when it
passes with the action still open. The sponsor hears only where the
workspace turns on "Sponsor in escalation ladders", once the check-in after
that one has passed too. The board, the space home, the session and the
weekly digest all read the same clock, and the session shows each blocker's
due date.

Blockers gain two types, "approach not working" and "other". The rhythm
settings lose "Blocker clock", and "Blocker ladder" is now one number: how
many days before the check-in the owner is reminded. A data change drops the
old hour-based values and moves each open blocker's deadline to its goal's
next check-in, never earlier. `sessions.blockerStatus` returns `dueOn`.
