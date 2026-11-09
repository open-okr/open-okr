---
"@openokr/web": minor
---

A cycle whose last day has passed now moves to Closing on its own, within the hour after the workspace's midnight, with an audit row. A facilitator can start closing early from phase 7 and take it back while the end has not passed. Closing stops publishing and nothing else: check-ins, edits and scores carry on until the cycle is closed. The cycle screen's header shows the status. A cycle created for a period that is already over starts as Closing; `cycles.create` takes an optional `asOf` date for a replay that writes history in order. `pnpm cadence:sweep` moves ended cycles too.
