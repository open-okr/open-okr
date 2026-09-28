# Start on the managed cloud

For a team that does not want to run anything. Sign up, name a workspace,
start.

> **No managed cloud is operating yet**, and there is no address to sign up
> at. The tenant provisioning, the operator console and the plan model are
> built and tested, and this page describes what they do. Until a vendor runs
> an instance, [one server](compose.md) or [Kubernetes](kubernetes.md) are the
> two ways to use OpenOKR.

## What you get

The same release that a self-hosted instance runs. **Nothing is feature-gated
and nothing is seat-limited by which tier you are on.** The cloud sells
operation, not features: the vendor runs the machine, the upgrades, the
backups and the monitoring.

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

## What differs from self-hosting

| Difference | Detail |
|---|---|
| Registration | Open, because a cloud belongs to nobody. A self-hosted instance closes registration behind its first account |
| Plans and seats | The cloud counts seats. Self-hosting does not |
| Suspension and closure | A cloud workspace has a lifecycle the vendor operates. Nothing is erased without a retention window somebody set |

## Next

- [The first run](first-run.md): the same wizard, minus the install.
- [Administrator guide](../admin/README.md).
