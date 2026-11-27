---
"@openokr/core": patch
---

The FlowyTeam import maps a source cycle onto the workspace's existing cycle for the same period instead of skipping it. Before, the current quarter, which every new workspace creates for itself, was skipped, and its objectives were left with a custom timeframe and no cycle, so they did not appear on Goals for that quarter. The existing cycle keeps its name and dates. The report lists each merged cycle, and the preview and the import treat it the same way.
