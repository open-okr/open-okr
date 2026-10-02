---
"@openokr/web": minor
---

The quality checks now coach rather than refuse, following METHOD.md §4 as
revised for Phase 9, and each one can be set to block, warn or off.

- **Objectives.** An objective that starts with an action, such as "Launch
  an Awesome MVP", is a warning rather than a failure: Doerr's and Wodtke's
  own examples do it. "Cannot tell" now passes with a tip instead of warning
  on most well-formed objectives. A four-digit year no longer counts as a
  metric, there is no lower word limit, and going over five company
  objectives warns.
- **Key results.** Six or more key results, a key result with no numbers in
  its text, and an activity measure all warn. A key result tagged leading is
  never flagged as activity. Tagging leading or lagging is optional, and an
  all-lagging set is a note rather than a warning. A missing target, due date
  or owner still blocks; a missing baseline warns.
- **Word lists.** "to" is no longer read as a reason, so "Increase revenue
  from $2M to $3M" is flagged as a metric movement. "bring" counts as a
  movement verb.
- **Levels.** `practice.update` sets any check to block, warn or off
  (`"checks.OBJ-1": "block"`), and strict mode raises every check to block.
  "Coach strictness" at strict still means the same.

Two §11 thresholds changed: "Objective length bounds" (4 to 18) became
"Objective length limit" (18), and "Strength score warn weight" (0.5) is new.
A workspace that had changed the length bounds reads 18 until `pnpm
db:change` runs, which carries its upper bound across.
