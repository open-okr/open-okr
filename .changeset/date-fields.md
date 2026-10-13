---
"@openokr/web": patch
"@openokr/ui": patch
"@openokr/core": patch
---

Dates say when they are.

Due dates, cycle and planning-session dates, a new cycle's date, task and
board due dates, a recovery's due date and a session's actions now say the
date in words beside the field: "in 12 days", "today", "3 days ago", or
"Sep 2027" for a date further away.

A key result due outside its cycle is warned about in the OKR list and drawer,
and is still saved: nothing in the method forbids it.

For API clients: a task's due date and an initiative's start and end must be
written as YYYY-MM-DD, as a key result's due date already had to be. Anything
else is refused with a message.
