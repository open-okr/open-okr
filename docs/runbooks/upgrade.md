# Upgrading, and how to go back

## Before you upgrade

Nothing. `./openokr upgrade` takes a backup itself and refuses to proceed
without one.

That refusal is the whole shape of this document. Migrations are
forward-only, so the moment one applies, the previous image is looking at a
schema it does not know. **"Run the previous tag" is not a rollback.** It was
printed by the helper until 11 September 2026 and it was wrong: starting the
old image against the new database is a second failure on top of the first.

```
cd deploy/docker
./openokr upgrade
```

The helper takes the backup, keeps the last three, pulls, and restarts.
Migrations run in the entrypoint, take an advisory lock, and are safe to
repeat and safe with more than one replica.

## If your database is backed up somewhere else

```
OPENOKR_SKIP_BACKUP=1 ./openokr upgrade
```

A variable rather than a flag, because it is a thing you decide once about a
deployment and not something to think about on each upgrade. Use it when an
external Postgres has its own backups, and not to get past a backup that
failed: a failing backup on upgrade day is the backup you were about to need.

## Going back

```
./openokr restore <the backup directory the upgrade wrote>
OPENOKR_IMAGE=<the previous tag> ./openokr up
```

In that order. The restore is the part that matters, because the schema moved
and the old image cannot read the new database.

The backup directory is self-contained and sealed with the instance's root
key: a database dump, the blob storage, a manifest and a checksum. `restore`
refuses a damaged one rather than restoring half of it.

## How far behind you can be

Any release upgrades directly to any later release in the same major, with no
stops in between. Crossing a major means stopping at the last release of the
current major first.

That direct jump is what lets old migrations retire at a major boundary.
Without it every migration ever written would have to stay runnable forever.

## What is checked, and by whom

| Check | Where | What it catches |
|---|---|---|
| `pnpm db:lint` | every commit | A migration that drops or renames a column without saying which earlier release added the replacement. On Kubernetes, pods of two releases serve together during a rollout, so a silent drop breaks every request those pods are serving |
| The upgrade matrix | nightly, and on demand | A real instance on the baseline, seeded through the product, upgraded to the current commit. Asserts the workspace is intact, the audit trail has not shrunk, and a backup exists |

The linter runs first on purpose. The matrix's own worst case is a migration
that drops a column the baseline still reads, and that is a migration the
linter should already have refused hours earlier, on the commit that wrote
it.

## Backfills never hold up a boot

Schema migrations run on start. Data changes run separately through
`pnpm db:change`, on your schedule, and `status` reports what is pending. An
upgrade is never held open by a long backfill.
