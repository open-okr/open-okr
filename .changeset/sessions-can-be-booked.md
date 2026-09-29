---
"openokr": minor
---

Sessions can be scheduled from the browser, and a whole cycle can be booked
in one press.

Until now nothing on screen could create a session: after onboarding's first
weekly session, nobody could hold a check-in, a monthly review or a quarterly
review. The sessions screen and every space home now carry two controls:

- **Book the whole cycle** books a weekly check-in every week, a monthly
  review every month and the quarterly review at close, on the day and time
  you choose, in the workspace's timezone. Anything already booked is kept,
  nothing is booked in the past, and pressing it again books nothing.
- **Schedule one session** books a single ritual or a planning session.

The cycle's phase 6 ("Run the cadence") is now computed: it says which space
is missing which weeks, months or the closing review, and whether a decision
has been recorded. A session's time with no offset is read in the workspace
timezone, and its facilitator must be an active person in the workspace.

New API action: `sessions.bookCycle`.
