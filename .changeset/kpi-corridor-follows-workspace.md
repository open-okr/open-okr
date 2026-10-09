---
"@openokr/core": patch
"@openokr/db": patch
---

A KPI's healthy and watch thresholds follow the workspace unless the KPI sets
its own, so moving them on Rhythm recolours existing KPIs.

Each KPI used to copy the workspace's thresholds when it was created, so a
change on /admin/rhythm reached only KPIs created afterwards. Migration 0139
makes both columns optional, where empty means the workspace's current value,
and changing either threshold recomputes every KPI that follows it. A KPI
given its own line through `kpis.update` keeps it; sending null returns it to
the workspace. Run `pnpm db:change` after upgrading: data change
`0026_kpi_corridor_follows_workspace` clears every stored line that equals
the workspace's current one or the canon's 90 and 70, and rereads the band
of each KPI judged on the ratio.
