---
"@openokr/web": minor
---

A goal no longer has to name a reviewer.

The reviewer is now a practice setting: off, optional (the default) or
required. A goal without a reviewer owes no acknowledgement on its
check-ins, and no escalation ladder names one. With reviewers off, every
existing reviewer stays on their goals and is simply not asked to
acknowledge. With reviewers required, creating a goal without one, or taking
one off, is refused with the reason, from the screen, the API and the
command line alike.

The drafting form offers "No reviewer" after the members, and the goal page
can take a reviewer off ("Nobody"). Taking a reviewer off clears the
acknowledgements they still owed. `goals.read` and `goals.list` return
`reviewer: null` for a goal without one, and `goals.reassignRole` accepts
`memberId: null` for the reviewer.

A migration drops the database's requirement for a reviewer. Every existing
goal keeps the one it has.
