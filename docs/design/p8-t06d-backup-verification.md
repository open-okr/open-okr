# P8-T06d: per-tenant backup verification and the incident runbook

Authority: PLAN.md SS5, TECHNICAL-PLAN.md SS4.
Depends on: P8-T06c (the status surface, which the incident runbook references).

The tenant-limits design (p8-t01a-tenant-limits.md SS9 #5) named both
deliverables and said they need their own design. This is that design.

## 0. What already exists

| Component | Where | What it does |
|---|---|---|
| `./openokr backup` | `deploy/docker/openokr` | pg_dump custom format, AES-256-CBC encrypted with the instance root key, blob storage copied, SHA-256 checksum over the whole directory, manifest.json with timestamp and schema version, retention |
| `./openokr restore` | `deploy/docker/openokr` | Checksum verification, decryption with key fallback (tries current key then previous keys), dropdb/createdb, pg_restore, blob restore, migrations |
| Helm CronJob | `deploy/helm/templates/backup-cronjob.yaml` | Scheduled pg_dump + encrypt + checksum + retention, using `postgres:17-alpine` |
| Restore runbook | `docs/runbooks/restore.md` | Step-by-step restore for Compose and Helm, scheduled backup setup |
| Audit chain verifier | `packages/core/src/audit/verify.ts` and `pnpm audit:verify` | Verifies the append-only hash chain per workspace |
| Portability archive | `packages/core/src/portability/` | Per-workspace export and import (different from the full database backup) |
| Operator usage snapshots | `packages/db/src/schema/operator-usage.ts` | Per-workspace counts (members, goals, check-ins, storage) with `measured_at` |

**What does not exist.** Nothing proves a backup would restore until
somebody tries it in an emergency. The checksum proves the files are
intact. `pg_restore` proving the data is loadable and each workspace's
rows are present is the claim a backup actually makes.

## 1. What "verify" means

Three levels of confidence, and only the third is honest:

| Level | What it checks | What it misses |
|---|---|---|
| Checksum | Files are bit-identical to when they were written | A dump that was corrupt before the checksum was computed |
| Decrypt | The key is right and the ciphertext is valid | A dump that decrypts to garbage |
| **Load and query** | The dump restores to a working database and every workspace's data is present | Nothing short of running the application against it |

This task builds the third. The first two already exist.

## 2. The verify-backup command

`./openokr verify-backup <backup-directory>`

POSIX shell, in the same lifecycle helper that holds `backup` and
`restore`. The command:

1. Validates the backup directory (checksum.sha256, db.dump.enc,
   manifest.json all present).
2. Verifies the checksum.
3. Decrypts the dump. Tries the current key, then previous keys, same
   as `restore` does.
4. Creates a temporary database named `openokr_verify_<timestamp>`.
5. Runs `pg_restore` into that database.
6. Runs the verification queries (SS3 below).
7. Reports per-workspace results to stdout.
8. Drops the temporary database.

The temporary database is dropped in a `trap` handler, so a failure at
any step, or a SIGTERM/SIGINT, cleans up rather than leaking a database.

**Shared decryption.** The decrypt-and-try-previous-keys block is
currently written inline in the `restore` case. Both `restore` and
`verify-backup` need it. A `decrypt_dump` shell function, defined once
above both cases, replaces the inline block in both.

**Exit codes:**

| Code | Meaning |
|---|---|
| 0 | Every workspace passed every check |
| 1 | At least one workspace failed a check (the backup restored but the data is wrong) |
| 2 | The backup could not be loaded (decrypt failure, pg_restore failure) |
| 3 | Usage error (missing argument, missing files) |

**What it does not do.** It does not restore blobs. Blob verification
would need the application image running, which the lifecycle helper
cannot assume during a verification. The dump is the irreplaceable part;
blobs on S3 have their own durability.

## 3. What is checked per workspace

After the dump is loaded into the temporary database:

| # | Check | Query | Pass condition |
|---|---|---|---|
| 1 | Schema version | `SELECT name FROM _migrations ORDER BY name DESC LIMIT 1` | Matches the `schemaVersion` field in `manifest.json`. A mismatch means the dump is from a different schema than the manifest claims |
| 2 | Workspaces exist | `SELECT id, slug FROM workspaces WHERE deleted_at IS NULL` | At least one row. A backup with zero live workspaces is not necessarily wrong (a fresh instance), but it is reported |
| 3 | Each workspace has members | `SELECT count(*) FROM workspace_members WHERE workspace_id = $1 AND deleted_at IS NULL` | At least one member per workspace. Every workspace has at least its founding admin |
| 4 | Each workspace has audit events | `SELECT count(*) FROM audit_events WHERE workspace_id = $1` | At least one event per workspace. Provisioning writes audit events, so a workspace with zero means the backup is truncated or the workspace was never fully set up |

The queries run inside the temporary database, which has no row-level
security policies active (no `SET LOCAL` for tenant isolation), so
every row is visible. This is the only context in the product where
that is correct: the verification needs to see everything, and it runs
against a database nobody is signed into.

## 4. The Helm test hook

`deploy/helm/templates/backup-verify-job.yaml`

A Job with the `helm.sh/hook: test` annotation, so it runs on
`helm test openokr` and not on install or upgrade.

Rendered only when `.Values.backup.enabled` is true, because without a
backup there is nothing to verify.

Uses `postgres:17-alpine`, the same image the backup CronJob uses. The
verification queries are pure SQL. The audit chain verifier is a Node
script and the application image would be needed for it, but the four
queries above are what this task delivers and they run in `psql`.

Mounts the backup PVC **read-only**. Creates a temporary database with
a name that includes `$RANDOM` to avoid collision with other Jobs. Finds
the newest backup directory (lexicographic sort of timestamp-named
directories), decrypts, restores, checks, drops.

The Job's `DATABASE_URL` is the same secret the application uses, so the
temporary database is created on the same Postgres instance. This is
deliberate: the verification proves the dump restores on the same server
the application runs on, not on a hypothetical other one.

## 5. The incident runbook

`docs/runbooks/incident.md`

A triage table, not a narrative. Each row is a scenario an operator
encounters. Each stands alone.

Columns: scenario name, symptoms, diagnostic commands, immediate
actions, and references to other runbooks where they cover the next
steps. The operator reads top to bottom until they find their situation.

Scenarios:

1. Instance unreachable
2. Database unreachable
3. Relay stopped or degraded
4. Data corruption suspected
5. Backup restore needed
6. Performance degradation
7. Encryption key compromise
8. Upgrade failure
9. Scheduler stopped
10. Post-incident review (what to document, when to review, how to
    communicate)

Each scenario references `/api/status` (P8-T06c) as the first
diagnostic, because it is the one endpoint that answers "which
component is the problem" without authentication.

## 6. Acceptance criteria

1. **Given** a valid backup directory,
   **when** `./openokr verify-backup <dir>` runs,
   **then** it creates a temporary database, restores the dump, checks
   every workspace, reports per-workspace results, drops the temporary
   database, and exits 0.

2. **Given** a backup whose checksum does not match,
   **when** `./openokr verify-backup <dir>` runs,
   **then** it refuses before decrypting and exits 2.

3. **Given** a backup encrypted with a rotated key,
   **when** `./openokr verify-backup <dir>` runs with the previous key
   in `OPENOKR_PREVIOUS_ENCRYPTION_KEYS`,
   **then** it decrypts with the previous key and proceeds.

4. **Given** a backup with a workspace that has zero members (a
   truncated dump),
   **when** the per-workspace checks run,
   **then** that workspace is reported as failed and the command exits 1.

5. **Given** the verify-backup command fails or is interrupted at any
   point,
   **then** the temporary database is dropped by the trap handler.

6. **Given** `backup.enabled: true` in Helm values,
   **when** `helm test openokr` runs,
   **then** the verify Job runs the same checks against the newest
   backup.

7. **Given** a reader of `docs/runbooks/incident.md`,
   **when** they look up "database unreachable",
   **then** they find a row with symptoms, diagnostic commands, actions,
   and a reference to `restore.md`.

## 7. Open questions

| # | Question | Why it is not answered here |
|---|---|---|
| 1 | Whether to run the audit chain verifier inside the temporary database | The verifier is a Node script that needs `packages/core`. The lifecycle helper is POSIX shell. Running it would require the application image. The four SQL checks above are what this task delivers; the audit chain check can be added in a later task if the application image is available |
| 2 | Whether `verify-backup` should be scheduled | The task says on-demand. A scheduled verification would need a CronJob (Helm) or a cron entry (Compose). The cost is a full pg_restore on every run, which is minutes of I/O. Left for the operator to decide |
