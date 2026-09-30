---
"@openokr/web": minor
---

A key result can be measured by a KPI from the browser, and recording the KPI
now moves it.

Drafting a key result on the cycle's phase 4 has a new "Measured by" choice.
It starts at "Measured by hand", which is how every key result worked before,
and lists every KPI in the workspace beside it. A key result read from a KPI
starts at the KPI's latest reading, takes its progress from the KPI's
achievement, and refuses a typed value until it is unlinked. A key result
drafted by hand can be linked later from the goal page, in the card that
already unlinks one.

Recording a value on the KPI grid used to move the KPI and nothing that read
it. The key result kept its old value and its goal kept its old progress until
somebody checked in on the goal for another reason. Now the same write moves
the key result, its goal and every goal above it. The same is true when a
calculated KPI changes because one of its sources did, and when a KPI's target
or direction is edited. A closed goal is left as it was closed, and its key
results cannot be linked until it is reopened.

For the API and the command line there are two new actions: `goals.linkKpi`
links a key result to a KPI, and `kpis.list` returns every KPI by title in one
query, for a picker.
