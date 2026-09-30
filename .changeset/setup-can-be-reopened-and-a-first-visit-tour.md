---
"@openokr/web": minor
---

The workspace's first-day setup can be opened again from admin, it counts its
own steps correctly, and everybody is offered a short tour on their first visit.

**Setup can be opened again.** Skipping every step of the first-day setup is a
working start, and until now it was also a final one: once finished, the setup
refused to appear, and nothing could bring it back. General in admin now has a
Workspace setup card. Opening the setup again takes you straight to it, and
every step shows what the workspace holds now, so skipping a step keeps the
answer you already gave. While it is open, every administrator is sent to it
from the Work Map until somebody finishes it. Opening it is audited and shows
in the activity feed.

**The count is right.** The setup said "Four questions" above a "1 / 5"
counter, because a fifth step, the starting templates, was added and the
sentence was not. The sentence now takes its number from the list of steps, in
English and in Bahasa Melayu.

**A tour on the first visit.** The Work Map offers each person a five-stop tour
the first time they open it: the map itself, Review, check-ins, the cycle strip
and ⌘K. It is a card on the page, under its heading, rather than an overlay,
so nothing is blocked while it is showing, and each stop outlines what it
names when that is on screen. Finishing it or ending it early is remembered for that person on
every machine.

**Everybody already in a workspace sees the tour once too**, the next time they
open the Work Map after this upgrade, because none of them has seen it either.
One press ends it for good.

This release adds a column to `workspace_members` (migration 0106). It is
nullable and additive, so the previous release reads the table unchanged
during a rolling upgrade.
