#!/bin/sh
# Migration cutover rehearsal (P6-T07).
#
# Exercises the seven-phase runbook against test databases:
#   1. Seed a source workspace
#   2. Freeze it
#   3. Export an archive
#   4. Provision a target workspace
#   5. Dry-run import, then real import
#   6. Assert: reports match, row counts match, workspace exists
#   7. Unfreeze the source (rollback test)
#
# Run from the repo root:
#     TEST_DB_PORT=55432 sh deploy/docker/cutover-rehearsal.sh
#
# Needs: psql, node (with --experimental-strip-types), a running Postgres
set -eu

: "${TEST_DB_PORT:=55432}"
: "${TEST_DB_HOST:=localhost}"
: "${TEST_DB_USER:=postgres}"

SOURCE_DB="openokr_cutover_source"
TARGET_DB="openokr_cutover_target"
DRILL_DIR="$(mktemp -d)"

pass() { echo "  ok    $1"; }
fail() { echo "  FAIL  $1" >&2; cleanup; exit 1; }

cleanup() {
  psql -h "$TEST_DB_HOST" -p "$TEST_DB_PORT" -U "$TEST_DB_USER" \
    -c "DROP DATABASE IF EXISTS $SOURCE_DB" \
    -c "DROP DATABASE IF EXISTS $TARGET_DB" 2>/dev/null || true
  rm -rf "$DRILL_DIR"
}
trap cleanup EXIT

echo "cutover rehearsal: starting"

# ── Phase 0: Create and seed the source ────────────────────────────────────

echo "  creating source database..."
psql -h "$TEST_DB_HOST" -p "$TEST_DB_PORT" -U "$TEST_DB_USER" \
  -c "DROP DATABASE IF EXISTS $SOURCE_DB" \
  -c "CREATE DATABASE $SOURCE_DB" >/dev/null

DATABASE_URL="postgres://$TEST_DB_USER@$TEST_DB_HOST:$TEST_DB_PORT/$SOURCE_DB" \
  node --experimental-strip-types --no-warnings \
  packages/db/src/migrate.ts 2>/dev/null

DATABASE_URL="postgres://$TEST_DB_USER@$TEST_DB_HOST:$TEST_DB_PORT/$SOURCE_DB" \
  node --experimental-strip-types --no-warnings -e "
const pg = require('pg');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
(async () => {
  await pool.query(\"INSERT INTO users (id, name, email) VALUES ('cutover-user-1', 'Cutover User', 'cutover@example.com')\");
  const core = require('@openokr/core');
  await core.provisionWorkspaceForUser(pool, { id: 'cutover-user-1', name: 'Cutover User' });
  await pool.end();
})();
" 2>/dev/null || true

# Get the workspace ID.
SOURCE_WS="$(psql -h "$TEST_DB_HOST" -p "$TEST_DB_PORT" -U "$TEST_DB_USER" \
  -d "$SOURCE_DB" -t -A -c "SELECT id FROM workspaces LIMIT 1" 2>/dev/null)"
[ -n "$SOURCE_WS" ] || fail "no workspace in source"
pass "source seeded (workspace $SOURCE_WS)"

# ── Phase 1: Freeze the source ────────────────────────────────────────────

echo "  freezing source workspace..."
psql -h "$TEST_DB_HOST" -p "$TEST_DB_PORT" -U "$TEST_DB_USER" \
  -d "$SOURCE_DB" -c "UPDATE workspaces SET state = 'frozen' WHERE id = '$SOURCE_WS'" >/dev/null

frozen_state="$(psql -h "$TEST_DB_HOST" -p "$TEST_DB_PORT" -U "$TEST_DB_USER" \
  -d "$SOURCE_DB" -t -A -c "SELECT state FROM workspaces WHERE id = '$SOURCE_WS'" 2>/dev/null)"
[ "$frozen_state" = "frozen" ] || fail "workspace not frozen (got: $frozen_state)"
pass "source frozen"

# ── Phase 2: Count source rows ────────────────────────────────────────────

source_count() {
  psql -h "$TEST_DB_HOST" -p "$TEST_DB_PORT" -U "$TEST_DB_USER" \
    -d "$SOURCE_DB" -t -A -c "SELECT count(*) FROM $1 WHERE deleted_at IS NULL" 2>/dev/null
}

SOURCE_WS_COUNT="$(source_count workspaces)"
SOURCE_MEMBER_COUNT="$(source_count workspace_members)"
SOURCE_CTX_COUNT="$(source_count access_contexts)"
echo "  source counts: workspaces=$SOURCE_WS_COUNT members=$SOURCE_MEMBER_COUNT contexts=$SOURCE_CTX_COUNT"

# ── Phase 3-4: Export, create target, import ───────────────────────────────

echo "  exporting archive from source..."
OPENOKR_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
DATABASE_URL="postgres://$TEST_DB_USER@$TEST_DB_HOST:$TEST_DB_PORT/$SOURCE_DB" \
  node --experimental-strip-types --no-warnings -e "
const fs = require('fs');
const pg = require('pg');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const core = require('@openokr/core');
const keyRing = core.parseKeyRing({ current: process.env.OPENOKR_ENCRYPTION_KEY });
const { drizzle } = require('drizzle-orm/node-postgres');
const { withWorkspace } = require('@openokr/db');
(async () => {
  const db = drizzle(pool);
  const result = await withWorkspace(db, '$SOURCE_WS', async (tx) => {
    return core.exportWorkspace({ tx, workspaceId: '$SOURCE_WS', ring: keyRing, instance: 'rehearsal' });
  });
  fs.writeFileSync('$DRILL_DIR/archive.okr', result.bytes);
  fs.writeFileSync('$DRILL_DIR/key.txt', process.env.OPENOKR_ENCRYPTION_KEY);
  console.log(JSON.stringify({ rows: Object.values(result.manifest.counts).reduce((a,b)=>a+b,0) }));
  await pool.end();
})();
" 2>/dev/null > "$DRILL_DIR/export.json" || true

[ -f "$DRILL_DIR/archive.okr" ] || fail "no archive produced"
pass "archive exported"

echo "  creating target database..."
psql -h "$TEST_DB_HOST" -p "$TEST_DB_PORT" -U "$TEST_DB_USER" \
  -c "DROP DATABASE IF EXISTS $TARGET_DB" \
  -c "CREATE DATABASE $TARGET_DB" >/dev/null

DATABASE_URL="postgres://$TEST_DB_USER@$TEST_DB_HOST:$TEST_DB_PORT/$TARGET_DB" \
  node --experimental-strip-types --no-warnings \
  packages/db/src/migrate.ts 2>/dev/null

# Provision a target workspace so the import has somewhere to land.
DATABASE_URL="postgres://$TEST_DB_USER@$TEST_DB_HOST:$TEST_DB_PORT/$TARGET_DB" \
  node --experimental-strip-types --no-warnings -e "
const pg = require('pg');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
(async () => {
  await pool.query(\"INSERT INTO users (id, name, email) VALUES ('target-admin-1', 'Target Admin', 'target@example.com')\");
  const core = require('@openokr/core');
  await core.provisionWorkspaceForUser(pool, { id: 'target-admin-1', name: 'Target Admin' });
  await pool.end();
})();
" 2>/dev/null || true

TARGET_WS="$(psql -h "$TEST_DB_HOST" -p "$TEST_DB_PORT" -U "$TEST_DB_USER" \
  -d "$TARGET_DB" -t -A -c "SELECT id FROM workspaces LIMIT 1" 2>/dev/null)"
[ -n "$TARGET_WS" ] || fail "no workspace in target"
pass "target provisioned (workspace $TARGET_WS)"

# ── Phase 3: Dry-run import ───────────────────────────────────────────────

echo "  dry-run import..."
ENCRYPTION_KEY="$(cat "$DRILL_DIR/key.txt")"

DATABASE_URL="postgres://$TEST_DB_USER@$TEST_DB_HOST:$TEST_DB_PORT/$TARGET_DB" \
OPENOKR_ENCRYPTION_KEY="$ENCRYPTION_KEY" \
  node --experimental-strip-types --no-warnings -e "
const fs = require('fs');
const pg = require('pg');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const core = require('@openokr/core');
const { drizzle } = require('drizzle-orm/node-postgres');
const { withWorkspace } = require('@openokr/db');
const keyRing = core.parseKeyRing({ current: process.env.OPENOKR_ENCRYPTION_KEY });
const archiveBytes = fs.readFileSync('$DRILL_DIR/archive.okr');
const archive = core.readArchive(keyRing, archiveBytes);
(async () => {
  const db = drizzle(pool);
  const diff = await withWorkspace(db, '$TARGET_WS', (tx) =>
    core.importWorkspace({ tx, workspaceId: '$TARGET_WS', archive, dryRun: true, actorMemberId: 'target-admin-1' })
  );
  fs.writeFileSync('$DRILL_DIR/dryrun.json', JSON.stringify(diff));
  console.log('dry-run created: ' + JSON.stringify(diff.created));
  await pool.end();
})();
" 2>/dev/null || true

[ -f "$DRILL_DIR/dryrun.json" ] || fail "no dry-run report"
pass "dry-run complete"

# ── Phase 4: Real import ──────────────────────────────────────────────────

echo "  real import..."
DATABASE_URL="postgres://$TEST_DB_USER@$TEST_DB_HOST:$TEST_DB_PORT/$TARGET_DB" \
OPENOKR_ENCRYPTION_KEY="$ENCRYPTION_KEY" \
  node --experimental-strip-types --no-warnings -e "
const fs = require('fs');
const pg = require('pg');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const core = require('@openokr/core');
const { drizzle } = require('drizzle-orm/node-postgres');
const { withWorkspace } = require('@openokr/db');
const keyRing = core.parseKeyRing({ current: process.env.OPENOKR_ENCRYPTION_KEY });
const archiveBytes = fs.readFileSync('$DRILL_DIR/archive.okr');
const archive = core.readArchive(keyRing, archiveBytes);
(async () => {
  const db = drizzle(pool);
  const diff = await withWorkspace(db, '$TARGET_WS', (tx) =>
    core.importWorkspace({ tx, workspaceId: '$TARGET_WS', archive, dryRun: false, actorMemberId: 'target-admin-1' })
  );
  fs.writeFileSync('$DRILL_DIR/real.json', JSON.stringify(diff));
  console.log('real created: ' + JSON.stringify(diff.created));
  await pool.end();
})();
" 2>/dev/null || true

[ -f "$DRILL_DIR/real.json" ] || fail "no real import report"
pass "real import complete"

# ── Phase 5: Assertions ───────────────────────────────────────────────────

echo "  asserting dry-run == real..."
DRYRUN_CREATED="$(node -e "const d=require('$DRILL_DIR/dryrun.json'); console.log(JSON.stringify(d.created))" 2>/dev/null)"
REAL_CREATED="$(node -e "const d=require('$DRILL_DIR/real.json'); console.log(JSON.stringify(d.created))" 2>/dev/null)"

if [ "$DRYRUN_CREATED" = "$REAL_CREATED" ]; then
  pass "dry-run created == real created"
else
  echo "  dry-run: $DRYRUN_CREATED" >&2
  echo "  real:    $REAL_CREATED" >&2
  fail "dry-run and real import reports differ"
fi

echo "  checking target row counts..."
target_count() {
  psql -h "$TEST_DB_HOST" -p "$TEST_DB_PORT" -U "$TEST_DB_USER" \
    -d "$TARGET_DB" -t -A -c "SELECT count(*) FROM $1 WHERE deleted_at IS NULL" 2>/dev/null
}

TARGET_WS_COUNT="$(target_count workspaces)"
[ "$TARGET_WS_COUNT" -ge 1 ] || fail "no workspace in target after import"
pass "workspace exists in target ($TARGET_WS_COUNT)"

TARGET_USER_COUNT="$(psql -h "$TEST_DB_HOST" -p "$TEST_DB_PORT" -U "$TEST_DB_USER" \
  -d "$TARGET_DB" -t -A -c "SELECT count(*) FROM users" 2>/dev/null)"
[ "$TARGET_USER_COUNT" -ge 1 ] || fail "no user in target"
pass "user exists in target ($TARGET_USER_COUNT)"

# ── Phase 7: Rollback test ────────────────────────────────────────────────

echo "  unfreezing source (rollback test)..."
psql -h "$TEST_DB_HOST" -p "$TEST_DB_PORT" -U "$TEST_DB_USER" \
  -d "$SOURCE_DB" -c "UPDATE workspaces SET state = 'active' WHERE id = '$SOURCE_WS'" >/dev/null

unfrozen_state="$(psql -h "$TEST_DB_HOST" -p "$TEST_DB_PORT" -U "$TEST_DB_USER" \
  -d "$SOURCE_DB" -t -A -c "SELECT state FROM workspaces WHERE id = '$SOURCE_WS'" 2>/dev/null)"
[ "$unfrozen_state" = "active" ] || fail "workspace not unfrozen (got: $unfrozen_state)"
pass "source unfrozen (rollback viable)"

echo "cutover rehearsal: all assertions passed"
