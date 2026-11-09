---
"@openokr/web": patch
---

Two people pressing continue on the same session stage move it once, not twice. `sessions.advanceStage` takes an optional `fromStageKey` and refuses an advance from a stage the session has already left.
