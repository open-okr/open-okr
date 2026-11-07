---
"@openokr/web": minor
---

A provider can now give each plan an allowance of AI credits on its own key, with `aiCredits` in the catalogue. A workspace's own key spends none. With none left, AI pauses until the 1st with a banner saying so, and everything else keeps working. Background agents can use at most half the allowance by default.

A deployment key set with `OPENOKR_AI_PROVIDER` now serves every workspace with no provider of its own. **On a self-hosted instance that sets this, AI turns on for those workspaces**, which is what the setting always said it did. `aiMonthlyUsd` is gone from the plan catalogue: use `aiCredits`.
