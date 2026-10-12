---
"@openokr/core": patch
---

An operator can be let into a workspace again after an earlier support
session ended. The guest the first session left was taken for a membership,
so every later request answered "You are already a member of this
workspace". It is now woken by the next grant, at that grant's level.
