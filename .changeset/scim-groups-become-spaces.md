---
"openokr": minor
---

A directory group becomes a space, and its membership becomes the space's.

Adding somebody to a group in the identity provider puts them in the matching
space here, with the access that space carries. Removing them takes it back.
Renaming the group renames the space rather than making a second one.

**Losing a group is not leaving the workspace.** Somebody removed from a group
loses that space and keeps everything else; whether they are in the workspace
at all is a separate question the user side of directory sync answers.

**Deleting a group empties its space and leaves the space standing.** A
directory saying who works together is not permission to put a workspace's
goals, tasks and documents out of reach. Archiving a space stays an
administrator's decision.

A space with members needs somebody managing it and no directory says who, so
the first person a group brings gets the role and a successor is appointed
before the last manager leaves. An administrator can appoint whoever they meant
to.

Upgrading applies migration 0095.
