# Operations

Running the instance, rather than running the practice.

## Is it healthy

| Question | Where |
|---|---|
| Is it up | `./openokr status`, or the container's own health check |
| What is it doing | `./openokr logs`, and `./openokr logs proxy` for the proxy |
| Is it healthy from outside | The public status endpoint, which answers without a session |
| How much is it carrying | The capacity view, which reads a snapshot rather than counting live |

More in the [observability runbook](../runbooks/observability.md).

## Upgrading

```sh
./openokr upgrade
```

Pulls the new image, restarts, re-runs migrations and reports. On Kubernetes it
is `helm upgrade`, and migrations run as a job before the application rolls.

Migrations are forward-only and ship with the feature that needs them. Removing
or renaming anything spans two releases: the first adds the replacement and
writes both, the second removes the old. That is what makes a rolling upgrade
safe, and it is why downgrading is not supported.

Details, including what to check afterwards, are in the
[upgrade runbook](../runbooks/upgrade.md).

## Backups

```sh
./openokr backup                 # an encrypted dump plus the files, with a checksum
./openokr verify-backup DIR      # prove it would restore, without touching the live database
./openokr restore DIR            # restore from one
```

**Verify at least one.** A backup nobody has ever restored is a belief. The
verification loads the backup into a scratch database rather than checking that
a file exists, which is the only claim a backup actually makes.

Two things live outside the database and have to be carried with it:

| Also back up | Why |
|---|---|
| `deploy/docker/secrets/` | Holds the root encryption key. Without it, stored credentials are unreadable while everything else keeps working |
| Uploaded files | `backup` copies them. A database-only dump restores an instance whose attachments are gone |

On Kubernetes the equivalent is the generated Secret, and
[deploy/helm/README.md](../../deploy/helm/README.md) says how to save it.

The [restore runbook](../runbooks/restore.md) is the full procedure.

## Rotating the root key

```sh
./openokr rotate-key
```

Re-wraps every stored secret under a new root key, including the tokens an
identity provider issued at sign-in. The old key is kept in the previous-keys
list until the rotation finishes, so nothing becomes unreadable mid-way.
[Security](security.md#what-is-encrypted-at-rest) lists what is sealed.

## Taking the whole workspace out

An administrator can export a workspace as one checksummed archive holding
every row and every uploaded file, and import it into another instance. That is
the exit, and it is part of the product rather than a support request.

The archive is sealed with a passphrase chosen at export, at least 12
characters. Any instance given the passphrase can import it, and no instance
can without it. It is not stored anywhere, so keep it with the file. People in
the archive arrive on the other side as members waiting to be claimed: when a
person joins with the same email address, the member and everything they wrote
becomes theirs.

## Scheduled work

An instance runs these on a clock, all on by default:

| Run | When | What it does |
|---|---|---|
| The agents' cadence | Hourly, daily, weekly, per cycle, and the Coach at 02:00 local | Nudges, proposals and the staleness sweep |
| Notification batches | Every 5 minutes | Sends the batched notifications whose window has closed |
| Audit chain | Every minute | Gives each audit row its position in the hash chain |
| Orphaned uploads | 03:20 UTC | Removes uploads that were prepared and never attached |
| Message log retention | 03:40 UTC | Deletes channel message records older than the workspace's setting, when it has one |
| Outbox purge | 04:00 UTC | Deletes delivered and given-up outbox rows older than `outbox.retentionDays`, 30 by default, 0 to keep them. A delivered invitation loses its token and address the moment it is sent |

`OPENOKR_SCHEDULER=off` turns them all off for a host that should not run them,
and then `pnpm cadence:sweep` and `pnpm audit:chain` are the manual equivalents
of the two that matter most. `OPENOKR_OUTBOX_RETENTION_DAYS` sets the outbox
window from the environment.

## If something is wrong now

The [incident runbook](../runbooks/incident.md) is written for that moment.

## Next

- [Security](security.md)
- [Settings](settings.md)
