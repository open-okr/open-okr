---
"@openokr/web": minor
---

Only structural defects hold a set back from publishing now, and a cycle can
publish its company OKRs first and its department and team OKRs after.

- **Gate levels.** Each publish gate blocks, warns or is off. By default
  gates 1 and 2 block (every objective has a title, a champion and key
  results, and nothing fails a check set to block), gates 3 to 5 warn
  (alignment, dependencies, capacity) and gate 6 (a publication date) is off.
  A gate that warns is shown and coached on the publish screen and never holds
  publication. The governed profile makes gates 3 to 5 block.
- **An empty set cannot be published.** With every other gate passing on an
  empty set, gate 2 is what refuses a cycle with nothing drafted.
- **Two steps.** "Publish the company set first" publishes the company OKRs
  on their own, judged on their own, before the cycle starts; "Publish the
  department and team sets" follows. "Publish the set" still publishes
  everything in one go. The REST API takes `step: "company"` or `"teams"`.
- **Override.** Publishing past a gate that blocks still needs an
  administrator and a written reason, and a workspace can turn the override
  off ("Gate override" in its practice settings).
- **Binding phases** also hold publishing until drafting is complete.

A migration adds `cycles.company_published_at`. A cycle published before this
release reads as published in one go.
