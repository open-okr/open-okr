---
"@openokr/web": minor
---

Prometheus can scrape `/api/metrics` with the instance's scrape token, `OPENOKR_METRICS_TOKEN`, which `./openokr up` and the Helm chart generate. The Compose observability profile works with no manual step. Without a valid token or an administrator session the endpoint answers not-found.
