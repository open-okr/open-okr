---
"@openokr/core": minor
---

A new action, `blockers.raise`, lets a key result's owner (or their agent)
raise a blocker at check-in time without a session. It takes the same type,
owner and next action as a session blocker, is due by the goal's next
check-in, and shows on the space's blocker board for the weekly session to
discuss. It is in the default `core` agent toolset, and the weekly check-in
prompt uses it for a key result that is actually blocked.
