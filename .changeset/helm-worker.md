---
"@openokr/web": minor
---

The Helm chart can run the outbox relay and the scheduler on their own pods. `worker.enabled=true` adds the Deployment `<release>-openokr-worker` (`worker.replicaCount`, 1 by default, with a disruption budget from two), with the same image, environment, service account and storage as the web pods, and sets `OPENOKR_RELAY` and `OPENOKR_SCHEDULER` to `elsewhere` on the web pods, which then only serve. The worker's pods carry their own name label, so the Service never sends them traffic. It needs storage every pod shares, a bucket or a `ReadWriteMany` volume, and the chart refuses it otherwise, and refuses an `extraEnv` that sets either variable while it is on. Off by default: an install that changes nothing keeps one Deployment.
