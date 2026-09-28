---
"openokr": patch
---

A calculated KPI no longer loses its value when a source is recorded mid-period.

Recording a daily value on any day but the first of the month wiped the
monthly total of any KPI calculated from it, because the recalculation looked
for a month starting on that day, found none, and saved an empty value over
the real one. Each calculated KPI now recalculates for its own period.
