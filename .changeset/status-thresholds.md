---
"@openokr/web": patch
---

The four `/api/status` thresholds are read from the stored instance settings as well as the environment, and an "unavailable" threshold at or below its "degraded" one stops the boot with a message naming both.
