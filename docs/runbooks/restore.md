# Restore runbook

When to use this: a database failure, a corrupted instance, or a migration to
new hardware. The backup holds a `pg_dump` custom-format dump encrypted with
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

Every backup directory contains `checksum.sha256`. Verify it first:

```sh
cd /path/to/backup/20260908T020000Z
sha256sum -c checksum.sha256
```

If this fails, the backup is damaged. Do not proceed.

## Docker Compose

### 1. Stop the instance

```sh
./openokr down
```

### 2. Restore

```sh
./openokr restore /path/to/backup/20260908T020000Z
```

This verifies the checksum, decrypts the dump (trying the current key first,
then previous keys), drops and recreates the database, runs `pg_restore`, and
restores blob storage if the backup includes it. Migrations run automatically
on the next `./openokr up`.

### 3. Start

```sh
./openokr up
```

### 4. Verify

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
  -pass "pass:$(kubectl get secret openokr -o jsonpath='{.data.encryption-key}' | base64 -d)" \
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

The backup may be from an older schema version. Upgrade the release (which
triggers the migration hook) or run migrations manually:

```sh
kubectl create job --from=cronjob/openokr-migrate openokr-post-restore
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
  packages/core/src/bin/verify-audit.ts

# Kubernetes
kubectl exec deploy/openokr -- node --experimental-strip-types --no-warnings \
  packages/core/src/bin/verify-audit.ts
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

The CronJob runs `pg_dump`, encrypts with the instance key, and applies
retention. Point `existingClaim` at a PVC backed by durable storage (NFS,
EBS, etc.). Without it the job uses an `emptyDir` that is lost on restart.
