---
"@openokr/web": patch
---

A blocker raised in a weekly session now reaches its owner's review inbox,
and closing someone else's blocker or commitment needs access to their space.

Every blocker, whether raised in a session's diagnose step or from a chat
command, was stored without the goal it belongs to. The review inbox decides
who may see a blocker by its goal, so it skipped every one of them, and
"blockers you own" was always empty. New blockers record their goal, and
`pnpm db:change` repairs the ones already stored.

Resolving a blocker, handing it to someone else and closing commitments used to
check only that the caller could edit something in the workspace. A member
with no access to a space could act on its blockers and commitments if they had
an id. Each is now checked against the space or goal it belongs to, and a
commitment id that does not exist is refused rather than counted as closed.

A blocker's 24-hour clock now follows the workspace's own blocker clock
setting, as the board and the reminders already did.
