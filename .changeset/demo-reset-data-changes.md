---
"@openokr/web": patch
---

`deploy/demo/reset.sh` now runs the data changes after the seed and before the cast accounts are made. A freshly seeded Northwind year still needed them: without them the copilot and search could not find any of the story's check-ins or key results, and some members and check-ins were missing a time zone or a reviewer.
