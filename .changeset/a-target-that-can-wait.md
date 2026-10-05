---
"@openokr/web": minor
---

A key result may now be saved before its target is known, and an addition
says what it still lacks (METHOD.md §2.9). `goals.addKeyResult` no longer asks
a metric or a maintain key result for its `targetValue`; one saved without it
reads "no target yet", fails the completeness check, reads 0% progress and
forecasts nothing, and its first target asks for no reason. `targetValue` is
`null` in every read until it is set. An objective or a key result added
mid-cycle is live once it passes the checks set to block, and until then the
OKR list, the drawer and the diagram mark it "Draft: needs" what is missing,
such as a target or a due date. `goals.tree` answers the same as a `draft` on
each objective and key result, null when it is live.
