---
"@openokr/web": patch
---

With billing on, a signed webhook from the payment provider now moves a workspace onto the plan it paid for. If a subscription ends, the workspace moves to the default plan when its people fit. Otherwise it goes read-only until seats are freed or payment resumes, and nobody is removed.
