---
"@openokr/web": minor
---

The monthly review has a fifth panel, "Continue, update, start or stop"
(METHOD.md §7.5). It lists what was started mid-cycle, which key results had
their target updated once the plan was published, with the value each
replaced, and which objectives were stopped, with their reason. An objective
can be stopped from the review itself: it closes as abandoned with a line on
why, exactly as it does from its own page.

`sessions.monthlyRecord` returns `stops` and `updates` beside `additions`.
Nothing new is stored.
