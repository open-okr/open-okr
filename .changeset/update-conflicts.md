---
"@openokr/web": minor
---

`initiatives.update`, `tasks.update`, `documents.update`, `kpis.update`, `spaces.update` and `cycles.update` take an optional `read`: the values you read for the fields you change. When it is sent, a field somebody changed since is refused with `409 conflict`, the values stored now and who changed it, and nothing is written. A change to a field nobody else touched still saves. A call that sends no `read` writes exactly as before.
