---
"@openokr/web": minor
---

The quarterly review's scoring and root causes follow METHOD.md §8.3 and §8.4.
Scoring cannot close while a committed key result is below 1.0 with no
explanation; the refusal names each one. Root causes are asked of every
aspirational key result below 0.6 and every committed one below 1.0, where
every key result used to be held to 0.6. A ninth cause, "Other, described in
a line", is named with its line, and a second cause can be named beside the
first. Where a workspace makes root causes optional, the stage says so. The
minutes count key results below their own threshold.

`sessions.setRootCause` takes `secondaryCauseKey`, and `sessions.rootCauses`
returns `thresholds`, each row's `kind` and second cause, and `required`
(migration 0134).
