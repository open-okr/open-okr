# One instance for several companies

For a group of companies, or one organisation that wants several workspaces, on its
own servers: setups 3 and 4 in [Choose a setup](setups.md).

**Each company gets its own workspace**, with its own people, goals and settings, and
one person can belong to several and switch between them. Nothing crosses between
workspaces: OKRs and reports do not roll up across them yet. If you want one shared
tree of OKRs, use one workspace with a space per company instead.

Install on [one server](compose.md) or [Kubernetes](kubernetes.md) as usual, then:

| Setting | Value | Why |
|---|---|---|
| `OPENOKR_CLOUD` | `true` | Brings the operator console, and keeps instance-wide settings away from each company's administrators |
| `OPENOKR_REGISTRATION` | `invite_only` | Without it, and with no policy saved, turning the flag on opens sign-up to anybody who can reach the instance. Set it before the first run: the setup wizard's own account is admitted whatever it says, and everybody after needs an invitation |
| `OPENOKR_CLOUD_PLANS` | Leave it unset | No plans means no seat limit and no plan screen |

On one server, add these to `secrets/app.env` and run `./openokr up`. On Kubernetes,
set `cloud.enabled` and `instance.registration` in the chart's values.

## Set it up

1. Grant the operator role to whoever will run the console. The deployment does it, and nobody grants it to themselves, so two people must have accounts. [The cloud guide](cloud.md#operating-an-instance) has the command.
2. Open `/operator`, and under **New workspace** name each company and who will administer it. With an account they own it straight away, and without one they get an invitation. You do not become a member.
3. Each company's administrator invites their own people on **Admin, Invitations**, or trusts their email domain on **Admin, General**.

A workspace from before you turned the flag on appears in the console within the hour.
`pnpm cloud:adopt` does it now, and it is also how to do it with `OPENOKR_SCHEDULER=off`.

## AI on your own servers

With the flag on, the product refuses an AI address inside your network, because on a
public cloud that would let a customer's administrator reach your internal systems. A
group running its own model turns this off:

```
OPENOKR_AI_ALLOW_PRIVATE_ENDPOINTS=true
```

Set it only if you trust every workspace's administrators, because any of them can
then point the product at an address inside your network.

`OPENOKR_AI_PROVIDER` and `OPENOKR_AI_API_KEY` give every workspace one shared key.

## Single sign-on

Each workspace connects its own identity provider. A group with one provider registers
it once per company, and a person lands in the workspace their email domain names.
