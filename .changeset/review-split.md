---
"@openokr/web": minor
---

The quarterly review can be held as two sessions (METHOD.md §8). With
"Quarterly review format" set to "Review and retrospective separately",
booking a quarter books the review, stages 1 to 4, and two working days later
the retrospective, stages 5 to 11. The retrospective reads the scores its
review recorded, so its root causes, diagnostic, close decisions and minutes
are the same as in one session. Each session's rail shows its own stages and
still counts them out of eleven.

`sessions.read` returns `reviewPart` and `reviewSessionId` (migration 0133).
