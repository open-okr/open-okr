---
"@openokr/web": minor
---

A drafted recovery OKR now passes the product's own checks (METHOD.md §6.5).
It is committed; its objective names what the KPI protects with no number in
it ("Operating margin back where the business can rely on it"), and its
description names the KPI and leaves the why to its owner. The first key
result is the KPI itself, from its reading to its healthy boundary, and reads
the KPI. Then come up to three leading drivers that are below their own
targets and have an owner; a driver already at or past its target is skipped,
which removes the key result that asked a number to go the wrong way. The
"define the first leading driver to move" placeholder is gone. The coach now
proposes a recovery at once when a KPI falls from healthy to unhealthy in one
period, and after two unhealthy periods otherwise. `kpis.recoveryDraft` adds
`description`, `kind` and each key result's `kpiBacked`.
