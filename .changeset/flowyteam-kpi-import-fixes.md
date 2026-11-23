---
"@openokr/core": patch
"@openokr/importer": patch
"@openokr/method": patch
---

The FlowyTeam importer folds several values of one KPI period into one by the KPI's aggregate, imports KPIs whose owner no longer exists at workspace level, leaves a calculated KPI's typed values to its formula on every run, records each value's source id, and its dry run now counts the same rows as the real run. `kpis.record` takes an optional legacy key.
