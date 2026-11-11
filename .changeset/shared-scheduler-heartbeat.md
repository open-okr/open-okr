---
"@openokr/web": patch
---

`/api/status` now reads the same scheduler health from every pod. Each scheduled job runs on one pod, and the heartbeat lived in that pod's memory, so behind a load balancer a healthy scheduler read as degraded whenever another pod answered. The pod that completes a run now records the time in the database too.
