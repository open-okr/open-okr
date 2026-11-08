# Choose a setup

One release of OpenOKR runs four ways. Pick the one that matches who will use it,
then install as usual on [one server](compose.md) or [Kubernetes](kubernetes.md).
The install is the same for all four. A few settings decide which one you get.

| Setup | For | Workspaces | Who makes a workspace | Sign-up | Plans and payment |
|---|---|---|---|---|---|
| **1. A managed cloud** | A team that does not want to run anything | One per team, more as it grows | Anybody, by signing up | Open | The provider's plans, paid by card |
| **2. Your own cloud** | A company selling OKR software to its customers | One per customer | Customers sign up, or you make one for them | Open, or company email only | Your plans, prices and currency, through Stripe or by invoice |
| **3. A group of companies** | A group running its companies on its own servers | One per company | Your IT, as the operator | Company email, or invitation | None, and no seat limit |
| **4. One organisation** | A company, university or public body on its own servers | One, or several | One: nobody, it comes with the install. Several: your IT | Invitation | None, and no seat limit |

**Every setup runs the same code and has every feature.** Nothing is sold as an
upgrade. A cloud's plan is a number of seats and an AI allowance, and nothing else.
Self-hosting is never seat-limited.

**A workspace stands alone.** It has its own people, goals, settings and admin, and
row-level security in the database keeps each one's rows away from every other's. One
person can belong to several and switch between them. OKRs and reports do not roll up
across workspaces yet, so an organisation that wants one shared tree of OKRs uses one
workspace with a space per team, not several workspaces.

## Who does what

The same four people appear in every setup. What changes is who they are.

| Person | 1. Managed cloud | 2. Your own cloud | 3. Group | 4. One organisation |
|---|---|---|---|---|
| **Operator**: runs the instance from `/operator`, outside every workspace | The provider's staff | Your staff | The group's IT | Your IT, once there are several workspaces |
| **Company administrator**: owns the company's workspace or workspaces | Signs up and pays | Signs up, or is invited by you | Invited by the operator, one per company | Owns the first workspace, or every division's |
| **Workspace administrator**: made an administrator by the owner | Runs invitations and settings | The same | The same, for their company | The same, for their division |
| **Member** | Does the work | The same | The same, and sees only their own company | The same, and sees only the workspaces they were asked into |

An administrator has full access to their workspace, as its owner does. The operator
sees each workspace's name and counts, never what anybody wrote in it.

## The settings behind each setup

Three switches, each independent of the others:

| Switch | What it brings |
|---|---|
| `OPENOKR_CLOUD` | Several workspaces under one operator: the operator console, a lifecycle each workspace moves through, and instance-wide settings kept away from each workspace's administrators |
| `OPENOKR_CLOUD_PLANS` | Plans and seat limits. Leave it unset and nobody has a limit and no plan screen appears |
| `OPENOKR_BILLING_PROVIDER` | Taking payment. `stripe`, or unset to set plans by hand |

| Setting | 1. Managed cloud | 2. Your own cloud | 3. Group | 4. One workspace | 4. Several workspaces |
|---|---|---|---|---|---|
| `OPENOKR_CLOUD` | `true` | `true` | `true` | Unset | `true` |
| `OPENOKR_CLOUD_PLANS` | The provider's | Yours | Unset | Unset | Unset |
| `OPENOKR_BILLING_PROVIDER` | `stripe` | `stripe`, or unset | Unset | Unset | Unset |
| `OPENOKR_REGISTRATION` | Unset: open on a cloud | Unset, or `company_domains` | `company_domains` or `invite_only` | Unset: closes behind the first account | `invite_only` |

**Set `OPENOKR_REGISTRATION` whenever the cloud flag is on and the instance is not
public.** With the flag on and no policy saved, sign-up is open to anybody who can
reach the instance unless you say otherwise.

**A saved policy wins over the variable, and finishing the setup wizard saves one:
Invitation only.** After that, `OPENOKR_REGISTRATION` changes nothing. On an
instance without the cloud flag, the Registration card on Admin, General changes
the saved policy. With the cloud flag on, that card is hidden.

**Where the settings go.** On one server, add them to `deploy/docker/secrets/app.env`
and run `./openokr up`. On Kubernetes they are values in the chart:

| Variable | Helm value |
|---|---|
| `OPENOKR_CLOUD` | `cloud.enabled` |
| `OPENOKR_CLOUD_PLANS` | `cloud.plans` |
| `OPENOKR_CLOUD_DEFAULT_PLAN` | `cloud.defaultPlan` |
| `OPENOKR_REGISTRATION` | `instance.registration`, which the chart accepts as `auto`, `open` or `invite_only` and refuses as `company_domains` |
| `OPENOKR_INSTANCE_NAME`, `OPENOKR_SOURCE_URL`, `OPENOKR_TERMS_URL`, `OPENOKR_PRIVACY_URL`, `OPENOKR_SUPPORT_EMAIL` | `instance.name`, `instance.sourceUrl`, `instance.termsUrl`, `instance.privacyUrl`, `instance.supportEmail` |
| Anything secret, such as the Stripe keys | A Secret named in `extraEnvFrom`, never a value |

## 1. A managed cloud

Nothing to install. OKRGoal is the managed cloud OKR Institute runs, at
[okrgoal.com](https://okrgoal.com). A team signs up, gets a workspace on the free plan,
and pays to grow it. Anybody may run a cloud like it from this code, which is setup 2.

What the provider operates, how plans and seats work, and how to leave with your data:
[the managed cloud](cloud.md).

## 2. Your own cloud

For a company that sells OKR software to its own customers, under its own name.

```sh
# deploy/docker/secrets/app.env
OPENOKR_CLOUD=true
OPENOKR_CLOUD_PLANS=[{"key":"free","name":"Free","seats":5},{"key":"team","name":"Team","seats":50}]
OPENOKR_CLOUD_DEFAULT_PLAN=free
OPENOKR_INSTANCE_NAME=Example Cloud
OPENOKR_TERMS_URL=https://example.com/terms
OPENOKR_PRIVACY_URL=https://example.com/privacy
OPENOKR_SUPPORT_EMAIL=support@example.com
```

| Step | Where it is explained |
|---|---|
| Grant the first operator, which only the deployment can do | [Operating an instance](cloud.md#operating-an-instance) |
| Put your prices in Stripe and name them in the plans, or leave billing off and set each customer's plan by hand | [Taking payment](cloud.md#taking-payment) |
| Give each plan an AI allowance on your own key, and sell more if you choose | [Taking payment](cloud.md#taking-payment) |
| Decide how long a closed workspace is kept before it is erased, and schedule the erasure | [Taking payment](cloud.md#taking-payment), under Closing and Erasing |
| Name the instance, its legal pages and its source | [Running your own](cloud.md#running-your-own) |

**The licence asks one thing of you.** If you change the code and offer it over a
network, you publish your changes, and `OPENOKR_SOURCE_URL` points every member at them.

## 3. A group of companies

For a group that runs its companies on its own servers, each in a workspace of its own.

```sh
# deploy/docker/secrets/app.env
OPENOKR_CLOUD=true
OPENOKR_REGISTRATION=company_domains
```

`company_domains` lets anybody with a work address sign up. Use `invite_only` if every
person should arrive by invitation.

1. Grant the operator role to the group's IT. The deployment does it, and nobody grants it to themselves, so two people must have accounts: [the command](cloud.md#operating-an-instance).
2. On `/operator`, under **New workspace**, name each company and who will run it. A person with an account owns it straight away. A person without one is emailed an invitation, so turn mail on first ([Settings](../admin/settings.md)). The operator never becomes a member.
3. Each company's administrator invites their own people, or trusts their email domain.

Running your own AI model inside the network, and single sign-on per company:
[one instance for several companies](group.md).

## 4. One organisation

**With one workspace, there is nothing to set.** This is what [one server](compose.md)
and [Kubernetes](kubernetes.md) give you: the first account owns the instance and its
workspace, registration closes behind it, and everybody else joins by invitation.

**With several workspaces**, one per division, region or subsidiary:

```sh
# deploy/docker/secrets/app.env
OPENOKR_CLOUD=true
OPENOKR_REGISTRATION=invite_only
```

Then the operator creates each workspace on `/operator`, exactly as in setup 3. The
person who owns several sees them all in the workspace switcher. An administrator of
one division is an ordinary member, or not a member at all, of the others.

## Changing setup later

The switches change what the instance does from now on and move no data.

| Change | What happens |
|---|---|
| One workspace becomes several | Turn the cloud flag on and set `OPENOKR_REGISTRATION`. The existing workspace appears in the operator console within the hour, or at once with `pnpm cloud:adopt` |
| A group starts charging | Add plans and, if you want, Stripe. A workspace from before has no plan, so no limit, until an operator sets one |
| Back to one organisation | Remove the cloud flag. The workspaces stay, each with its own people |

## How each setup is tested

Each setup has a browser journey that walks it as its operator, a company
administrator, a workspace administrator and a member, and
[the test matrix](../design/hosting-test-matrix.md) says which test proves each part.
A change that breaks any setup fails the build.
