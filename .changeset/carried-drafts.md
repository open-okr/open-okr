---
"@openokr/web": minor
"@openokr/core": minor
"@openokr/db": minor
"@openokr/method": minor
---

Closing a cycle carries every kept or modified objective into the next one
as a draft (METHOD.md §8.9). Each key result starts from the last value it
recorded, with the same target. A milestone already done stays behind, and
a measured baseline comes back as a metric with its target to set. The
draft is an ordinary objective: it passes Phase 4's checks and Phase 5's
gates like any other, and one somebody deletes stays deleted. An objective
whose champion has left is named on the closed cycle instead of carried.

A deferred objective reaches the issue list whether it was deferred at the
review or from its own page, whichever was decided later. The lowest
process-health statement is now called the next cycle's improvement action
in phase 3.

Stage 10 of the quarterly review is "Learnings". The minutes report the
committed key results met apart from the cycle score, on the screen and in
both exports.

Migration 0137 adds `goals.carried_from_goal_id`, nullable, with a unique
index per cycle. `cycles.feedForward` and `cycles.close` report `drafts`
and `notCarried`, and `workflow.read`'s closure reports `carriedDrafts` and
`notCarried`. `sessions.minutes` reports `summary.committed`.
