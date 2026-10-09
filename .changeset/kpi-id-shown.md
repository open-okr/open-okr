---
"@openokr/web": patch
"@openokr/ui": patch
---

A KPI's ID is shown on its page, and the grid links to that page.

The kpi-records import names each KPI by its ID, and no screen showed one, so
a spreadsheet filled in with KPI titles had every row skipped. The ID is now
under the KPI's title on its own page, and each title in the KPI grid opens
that page, which before could only be reached from a tree.
