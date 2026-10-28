---
"@openokr/core": minor
"@openokr/web": minor
---

A reviewer owes one acknowledgement per goal, on its latest check-in.

Review listed every unacknowledged check-in separately, so a goal with weekly
check-ins added a row each week and a reviewer could face fifty rows a year
overdue for two goals. It now lists one row per goal, for the latest check-in,
and says how many earlier ones it covers. Acknowledging it closes those earlier
ones too, because the latest says where the goal stands. A closed goal, or a
goal in a closed cycle, owes no acknowledgement and the reviewer is no longer
nudged about it.

`goals.acknowledgeCheckIn` returns `settledEarlier`, the number of earlier
check-ins it closed. METHOD.md §2.5 states the rule.
