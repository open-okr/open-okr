---
"@openokr/web": minor
---

A managed cloud can now change a workspace's plan, and grant its first
operator without writing SQL.

Nothing wrote a tenant's plan or seat count after the tenant was created, so
no seat limit could ever apply. An administrator now changes plan on Plan and
seats, which also lists who holds each seat, and an operator sets a plan, or a
seat count of their own, from the workspace's page in the console. Both follow
one rule: a plan with fewer seats than are in use is refused, and the refusal
names both numbers, because the product never chooses who loses access. The
plan's AI allowance becomes the workspace's monthly AI cost budget.

`pnpm cloud:operator --email <address> --granted-by <address>` grants the
operator role and `--revoke` takes it away. Nobody grants it to themselves,
once one operator exists only an operator may grant another, and every grant
is written to the instance audit chain.

Self-hosted instances are unchanged: they have no tenants and no plans.
