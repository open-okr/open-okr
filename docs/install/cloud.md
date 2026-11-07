# Start on the managed cloud

For a team that does not want to run anything. Sign up, name a workspace,
start.

> **No managed cloud is operating yet**, and there is no address to sign up
> at. The tenant provisioning, the operator console and the plan model are
> built and tested, and this page describes what they do. Until a vendor runs
> an instance, [one server](compose.md) or [Kubernetes](kubernetes.md) are the
> two ways to use OpenOKR.

## What you get

The same release that a self-hosted instance runs. **Nothing is
feature-gated.** A plan is a number of seats and a monthly AI spending cap,
and nothing else. The cloud sells operation, not features: the vendor runs the
machine, the upgrades, the backups and the monitoring.

| The vendor operates | You still own |
|---|---|
| The instance, its database and its backups | Your workspace, your people and your practice |
| Upgrades, on the same tagged releases | Whether to configure AI, and whose key |
| Availability and the status page | Your data, exportable as one signed archive at any time |

## Getting out

A workspace archive is one checksummed file holding every row and every
uploaded file, and an administrator can take one whenever they like. It is
sealed with a passphrase you choose, not with the cloud's own key, so it
imports into a self-hosted instance given that passphrase. That is deliberate:
the exit is part of the product rather than a support ticket.

## Support access

Nobody at the vendor can read your workspace by default. When you ask for
help, support requests a session, you grant it with a reason and a time box,
and every action they take is attributed to them in your audit trail. Ending
the session removes the access. The whole arrangement is visible to you on the
support screen in admin.

## Plans and seats

An administrator sees the workspace's plan, its seats and who holds each one
on **Admin, Plan and seats**. An operator changes the plan, on the workspace's
page in the console.

| Rule | Why |
|---|---|
| A seat is a person who is here or has been invited | An invitation holds a seat, so a full workspace is refused at the invitation rather than when somebody clicks the link |
| Guests and the two agents never hold a seat | Sharing is never a decision about money |
| A plan with fewer seats than are in use is refused, and the refusal names both numbers | The product never chooses who loses access. Suspend somebody first |
| The plan's AI allowance becomes the workspace's monthly AI cost budget | The same budget an administrator sets by hand on the AI screen |

## Operating an instance

For the vendor. Two variables make an ordinary install a cloud, and neither is
needed for anything else:

| Variable | What it does |
|---|---|
| `OPENOKR_CLOUD=true` | Tenant records, the operator console, and open registration unless you choose otherwise with `OPENOKR_REGISTRATION` |
| `OPENOKR_CLOUD_PLANS` | The plan catalogue. Without it nobody has a seat limit |

On [one server](compose.md), add them to `secrets/app.env` and run `./openokr up`.
On [Kubernetes](kubernetes.md), set `cloud.enabled` and `cloud.plans` in the chart's
values, and pass credentials with `extraEnvFrom`.

The operator console is at `/operator` and is not-found to anybody without a
grant. **The first operator is granted by the deployment, never by a screen**,
because a screen that creates the first operator can be reached by whoever gets
there first. Both people must have signed up.

```
# One server
./openokr operator --email ops@example.com --granted-by founder@example.com
./openokr operator --email ops@example.com --revoke --by founder@example.com

# Kubernetes
kubectl exec deploy/openokr -- node --experimental-strip-types --no-warnings \
  /app/migrator/packages/core/src/bin/cloud-operator.ts \
  --email ops@example.com --granted-by founder@example.com

# From a checkout
pnpm cloud:operator --email ops@example.com --granted-by founder@example.com
```

The plans an operator can choose from come from `OPENOKR_CLOUD_PLANS`, a JSON
list such as `[{"key":"team","name":"Team","seats":20,"aiMonthlyUsd":50}]`
(`seats` null is unlimited). Without it the only plan is Free, with no seat limit.
`OPENOKR_CLOUD_DEFAULT_PLAN` names the plan a new workspace starts on. Without it
a new workspace has no plan and no seat limit, so to limit a free plan, list it
in the catalogue and name it here.

**An operator creates a workspace** on the console's first page, naming who will own
it. With an account they own it straight away, and without one they get an invitation.
The operator does not become a member. A signed-in person can also start their own,
from the account menu, wherever sign-up is open to them. On a plan with a free tier,
`OPENOKR_CLOUD_FREE_WORKSPACES_PER_PERSON` limits how many free ones a person may own.
It defaults to 1, and zero means unlimited.

Nobody grants the role to themselves. Once one operator exists, only an
operator can grant another. Every grant and revocation is written to the
instance audit chain. An operator sets a workspace's plan, or a seat count of
their own for a contract no plan matches, on the workspace's page in the
console, with a reason the customer reads in their own audit log.

## Running your own

Anybody may run a cloud from this code under the same licence. If you change the
code and offer it over a network, you publish your changes. These make the
instance yours without changing any code:

| Variable | What it does |
|---|---|
| `OPENOKR_INSTANCE_NAME` | What the product calls itself, including "{name} support" |
| `OPENOKR_SOURCE_URL` | Where every member is offered the source. Point it at your own if you changed the code |
| `OPENOKR_TERMS_URL`, `OPENOKR_PRIVACY_URL` | Named on the sign-up page. Nothing shows until you set them |
| `OPENOKR_SUPPORT_EMAIL` | Who a customer writes to about their plan |

## What differs from self-hosting

| Difference | Detail |
|---|---|
| Registration | Open, because a cloud belongs to nobody. A self-hosted instance closes registration behind its first account |
| Plans and seats | The cloud counts seats. Self-hosting does not |
| Suspension and closure | A cloud workspace has a lifecycle the vendor operates. Nothing is erased without a retention window somebody set |

## Next

- [The first run](first-run.md): the same wizard, minus the install.
- [Administrator guide](../admin/README.md).
