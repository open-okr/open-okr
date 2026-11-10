---
"@openokr/web": minor
---

The Helm chart can check a managed Postgres's certificate. `database.caBundle` names a ConfigMap or a Secret holding the provider's CA bundle, which every workload mounts; with it, connect with `sslmode=verify-full` rather than `no-verify`.
