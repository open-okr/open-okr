---
"@openokr/web": minor
---

A KPI can now be judged in its own units (METHOD.md §6.2, §6.4). `kpis.create`
and `kpis.update` take a target type (stay at or above, stay at or below,
increase to, decrease to, stay within a range) and green and red values, or a
green band for a range. With them, inside green is healthy, past red is
unhealthy, and between is watch, so uptime at 95% against a red boundary of
99.5% now reads unhealthy where the ratio to target called it healthy. A KPI
with no thresholds keeps the ratio as before, and every read says which basis
it used. The grid colours each period by its own band. Two aggregates join:
last value and first value, for balances and headcounts. Existing KPIs take
the target type their direction implies.
