---
"openokr": patch
---

An OIDC provider can be configured, and the AI spend cap is read.

Two writes and reads ran on a connection with no tenant setting, which is the
same class the row-level-security fixes closed in single sign-on and directory
sync. Postgres answered correctly both times and nothing said so.

`POST /api/v1/admin/sso` inserted with `current_setting('app.workspace_id')`,
which raises rather than returning null when the setting is absent, so **no
OIDC provider could be created on any instance, by any route**. The admin
screen posts there and nowhere else, so everything downstream of a provider
existing was unreachable: the sign-in buttons, the workspace a person lands
in, and enforcement. Creation moved into `packages/core`, takes the workspace
it is given and runs inside it, which is the shape directory-sync tokens have
had since they were fixed.

The per-workspace AI run cost cap was read unscoped against `workspaces`,
which carries the tenant floor, so the read matched nothing and the hardcoded
default of 2 USD took over. `agentRunCostCapUsd` has never had an effect: a
higher cap was ignored and so was a lower one, while the screen that sets it
reported success. Zero now means zero rather than unset.

No migration. An instance that had set a cap will find it applied on the next
agent run.
