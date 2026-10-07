---
"@openokr/web": minor
---

A cycle keeps the OKR levels it began with.

A cycle now takes the practice's levels in use (company, department, team,
and individual where it is on) when it is created. Turning a level on or off,
or choosing a profile that does, changes the cycles that have not started
and leaves a running or closed one as it was, so no objective is ever left at
a level that no longer exists.

The level picker when drafting, the level chips on the OKRs screen and a new
objective added from the list offer only the levels the cycle uses, plus any
level an objective in it already has. Creating an objective at a level its
cycle does not use is refused with the reason, from every surface.
`cycles.levelsInUse` answers which levels a cycle offers.
