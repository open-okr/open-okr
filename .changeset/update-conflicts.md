---
"@openokr/web": minor
---

`initiatives.update`, `tasks.update`, `documents.update`, `kpis.update`, `spaces.update` and `cycles.update` take an optional `read`: the values you read for the fields you change. When it is sent, a field somebody changed since is refused with `409 conflict`, the values stored now and who changed it, and nothing is written. A change to a field nobody else touched still saves. A call that sends no `read` writes exactly as before.

The screens that edit them send what they read: an initiative's status and capacity, a task's due date, how a KPI is judged with its owner and tier, a space's name and mission, and a cycle's setup card and publication deadline. When somebody changed the same field first, the screen says who and what it reads now, and offers Keep mine or Take theirs instead of saving over it.
