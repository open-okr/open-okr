# Migration cutover runbook

A step-by-step procedure for moving a workspace from one OpenOKR instance to
another, or from a FlowyTeam source to a fresh OpenOKR instance. Each phase
has commands and a verification step. Do not proceed to the next phase until
the current one's verification passes.

## Known limitation

P6-G25 (the workspace freeze overlay) is not built yet. When the source
workspace is frozen in phase 1, users in the browser see write failures as
generic errors with no explanation. **Announce a maintenance window before
freezing.** Tell users writes will be unavailable for the duration of the
migration. Once P6-G25 ships, frozen workspaces will show an overlay naming
the reason and the expected return.

## Prerequisites

- Access to both instances (source and target) as a workspace administrator
- The source instance's root key (`OPENOKR_ENCRYPTION_KEY`). If the target
  has a different key, add the source key to `OPENOKR_PREVIOUS_ENCRYPTION_KEYS`
  on the target so the archive can be decrypted.
- `pnpm okr` (the CLI) or `curl` for REST API calls on both instances
- For a FlowyTeam source: read-only MySQL access and `pnpm import:flowyteam`

## Phase 0: Pre-flight

| Check | Command | Pass |
|-------|---------|------|
| Source is reachable | `curl -s https://source.example.com/api/v1/openapi.json -H "Authorization: Bearer $TOKEN"` | 200 |
| Target is provisioned | Sign in to the target instance, verify the workspace exists | A workspace loads |
| Encryption keys compatible | Compare key fingerprints or add the source key to `OPENOKR_PREVIOUS_ENCRYPTION_KEYS` on the target | The target can open a test archive from the source |
| Target is empty (or acceptable) | Check member count on the target | Only the founding admin, or members you expect to merge |

## Phase 1: Freeze the source

Freeze the workspace so no writes happen during the migration. All reads
continue to work. Admin actions (people, settings, the freeze itself) remain
available.

```sh
# Via the CLI
pnpm okr workspace set-state --state frozen --url https://source.example.com --token $TOKEN

# Via the REST API
curl -X POST https://source.example.com/api/v1/workspace/setState \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"state": "frozen"}'
```

**Verify:** attempt a write (e.g. create a goal). It MUST be refused.

## Phase 2: Back up the source

Take a full backup of the source before exporting. This is the rollback
target if anything goes wrong.

```sh
# On the source host (Docker Compose)
./openokr backup
```

**Verify:** the checksum file exists and `sha256sum -c checksum.sha256` passes.

## Phase 3: Dry-run import on the target

Export from the source and import as a dry run on the target.

```sh
# Export (via the admin UI at /admin/imports, or via the CLI/REST API)
pnpm okr workspace export-archive --url https://source.example.com --token $SOURCE_TOKEN

# Dry-run import on the target
pnpm okr workspace import-archive --dry-run --url https://target.example.com --token $TARGET_TOKEN < archive.okr
```

Or use the admin cards on `/admin/imports` on the target: upload the `.okr`
file and the dry-run runs automatically.

**Verify:** review the difference report.

| Field | What to check |
|-------|---------------|
| `created` | Tables and row counts to be inserted |
| `merged` | Members matched by email (names and addresses) |
| `skipped` | Rows already present (should be zero on a first import) |
| `blobs` | File count |

If members are merging that should not, stop. The de-duplication is by email
only and cannot be overridden.

## Phase 4: Real import

Run the import for real. The report MUST match the dry run exactly.

```sh
pnpm okr workspace import-archive --url https://target.example.com --token $TARGET_TOKEN < archive.okr
```

Or click "Confirm import" on the admin card after reviewing the dry-run.

**Verify:** compare the real report against the dry-run report. Created,
merged, skipped and blob counts MUST be identical.

## Phase 5: Reconcile

| Check | Command | Pass |
|-------|---------|------|
| Row counts match | Compare key tables between source and target (workspaces, workspace_members, goals, key_results, check_ins, cycles, initiatives, tasks, documents) | Counts equal |
| Audit chain verifies | `pnpm audit:verify` on the target | Passes for every workspace |
| A goal renders | Open a goal on the target that existed on the source | Title, key results, progress, health match |
| A check-in renders | Open a check-in | Narrative, confidence, values match |
| A document renders | Open a document | Body matches |
| A session renders | Open a session | Stages, participants match |
| Members are correct | Check the people directory on the target | Names, titles, manager chain match the source |

## Phase 6: Go live

Point DNS or the load balancer at the target. The source stays frozen as the
rollback target.

```sh
# Example: update a CNAME
# app.example.com -> target-instance.example.com
```

**Verify:** `curl -s https://app.example.com` resolves to the target. Sign
in through the browser.

## Phase 7: Rollback window

Keep the source frozen and running for a rollback window. Recommended: 7 days
for a production migration, 1 day for a rehearsal.

**If rollback is needed:**

```sh
# Unfreeze the source
pnpm okr workspace set-state --state active --url https://source.example.com --token $TOKEN

# Point DNS back to the source
# app.example.com -> source-instance.example.com
```

The target is abandoned. Any writes made on the target after go-live are lost.
This is the trade: the rollback window is the period where that risk is
accepted.

**When the window closes:** decommission the source. The backup from phase 2
is the last copy.

## FlowyTeam-specific notes

When the source is a FlowyTeam MySQL instance rather than another OpenOKR
instance, replace phases 1-4 with:

1. **Announce maintenance.** FlowyTeam has no freeze mechanism; coordinate
   with users to stop writing.
2. **Run the importer:**
   ```sh
   pnpm import:flowyteam \
     --source "mysql://user:pass@host:3306/flowyteam" \
     --workspace my-workspace \
     --as admin@example.com \
     --company 1
   ```
   This does its own dry run by default. Add `--write` for the real import.
3. **Reconcile** as in phase 5. The importer reports per-row outcomes.
4. Proceed to phase 6 (go live) and 7 (rollback window) as normal.

## Reconciliation checklist

Copy this table into your migration ticket and check each row.

| # | Check | Command / action | Result | Notes |
|---|-------|-----------------|--------|-------|
| 1 | Workspace exists on target | Sign in | | |
| 2 | Member count matches | `SELECT count(*) FROM workspace_members WHERE deleted_at IS NULL` on both | | |
| 3 | Goal count matches | `SELECT count(*) FROM goals WHERE deleted_at IS NULL` on both | | |
| 4 | Key result count matches | `SELECT count(*) FROM key_results WHERE deleted_at IS NULL` on both | | |
| 5 | Check-in count matches | `SELECT count(*) FROM check_ins WHERE deleted_at IS NULL` on both | | |
| 6 | Cycle count matches | `SELECT count(*) FROM cycles WHERE deleted_at IS NULL` on both | | |
| 7 | Document count matches | `SELECT count(*) FROM documents WHERE deleted_at IS NULL` on both | | |
| 8 | Task count matches | `SELECT count(*) FROM tasks WHERE deleted_at IS NULL` on both | | |
| 9 | Audit chain verifies | `pnpm audit:verify` | | |
| 10 | A goal renders identically | Visual comparison | | |
| 11 | A check-in renders identically | Visual comparison | | |
| 12 | Dry-run == real import report | Automated by the rehearsal script | | |
| 13 | Rollback tested | Unfreeze source, confirm writes | | |
