---
"@openokr/core": patch
---

Moving a workspace with its archive now points every mention and attachment
at the new workspace's members and files.

The import rewrote them in some rich text and not in the rest: a mention in
a check-in narrative, the annual frame, a cycle's baseline health or its
capacity cuts, or a KPI tree's description still named the member from the
workspace it came from. Each of these is now rewritten, as is what an agreed
annual frame held before a revision. A test reads the database and fails
when a table the archive carries gains a rich text column the import does
not rewrite.
