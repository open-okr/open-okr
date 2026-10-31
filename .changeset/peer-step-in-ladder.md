---
"@openokr/core": minor
"@openokr/method": minor
"@openokr/web": minor
"@openokr/ui": minor
---

A workspace can put a peer step in the check-in ladder.

The new practice setting "Peer step in the check-in ladder" is Off by default,
so nothing changes until a workspace turns it on. On, a goal whose check-in is
past its grace asks one teammate from its space to offer a hand, under the new
rule `checkin.peer`, before the reviewer hears; the reviewer joins at the
coordinator's day. A peer champions another goal in the same cycle, is up to
date on their own check-ins, can read the goal, and is not its reviewer or the
space's coordinator. The one asked least recently is chosen, and where nobody
qualifies the step is skipped.
