---
"@openokr/web": patch
---

Seven places that ignored a workspace's own thresholds now read them.

A workspace can tune its method thresholds on the rhythm settings page, but
several screens and writes used the standard values regardless:

- A new KPI's healthy and watch corridor.
- The confidence dial in a session. It also labelled 0.4 as "Low", which the
  method calls medium; its shortcuts are now Critical, Medium and High.
- The goal page's strength score colours.
- The weekly digest's blocker clock.
- The impact a carried-forward item gets in the next cycle.
- The number of annual strategies phase 0 asks for.
- The status given to a check-in imported from FlowyTeam.
