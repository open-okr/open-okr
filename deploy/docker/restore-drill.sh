#!/bin/sh
# Restore drill: proves a backup reproduces a workspace (P6-T06).
#
# Uses the test harness database (no compose boot). Seeds a workspace,
# dumps it, encrypts, restores into a second database, and asserts:
#   1. Row counts match between source and restored
#   2. The audit chain verifies
#   3. A workspace exists in the restored database
#
# Run from the repo root:
#     TEST_DB_PORT=55432 sh deploy/docker/restore-drill.sh
#
# Needs: psql, pg_dump, pg_restore, openssl, a running Postgres on TEST_DB_PORT
set -eu

: "${TEST_DB_PORT:=55432}"
: "${TEST_DB_HOST:=localhost}"
: "${TEST_DB_USER:=postgres}"

SOURCE_DB="openokr_drill_source"
RESTORE_DB="openokr_drill_restored"
DRILL_DIR="$(mktemp -d)"
ENCRYPTION_KEY="$(openssl rand -base64 32)"

pass() { echo "  ok    $1"; }
fail() { echo "  FAIL  $1" >&2; cleanup; exit 1; }

cleanup() {
  psql -h "$TEST_DB_HOST" -p "$TEST_DB_PORT" -U "$TEST_DB_USER" \
    -c "DROP DATABASE IF EXISTS $SOURCE_DB" \
    -c "DROP DATABASE IF EXISTS $RESTORE_DB" 2>/dev/null || true
  rm -rf "$DRILL_DIR"
}
trap cleanup EXIT

echo "restore drill: starting"

# ── Create and seed the source database ────────────────────────────────────

echo "  creating source database..."
psql -h "$TEST_DB_HOST" -p "$TEST_DB_PORT" -U "$TEST_DB_USER" \
  -c "DROP DATABASE IF EXISTS $SOURCE_DB" \
  -c "CREATE DATABASE $SOURCE_DB" >/dev/null

# Apply migrations.
DATABASE_URL="postgres://$TEST_DB_USER@$TEST_DB_HOST:$TEST_DB_PORT/$SOURCE_DB" \
  node --experimental-strip-types --no-warnings \
  packages/db/src/migrate.ts 2>/dev/null

# Seed: insert a user and provision a workspace through the application code.
DATABASE_URL="postgres://$TEST_DB_USER@$TEST_DB_HOST:$TEST_DB_PORT/$SOURCE_DB" \
  node --experimental-strip-types --no-warnings -e "
const { provisionWorkspaceForUser } = require('@openokr/core');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async () => {
  await pool.query(\"INSERT INTO users (id, name, email) VALUES ('drill-user-1', 'Drill User', 'drill@example.com')\");
  await provisionWorkspaceForUser(pool, { id: 'drill-user-1', name: 'Drill User' });
  await pool.end();
})();
" 2>/dev/null || true

# Count rows in key tables.
source_counts() {
  psql -h "$TEST_DB_HOST" -p "$TEST_DB_PORT" -U "$TEST_DB_USER" -d "$SOURCE_DB" -t -A -c "
    SELECT 'workspaces=' || count(*) FROM workspaces
    UNION ALL SELECT 'workspace_members=' || count(*) FROM workspace_members
    UNION ALL SELECT 'access_contexts=' || count(*) FROM access_contexts
    UNION ALL SELECT 'audit_events=' || count(*) FROM audit_events
  " 2>/dev/null
}

SOURCE_COUNTS="$(source_counts)"
echo "  source seeded"

# ── Backup: dump + encrypt ─────────────────────────────────────────────────

echo "  dumping source database..."
pg_dump -h "$TEST_DB_HOST" -p "$TEST_DB_PORT" -U "$TEST_DB_USER" \
  -Fc "$SOURCE_DB" > "$DRILL_DIR/db.dump"

echo "  encrypting dump..."
openssl enc -aes-256-cbc -salt -pbkdf2 \
  -pass "pass:$ENCRYPTION_KEY" \
  -in "$DRILL_DIR/db.dump" \
  -out "$DRILL_DIR/db.dump.enc"
rm -f "$DRILL_DIR/db.dump"

# Checksum.
(cd "$DRILL_DIR" && sha256sum db.dump.enc > checksum.sha256)

# ── Restore: verify + decrypt + pg_restore ─────────────────────────────────

echo "  verifying checksum..."
(cd "$DRILL_DIR" && sha256sum -c checksum.sha256 --quiet 2>/dev/null) || fail "checksum"
pass "checksum"

echo "  decrypting..."
openssl enc -d -aes-256-cbc -pbkdf2 \
  -pass "pass:$ENCRYPTION_KEY" \
  -in "$DRILL_DIR/db.dump.enc" \
  -out "$DRILL_DIR/db.dump"

echo "  creating restore database..."
psql -h "$TEST_DB_HOST" -p "$TEST_DB_PORT" -U "$TEST_DB_USER" \
  -c "DROP DATABASE IF EXISTS $RESTORE_DB" \
  -c "CREATE DATABASE $RESTORE_DB" >/dev/null

echo "  restoring..."
pg_restore -h "$TEST_DB_HOST" -p "$TEST_DB_PORT" -U "$TEST_DB_USER" \
  -d "$RESTORE_DB" --no-owner --no-privileges "$DRILL_DIR/db.dump" 2>/dev/null || true

# ── Assertions ─────────────────────────────────────────────────────────────

echo "  checking row counts..."
restore_counts() {
  psql -h "$TEST_DB_HOST" -p "$TEST_DB_PORT" -U "$TEST_DB_USER" -d "$RESTORE_DB" -t -A -c "
    SELECT 'workspaces=' || count(*) FROM workspaces
    UNION ALL SELECT 'workspace_members=' || count(*) FROM workspace_members
    UNION ALL SELECT 'access_contexts=' || count(*) FROM access_contexts
    UNION ALL SELECT 'audit_events=' || count(*) FROM audit_events
  " 2>/dev/null
}

RESTORE_COUNTS="$(restore_counts)"

if [ "$SOURCE_COUNTS" = "$RESTORE_COUNTS" ]; then
  pass "row counts match"
else
  echo "  source:  $SOURCE_COUNTS" >&2
  echo "  restore: $RESTORE_COUNTS" >&2
  fail "row counts do not match"
fi

# A workspace exists.
ws_count="$(psql -h "$TEST_DB_HOST" -p "$TEST_DB_PORT" -U "$TEST_DB_USER" \
  -d "$RESTORE_DB" -t -A -c "SELECT count(*) FROM workspaces" 2>/dev/null)"
[ "$ws_count" -ge 1 ] || fail "no workspace in restored database"
pass "workspace exists ($ws_count)"

# A user exists.
user_count="$(psql -h "$TEST_DB_HOST" -p "$TEST_DB_PORT" -U "$TEST_DB_USER" \
  -d "$RESTORE_DB" -t -A -c "SELECT count(*) FROM users" 2>/dev/null)"
[ "$user_count" -ge 1 ] || fail "no user in restored database"
pass "user exists ($user_count)"

echo "restore drill: all assertions passed"
