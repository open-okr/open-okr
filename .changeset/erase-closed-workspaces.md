---
"@openokr/web": minor
---

A cloud can now erase a closed workspace once its retention window has passed, with `pnpm cloud:erase --write` on the deployment's schedule (`./openokr erase --write` in Compose, `cloud.erasure.schedule` in Helm). It deletes the workspace's rows in every table, its audit trail, its files and export archives, its Stripe customer, and the accounts of people who belong to no other workspace, then writes a receipt with nothing personal in it, which `pnpm cloud:sweep --erased` lists. Nothing is erased while `OPENOKR_CLOUD_CLOSURE_RETENTION_DAYS` is 0, its default. It runs as the database owner, because the application's own role still cannot delete an audit row, and it resumes where it stopped. The operator console counts closed workspaces past their window and shows one being erased, and a Stripe event for an erased workspace is acknowledged instead of refused.
