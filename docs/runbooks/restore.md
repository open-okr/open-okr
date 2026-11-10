# Restore runbook

When to use this: a database failure, a corrupted instance, or a migration to
new hardware. A workspace administrator sees no instance backup and cannot
restore one: each holds every workspace. Their own copy is the workspace
archive, on Admin, Backups. The backup holds a `pg_dump` custom-format dump encrypted with
the instance's root key, plus blob storage if the backup included it.

## Prerequisites

- The root key (`OPENOKR_ENCRYPTION_KEY`) that was active when the backup was
  taken, or one listed in `OPENOKR_PREVIOUS_ENCRYPTION_KEYS` at that time.
  Without it the dump cannot be decrypted.
- Access to the backup directory (local disk, NFS, or wherever the operator
  pointed it).
- A running Postgres the restored instance will connect to.
- `openssl` (for decryption) and `pg_restore` (for loading the dump).

## Verifying a backup before restore

**File-level check.** Every backup directory contains `checksum.sha256`:

```sh
cd /path/to/backup/20260908T020000Z
sha256sum -c checksum.sha256
```

If this fails, the backup is damaged. Do not proceed.

**Database-level check.** The checksum proves files are intact.
`verify-backup` proves the dump actually restores and every workspace's
data is present. It loads the dump into a temporary database, runs
per-workspace checks, and drops the temporary database without touching
the live one:

```sh
# Docker Compose
./openokr verify-backup /path/to/backup/20260908T020000Z

# Helm
helm test openokr    # runs against the newest backup on the PVC
```

Exit 0 means every workspace passed. Exit 1 means a data issue was found
(the report names which workspaces). Exit 2 means the backup could not
be loaded at all. Exit 3 is a usage error, such as a directory with no
checksum, dump or manifest.

## Docker Compose

### 1. Restore

```sh
./openokr restore /path/to/backup/20260908T020000Z
```

Leave the stack running: the restore needs the database container, and stops
and starts the application itself. It verifies the checksum, decrypts the dump
(trying the current key first, then previous keys), stops the application,
drops and recreates the database, runs `pg_restore`, restores blob storage if
the backup includes it, starts the application, waits for it to be healthy,
and runs the migrations again so the application role's grants come back.

### 2. Verify

```sh
./openokr status
```

Sign in through the browser and confirm the workspace loads.

## Helm (Kubernetes)

### 1. Scale the deployment to zero

```sh
kubectl scale deployment openokr --replicas=0
```

### 2. Decrypt the dump

```sh
openssl enc -d -aes-256-cbc -pbkdf2 \
  -pass "pass:$(kubectl get secret openokr-secrets -o jsonpath='{.data.encryption-key}' | base64 -d)" \
  -in /backups/20260908T020000Z/db.dump.enc \
  -out /tmp/db.dump
```

If decryption fails with "bad decrypt", the key has been rotated since the
backup. Use the previous key instead.

### 3. Restore the database

```sh
# Drop and recreate (adjust connection details for your setup)
psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
pg_restore -d "$DATABASE_URL" --no-owner --no-privileges /tmp/db.dump
rm /tmp/db.dump
```

### 4. Run migrations

The backup may be from an older schema version, and a restore with
`--no-privileges` leaves out the application role's grants, which the migrator
writes again. The chart runs its migrations as a Helm hook Job on every
install and upgrade, so an upgrade to the same chart and the same values runs
them again:

```sh
helm upgrade <release> deploy/helm --reuse-values
```

The Job is named `<fullname>-migrate-<revision>`, where `<fullname>` is the
chart's full name (the release name when it already contains `openokr`), one
per revision, because a hook Job cannot be patched. There is no CronJob to copy it from.
Wait for it to finish before scaling up:

```sh
kubectl wait --for=condition=complete job -l app.kubernetes.io/component=migration --timeout=10m
```

### 5. Scale back up

```sh
kubectl scale deployment openokr --replicas=1
```

### 6. Verify

```sh
kubectl get pods -l app.kubernetes.io/name=openokr
```

Sign in through the browser and confirm the workspace loads.

## What to do if the audit chain fails

After a restore, run the audit chain verifier:

```sh
# Docker Compose
docker compose exec app node --experimental-strip-types --no-warnings \
  /app/migrator/packages/core/src/bin/verify-audit.ts

# Kubernetes
kubectl exec deploy/openokr -- node --experimental-strip-types --no-warnings \
  /app/migrator/packages/core/src/bin/verify-audit.ts
```

A failure means the restored audit events do not form a valid chain. Possible
causes:

1. The backup was taken mid-transaction and an audit event was half-written.
   The row is present but its hash does not match. This is recoverable: the
   chain can be resealed from the last valid event.
2. The backup was altered after it was taken. The checksum should have caught
   this. Investigate before trusting the data.

## Scheduled backups

### Docker Compose

Add a cron entry on the host:

```cron
0 2 * * * cd /opt/openokr && ./openokr backup >> /var/log/openokr-backup.log 2>&1
```

Configure retention with `OPENOKR_BACKUP_RETENTION` (default: 7). Backups land
in `./backups/` or wherever `OPENOKR_BACKUP_DIR` points.

### Helm

Enable the CronJob in values:

```yaml
backup:
  enabled: true
  schedule: "0 2 * * *"
  retention: 7
  existingClaim: my-backup-pvc
```

The CronJob runs `pg_dump`, encrypts with the instance key, archives the
uploaded files when they live on the chart's own volume, and applies
retention. Point `existingClaim` at a PVC backed by durable storage (NFS,
EBS, etc.). Without it the job uses an `emptyDir` that is lost on restart.

## After restoring a cloud instance

A restore brings back what the backup held, including a workspace that has been
erased since (docs/design/workspace-erasure.md §9). The erasure cron's own log,
which lives outside the database, names every workspace it erased, and
`pnpm cloud:sweep --erased` lists the receipts still in the restored database.

| Came back as | Do |
|---|---|
| Closed | Nothing. The next `./openokr erase --write` erases it again, once its window has passed |
| Active or suspended | Close it on S-46, the operator's workspace page, then `pnpm cloud:erase --id <id> --now --write` (`./openokr erase --id <id> --now --write` in Compose) |

Do this before anybody signs in, so nobody meets a workspace the provider has
already promised them is gone.

