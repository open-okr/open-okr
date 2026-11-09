---
"@openokr/web": patch
---

Expired support sessions are ended every five minutes, so the owner's screen stops showing them as live. `pnpm cloud:support-sweep` does it now, for an instance running with `OPENOKR_SCHEDULER=off`.
