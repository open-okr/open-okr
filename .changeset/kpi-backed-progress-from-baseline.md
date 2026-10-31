---
"@openokr/core": minor
"@openokr/method": minor
---

A key result that reads a KPI now measures progress from its own baseline to
its own target.

The KPI's latest reading is still the key result's current value. What changed
is the percentage: it used to be the KPI's achievement against the KPI's own
target, so "Raise deflection from 31% to 35%" at a reading of 31 showed 89%. It
now shows 0%, the same as any other key result at its baseline. Changing a
KPI's target no longer moves the key results that read it. Goal progress
recomputes the next time the KPI is recorded or the goal changes.
