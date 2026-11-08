# Start on the managed cloud

For a team that does not want to run anything. Sign up, name a workspace,
start. This page covers setups 1 and 2 of the four in
[Choose a setup](setups.md): using a managed cloud, and running your own.

> **OKRGoal, the managed cloud OKR Institute runs at
> [okrgoal.com](https://okrgoal.com), is not open for sign-up yet.** The
> workspaces, the operator console, plans, payment and the lifecycle are built
> and tested, and this page describes what they do. Until it opens,
> [one server](compose.md) or [Kubernetes](kubernetes.md) are the ways to use
> OpenOKR, and [Operating an instance](#operating-an-instance) is how to run a
> cloud of your own.

## What you get

The same release that a self-hosted instance runs. **Nothing is
feature-gated.** A plan is a number of seats and a monthly AI spending cap,
and nothing else. The cloud sells operation, not features: the vendor runs the
machine, the upgrades, the backups and the monitoring.

| The vendor operates | You still own |
|---|---|
| The instance, its database and its backups | Your workspace, your people and your practice |
| Upgrades, on the same tagged releases | Whether to configure AI, and whose key |
| Availability and the status page | Your data, exportable at any time as one encrypted archive |

## Getting out

A workspace archive is one checksummed file holding every row and every
uploaded file, and an administrator can take one whenever they like. It is
sealed with a passphrase you choose, not with the cloud's own key, so it
imports into a self-hosted instance given that passphrase. That is deliberate:
the exit is part of the product rather than a support ticket.

## Support access

Nobody at the vendor can read your workspace by default. When you ask for
help, support requests a session with a reason, you grant it with a time box,
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
| The plan's AI credits are spent only on your key | A workspace that adds its own key spends none, and an administrator's budget can only lower what is spent |

## Operating an instance

For the vendor. Two variables make an ordinary install a cloud, and neither is
needed for anything else:

| Variable | What it does |
|---|---|
| `OPENOKR_CLOUD=true` | Tenant records, the operator console, and open registration unless you choose otherwise with `OPENOKR_REGISTRATION`. Neither applies once a policy is saved, and finishing the setup wizard saves Invitation only ([Choose a setup](setups.md#the-settings-behind-each-setup)) |
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
list such as `[{"key":"team","name":"Team","seats":20,"aiCredits":2000}]`
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

## Taking payment

Billing is off until you turn it on. With it off, an operator sets each plan by hand.
Prices and currency are yours and live in your Stripe account, so nothing in the
release names one.

1. In Stripe, create a price for each plan, monthly, yearly or both, in whatever currency you sell in.
2. Name those prices in the catalogue:

   ```json
   [
     { "key": "free", "name": "Free", "seats": 10 },
     { "key": "team", "name": "Team", "seats": 50,
       "prices": { "month": "price_1Abc", "year": "price_1Def" } }
   ]
   ```

   A plan with no `prices` cannot be bought, only set by an operator, which is what a contract or an invoice customer uses.
3. In Stripe, add a webhook pointed at `https://<your instance>/api/billing/webhook`, sending `checkout.session.completed`, `checkout.session.async_payment_succeeded` and every `customer.subscription.*` event.
4. Set these, as a Secret on Kubernetes:

| Variable | Value |
|---|---|
| `OPENOKR_BILLING_PROVIDER` | `stripe` |
| `OPENOKR_STRIPE_SECRET_KEY` | Your secret key |
| `OPENOKR_STRIPE_WEBHOOK_SECRET` | The webhook's signing secret |
| `OPENOKR_STRIPE_AUTOMATIC_TAX` | `true`, once Stripe Tax is set up in your account |

Discounts are Stripe coupons, and customers can enter a promotion code at checkout.

**AI credits.** Give a plan `aiCredits` for a monthly allowance on your own key, set with
`OPENOKR_AI_PROVIDER` and `OPENOKR_AI_API_KEY`. A credit is worth one US cent of model
cost unless you set `OPENOKR_CLOUD_CREDIT_VALUE_USD`. A workspace that adds its own key
spends none. To sell more, give the plan `"aiTopUps": true`, create a one-off price in
Stripe in your own currency, and name it:

```
OPENOKR_BILLING_CREDIT_PACK={"priceId":"price_1Xyz","credits":1000,"months":12}
```

A pack lasts `months` from the day it is bought, twelve if you leave it out, and the
one that expires first is spent first. Changing `months` moves only the packs sold
afterwards. Nothing runs when a pack expires: it stops counting at that moment.
`OPENOKR_AI_TIER_MODELS` chooses which model each tier
uses on your key, and `OPENOKR_AI_PRICES` corrects a model's price without a release.

| What happens | Result |
|---|---|
| A payment fails | The plan stays while Stripe retries, and Plan and seats says so |
| A subscription ends, and the people fit the default plan | It moves there |
| It ends and they do not | It goes read-only until seats are freed or payment resumes. Nobody is removed |
| A plan with fewer seats is chosen | It takes effect at the period's end, with no partial refund. Refused below the headcount |
| A plan with more seats is chosen | It starts now, and Stripe charges the difference |
| An owner closes the workspace | Stripe stops renewing it at the period's end, nothing is refunded, and the owners and administrators are emailed the date it will be deleted |

**Closing.** An owner closes a workspace on Admin, General by typing its address.
Everything stays readable until `OPENOKR_CLOUD_CLOSURE_RETENTION_DAYS` days have passed,
which is 0, meaning never, until you set it. An owner who closed an active workspace can
reopen it until then. Seven days before deletion they are emailed again, when retention
is longer than a week. Only you can reopen one you closed, or one billing made read-only,
and only you can close one you suspended, so a suspension can serve as a legal hold.

**Erasing.** When the window has passed, `pnpm cloud:erase --write` deletes the
workspace: its rows in every table, its audit trail, its files and export
archives, its Stripe customer (Stripe keeps the invoices), and the accounts of
people who belong to no other workspace. It writes a receipt with nothing personal
in it, which `pnpm cloud:sweep --erased` lists. It is a dry run without `--write`.
It runs as the owner role, `DATABASE_ADMIN_URL`, because the application's own role
can never delete an audit row, and the application must be running, because it is
what deletes the files and the customer. Schedule it beside the backup:

```cron
30 3 * * * cd /opt/openokr && ./openokr erase --write >> /var/log/openokr-erase.log 2>&1
```

On Kubernetes, set `cloud.erasure.schedule`. Keep the log: after a restore it is
what names the workspaces to erase again ([restore](../runbooks/restore.md)). The
operator console counts closed workspaces past their window, so a schedule that
never runs shows. Backups hold erased data until they expire, so make them expire
within your promise: `OPENOKR_BACKUP_RETENTION` counts backups, not days.

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
| Registration | Open while no policy is saved, because a cloud belongs to nobody. A self-hosted instance closes registration behind its first account. The setup wizard saves Invitation only on either, and a saved policy wins |
| Plans and seats | The cloud counts seats. Self-hosting does not |
| Suspension and closure | A cloud workspace has a lifecycle the vendor operates. Nothing is erased without a retention window somebody set |

## Next

- [The first run](first-run.md): the same wizard, minus the install.
- [Administrator guide](../admin/README.md).
