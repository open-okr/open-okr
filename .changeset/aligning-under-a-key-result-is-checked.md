---
"@openokr/web": patch
---

Aligning a goal under a key result is now checked the way aligning it under a
goal always was. The key result has to belong to a goal you can see, and a goal
can no longer be placed under one of its own key results, or under a key result
of a goal below it, which made the alignment tree loop.
