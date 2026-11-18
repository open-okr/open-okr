---
"@openokr/web": patch
---

./openokr upgrade keeps the newest three backups on macOS too. The pruning step used a GNU-only option of head, so on macOS it printed an error and removed nothing.
