---
"@openokr/core": patch
---

A support session sees the workspace as a member does, never past the level
the customer granted.

A read-only support session saw no goals and no spaces: its binding was on
the workspace alone, and every goal and space has access of its own. The
operator now gets the built-in Viewer role (Member for an edit grant), and
access treats them like a member up to the granted level, so a read-only
session reads everything a member reads and still changes nothing.
