---
"@openokr/web": minor
---

A KPI under a recovery objective now shows its real band, with "recovering"
beside it, never instead of it (METHOD.md §6.4). The grid, the KPI page, the
recovery board and the driver trees all read the band, and the recovery's own
progress sits next to the reading rather than a projected "displayed health".
The board keeps a KPI on it for as long as its recovery is open, whatever its
band. `kpis.grid`, `kpis.detail`, `kpis.recoveryBoard` and the tree reads add
`recovering`, the stored state is never `recovering` any more, and existing
rows are rewritten to their band. Driver tree links say whether a KPI is part
of its parent's formula or believed to move it.
