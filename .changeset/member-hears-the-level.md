---
"@openokr/core": patch
---

A member who calls an administrator's read, such as the audit trail, the
deleted items or the AI budgets, is told "<action> needs a higher access level
than you hold." (403 on REST) instead of "No such workspace" (404), the same
answer every write gives and what docs/design/api-contract.md describes.
Somebody who is not an active member of the workspace is still told it does
not exist.
