# @openokr/db

## 0.2.0

### Minor Changes

- [#110](https://github.com/open-okr/open-okr/pull/110) [`fecd1c1`](https://github.com/open-okr/open-okr/commit/fecd1c18556e938627c4f5094b22a751297aedca) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Stage 9 of the quarterly review is "Keep, modify, abandon or defer"
  (METHOD.md §8.8). An objective now closes as one of five decisions:
  achieved, keep, modify, defer or abandon, each with its meaning on the
  screen. An unfinished aspirational objective shows "Proposed: Keep" where
  the workspace carries forward, and the room still chooses.
  
  A deferred objective is fed forward to the next cycle's issue list when the
  cycle is archived, at the carry-forward impact, once.
  
  Migration 0136 widens the close decision on goals and on review decisions.
  Every stored decision stays valid.

- [#110](https://github.com/open-okr/open-okr/pull/110) [`bf256ef`](https://github.com/open-okr/open-okr/commit/bf256eff36f8e8b601559bc381c624b2fa2ad9eb) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Closing a cycle carries every kept or modified objective into the next one
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

### Patch Changes

- Updated dependencies []:
  - @openokr/config@0.2.0

## 0.1.2

### Patch Changes

- Updated dependencies []:
  - @openokr/config@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies []:
  - @openokr/config@0.1.1

## 0.1.0

### Patch Changes

- Updated dependencies []:
  - @openokr/config@0.1.0
