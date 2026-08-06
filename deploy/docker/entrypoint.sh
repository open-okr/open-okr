#!/bin/sh
# Container entrypoint (P1-T09).
#
# Three jobs before the server starts: prove the environment is usable, wait
# for Postgres, and run migrations. Each one fails loudly rather than starting
# a server that will fail later in a way nobody can read.
#
# set -e stops on the first failure. Without it a failed migration would be a
# log line nobody reads, followed by a server serving a half-migrated schema.
set -eu

log() {
  echo "openokr: $1"
}

fail() {
  echo "openokr: $1" >&2
  exit 1
}

if [ -z "${DATABASE_URL:-}" ]; then
  fail "DATABASE_URL is not set. There is no sensible default for someone else's database."
fi

# The root key is what makes stored secrets readable. Losing it means losing
# every stored credential, so an instance that has run the wizard must never
# start without one. The compose file generates it on first boot.
if [ -z "${OPENOKR_ENCRYPTION_KEY:-}" ]; then
  fail "OPENOKR_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32"
fi

# Wait for Postgres. Compose health checks cover the ordinary case, but a
# database that is still replaying its write-ahead log after an unclean
# shutdown passes its health check and refuses connections for a while longer.
: "${OPENOKR_DB_WAIT_SECONDS:=60}"

# Written to a file rather than passed with -e, so the quoting stays readable
# and the exit codes can mean different things.
#
#   0  the database answered
#   1  it did not
#   2  the check itself is broken
#
# The third code matters. A check that cannot load its own driver would
# otherwise look exactly like a database that is down, and the operator would
# spend the afternoon on Postgres.
cat > /tmp/db-check.cjs <<'CHECK'
let Client;
try {
  ({ Client } = require("pg"));
} catch (error) {
  console.error(`cannot load the postgres driver: ${error.message}`);
  process.exit(2);
}
const client = new Client({ connectionString: process.env.DATABASE_URL });
client
  .connect()
  .then(() => client.query("select 1"))
  .then(() => client.end())
  .then(
    () => process.exit(0),
    (error) => {
      process.env.OPENOKR_DB_WAIT_VERBOSE && console.error(error.message);
      process.exit(1);
    },
  );
CHECK

# `pg` comes from the standalone server's own traced dependencies, which is
# the only copy in the image.
export NODE_PATH=/app/node_modules

log "waiting for the database (up to ${OPENOKR_DB_WAIT_SECONDS}s)"

waited=0
while true; do
  set +e
  node /tmp/db-check.cjs
  status=$?
  set -e

  if [ "$status" -eq 0 ]; then
    break
  fi
  if [ "$status" -eq 2 ]; then
    fail "the database check could not run. This is a fault in the image, not in your database."
  fi

  waited=$((waited + 2))
  if [ "$waited" -ge "$OPENOKR_DB_WAIT_SECONDS" ]; then
    # One last attempt with the reason printed, so the log says why rather
    # than only that it timed out.
    OPENOKR_DB_WAIT_VERBOSE=1 node /tmp/db-check.cjs || true
    fail "the database did not accept connections within ${OPENOKR_DB_WAIT_SECONDS}s"
  fi
  sleep 2
done

log "database is up"

# Migrations run on boot so an upgrade is a pull and a restart. The runner
# takes a Postgres advisory lock, so several replicas starting together is
# safe: one migrates and the rest wait, then find nothing to do. Helm uses a
# migration hook instead, and the lock makes both correct.
if [ "${OPENOKR_SKIP_MIGRATIONS:-}" = "1" ]; then
  log "skipping migrations (OPENOKR_SKIP_MIGRATIONS=1)"
else
  log "running migrations"
  # Run from /app so ESM resolves `pg` against /app/node_modules. NODE_PATH
  # covers require() but not import, and the runner uses import.
  cd /app && node --experimental-strip-types --no-warnings \
    ./migrator/deploy/docker/migrate.ts
fi

log "starting"
exec "$@"
