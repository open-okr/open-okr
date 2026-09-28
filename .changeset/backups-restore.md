---
"openokr": patch
---

Backups on Kubernetes now run, include your files, and are proved to restore.

- The Helm chart's backup job named a Kubernetes Secret the chart never
  creates, so every scheduled backup failed before it started. It now reads
  the chart's own Secrets, and uses the database admin address when one is
  set.
- It now backs up the uploaded files as well, when they live on the chart's
  own volume. Files in object storage are the bucket's to keep.
- Verifying a backup with `helm test` could never succeed, because of two
  faults in the verify job's script. Both are fixed.
- On Docker Compose, `./openokr restore` stops the application while it
  restores. Before, it could not replace a database the running server was
  connected to.

A restore drill now runs in continuous integration on both deployment
targets.
