---
"@openokr/core": patch
"@openokr/db": patch
---

Check-ins, key results and blockers now reach search and the copilot. Each of these writes recorded its activity against the objective or the space, and only that was indexed, so no check-in, and no key result or blocker after it was created, could be found by search or used by the copilot to answer a question. Objectives and key results created by carrying kept objectives into the next cycle, or by launching a KPI's recovery, are indexed too. After upgrading, run the data changes (`./openokr data-change`, or `pnpm db:change`) to queue what was written before: data change 0035 queues every check-in, key result, blocker and objective that neither index holds, and the relay indexes them in the background. An instance whose AI provider can embed text pays for those embeddings once.
