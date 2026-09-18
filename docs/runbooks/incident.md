# Incident runbook

A triage table. Find the symptoms, follow the row. Each scenario stands
alone. Commands are for Docker Compose unless marked otherwise; the Helm
equivalents use `kubectl` in place of `docker compose`.

Written at P8-T06d. The `/api/status` endpoint (P8-T06c) is the first
diagnostic in most rows, because it answers "which component is the
problem" without authentication.

## Triage

| # | Scenario | Symptoms | Diagnostic | Immediate action | See also |
|---|----------|----------|------------|------------------|----------|
| 1 | Instance unreachable | Browser times out. `/api/status` gets no response. `/api/health` gets no response | `./openokr status` to check container state. `docker compose logs proxy` for the reverse proxy. `docker compose logs app` for the application. Check host disk space (`df -h`), memory (`free -m`), port conflicts (`ss -tlnp`) | Restart: `./openokr down && ./openokr up`. If the proxy is the problem, check the Caddyfile and certificate state. If the host is out of disk, clear old backups and build caches before restarting | - |
| 2 | Database unreachable | `/api/status` returns `database: unavailable`. `/api/health` returns 503. Application logs show connection errors | `docker compose logs db`. `docker compose exec db pg_isready -U openokr`. Check disk space on the database volume (`docker system df -v`). Check if Postgres is in recovery (`docker compose exec db psql -U openokr -c "SELECT pg_is_in_recovery()"`) | Restart the database: `docker compose restart db`. If Postgres refuses to start, check `pg_log` inside the container. If the data directory is corrupt, restore from a verified backup | [restore.md](restore.md) |
| 3 | Relay stopped | `/api/status` returns `relay: degraded` or `relay: unavailable`. The capacity dashboard shows `openokr_outbox_oldest_pending_seconds` climbing. Nudges and channel messages stop arriving | `docker compose logs app` and search for "relay" errors. Check dead-lettered rows: the delivery dashboard panel, or query `SELECT count(*) FROM outbox WHERE dead_lettered_at IS NOT NULL` | Restart the application: `docker compose restart app`. If the relay keeps failing on specific rows, check the dead-letter panel on the delivery dashboard. A permanently failing topic means a handler is broken, not the relay | [observability.md](observability.md) |
| 4 | Data corruption suspected | Audit chain verification fails (`pnpm audit:verify` reports a broken chain). Pages show missing or incorrect data. A user reports content they did not write | Run `pnpm audit:verify` to scope the problem. Check recent deployments and migrations. Check whether the problem is one workspace or all of them | If one workspace: investigate the specific rows. If widespread or unexplained: restore from a verified backup. Run `./openokr verify-backup <dir>` first to confirm the backup is intact before restoring | [restore.md](restore.md) |
| 5 | Backup restore needed | After confirmed corruption, a failed upgrade, or a disaster recovery event | List available backups: `ls -lt ${OPENOKR_BACKUP_DIR:-./backups}/`. Pick the newest one that predates the problem | Verify the backup: `./openokr verify-backup <dir>`. If it passes, restore: `./openokr down && ./openokr restore <dir> && ./openokr up`. After restore, run `pnpm audit:verify` to confirm the chain | [restore.md](restore.md) |
| 6 | Performance degradation | `/api/status` returns `operational` but responses are slow. The capacity dashboard shows pool connections mostly `active` or `waiting` above zero. Admission refusals increasing | Open the capacity dashboard. Check `openokr_pool_connections` by state. Check `openokr_concurrent_actions`. Check `OPENOKR_DB_POOL_MAX` (default 20). Check for long-running queries: `docker compose exec db psql -U openokr -c "SELECT pid, now() - query_start AS duration, query FROM pg_stat_activity WHERE state = 'active' ORDER BY duration DESC LIMIT 10"` | If pool is exhausted: raise `OPENOKR_DB_POOL_MAX` and restart. If one query is holding connections: identify it and check whether it is a known pattern or a regression. If admission refusals are high: the per-tenant limits may be too low for the workload | [observability.md](observability.md) |
| 7 | Encryption key compromise | The root key (`OPENOKR_ENCRYPTION_KEY`) has been exposed in a log, a commit, a backup on an untrusted host, or a breach notification | Assess exposure scope: who had access, for how long, what was reachable with it. The key encrypts provider API keys, channel credentials and mail passwords stored in the database. Backup dumps encrypted with it can be decrypted by whoever holds it | Rotate immediately: `./openokr rotate-key`. This generates a new key, re-wraps every stored credential, and removes the old key from the ring. Revoke and re-issue any provider key or channel credential that was stored during the exposure window, because the rotation re-wraps the envelope and not the secret inside it. If backup dumps were accessible: treat those credentials as exposed regardless of the re-wrap | - |
| 8 | Upgrade failure | `./openokr upgrade` fails during migration. Application logs show a migration error. The instance does not start on the new image | Read the migration error in `docker compose logs app`. Identify which migration failed and why. Common causes: a constraint violation on existing data, a dependent extension missing, or a column rename colliding with an application query from the previous image still in a connection pool | Restore the pre-upgrade backup: `./openokr restore <the backup directory the upgrade printed>`. Then pin the previous image: `OPENOKR_IMAGE=<previous tag> ./openokr up`. Report the migration failure to the project. Do not attempt to fix the migration by hand unless you are certain of the cause and the fix | [upgrade.md](upgrade.md) |
| 9 | Scheduler stopped | `/api/status` returns `scheduler: degraded` or `scheduler: unavailable`. No nudges, no agent runs, no audit chain progression. `openokr_job_runs_total` flat on the delivery dashboard | `docker compose logs app` and search for "scheduler" errors. Check if `OPENOKR_SCHEDULER=off` is set (deliberate). Check pg-boss queue state: `docker compose exec db psql -U openokr -c "SELECT name, state, count(*) FROM pgboss.job GROUP BY name, state ORDER BY name"` | If the scheduler process crashed: restart with `docker compose restart app`. If pg-boss jobs are stuck in `active` state: they will time out on their own (the TTL is set per job). If the scheduler was disabled by configuration, that is deliberate and not an incident | [observability.md](observability.md) |

## After the incident

Once the immediate problem is resolved:

1. **Document what happened.** Write a timeline: when the symptoms were
   first observed, what diagnostics were run, what actions were taken,
   when service was restored. Include the backup directory used if a
   restore was involved.

2. **Identify the root cause.** Was it a code change, a configuration
   change, a resource exhaustion, a hardware failure, or an external
   dependency? The answer determines whether a preventive action exists.

3. **Check for data loss.** If a restore was performed, compare the
   backup's `manifest.json` timestamp against the current time. That gap
   is the window of potential data loss. Notify affected users with the
   window and what it means for their data.

4. **Review within a week.** A review that happens months later is a
   review of the document, not of the incident. The people involved
   still remember the decision points and the things that almost went
   differently.

5. **Publish what is useful.** A post-incident summary for affected
   users, if any were affected. The level of detail depends on the
   impact: a five-second restart needs a sentence, a data loss needs a
   full account.
