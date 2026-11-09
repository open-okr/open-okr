---
"@openokr/web": patch
---

A quarterly cycle can no longer write the annual frame. `frame.set` takes an optional `cycleId`, the cycle the write is made from, and refuses a quarterly one; an annual cycle, or a call naming no cycle, writes as before. A quarterly cycle's phase 0 shows the frame read-only and links to the annual cycle.
