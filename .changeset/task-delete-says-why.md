---
"@openokr/core": patch
---

A member who can read and edit a task but cannot delete it is told
"tasks.delete needs a higher access level than you hold." rather than "No such
task", the same answer goals.delete gives. Restoring a task answers the same
way. Somebody who cannot see the task is still told it does not exist.
