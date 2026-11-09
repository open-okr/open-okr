---
"@openokr/web": minor
---

A dependency in the register can name the key result that delivers it, and the register, the goal page and the monthly review show whether it has: Delivered once that key result reads 100%, Not delivered yet before, and Stopped when it is removed or its objective closed short. The depending team names it with "Delivered by" on the cycle's register or with `goals.setDependencyProvider`, and the providing team can name one of its own as it confirms. The key result must belong to a team's objective, and naming a different one asks the providing team to confirm again. A reader who cannot open the providing objective sees the team and no title or state. Delivery settles nothing: publish gate 4 still needs a confirmation, an escalation or a risk owner. Migration 0162 adds `key_result_dependencies.provider_key_result_id`.
