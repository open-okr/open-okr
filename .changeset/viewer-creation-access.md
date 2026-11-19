---
"@openokr/web": patch
---

Task creation and session scheduling now check the workspace role and the destination space. The role matrix adds a Sessions permission. Viewers who hold edit access to an objective can still add key results to that objective. Creation controls use the same access requirements as the actions behind them.
