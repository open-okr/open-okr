---
"@openokr/web": minor
---

Every key result now has a kind, metric, maintain, milestone or baseline
(METHOD.md §2.10), and existing key results written with a maintain direction
become maintain key results when the data changes run. A milestone or a
baseline can be added without numbers; a milestone is marked done through
`goals.updateKeyResult`, `goals.patchKeyResult` or a check-in, and a baseline
is done by its first recorded value, which becomes its baseline. Both read 0%
until then and 100% after. A kind the workspace has turned off is refused.

**An objective's progress no longer counts the goals aligned beneath it by
default** (METHOD.md §3.1): a child's work usually also moves its parent's own
key results and would be counted twice. A workspace that wants the old
behaviour turns on "Progress roll-up from aligned goals" in its practice
settings.
