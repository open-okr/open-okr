---
"@openokr/web": minor
---

The Helm chart runs the data changes after every install and upgrade. A post-install and post-upgrade Job, `<release>-data-change-<revision>`, runs every data change not yet complete with the migration hook's database settings and the auth secret, for up to `dataChanges.timeBudgetSeconds` (240): at the budget it stops between two batches, names what is left and exits cleanly, so the next upgrade resumes it. A script that fails fails the release and the Job is kept for its log. `dataChanges.enabled=false` turns it off, and the install notes, the chart README and the Kubernetes guide give the `kubectl exec` line that runs them by hand. `pnpm db:change` gains `--max-seconds <n>`, which takes the runner's lock without waiting (another run going means nothing to do) and stops between batches at the budget; exit 2 is now a usage error.
