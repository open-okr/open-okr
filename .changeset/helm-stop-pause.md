---
"@openokr/web": minor
---

The Helm chart stops a pod without failing a request. The web container pauses 10 seconds before SIGTERM (`shutdown.preStopSeconds`, 0 removes it) while the load balancer stops sending to it, the server drains for up to 20 seconds (`shutdown.drainSeconds`, passed as `OPENOKR_SHUTDOWN_SECONDS`), and the pod's termination grace period is the two plus 15 seconds, 45 by default rather than Kubernetes' 30. Values reused from 0.7.0 get the same three. A drain outside 1 to 300 seconds or a negative pause is refused at render time.
