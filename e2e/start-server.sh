#!/bin/sh
# Starts the end-to-end server (P1-T09).
#
# Runs the standalone build, which is exactly what the Docker image runs, so
# the suite exercises the shipped server rather than `next start`. Next traces
# only the server into the standalone output, so the static assets are copied
# beside it here, the same way the Dockerfile does.
#
# **Two servers run this at once, and everything below the database step is
# shared** (P8-T15). The dashboard instance and the wizard instance are two
# Playwright `webServer` entries, started in parallel, each with its own
# database and port. They point at the *same* standalone directory, so the
# symlink repair and the static copy were being done twice, concurrently, over
# the same files. On Windows that is a race: `cp -r` across a tree another
# process is writing can fail outright or block, and it happens inside
# Playwright's 240-second readiness window, so losing it would cost the whole
# run rather than one spec.
#
# **Found by reading, not by a failure.** A run did time out that way on
# 18 September 2026, but a second end-to-end run turned out to be going at the
# same time against the same databases, so that timeout is not evidence of this
# and is not offered as any. The race is visible in the two commands above: two
# processes, one destination, no ordering between them.
#
# So the shared work is done once, behind a lock. `mkdir` is atomic on every
# filesystem this runs on, which is what makes it a lock rather than a check
# and a hope.
set -eu

cd "$(dirname "$0")/.."

STANDALONE="apps/web/.next/standalone/apps/web"
LOCK="apps/web/.next/standalone/.e2e-prepare.lock"

if [ ! -f "$STANDALONE/server.js" ]; then
  echo "e2e: no standalone build. Run 'pnpm build' first." >&2
  exit 1
fi

# The database is this server's own, named by E2E_DATABASE_NAME, so it is the
# one step that genuinely belongs to each starter and is not behind the lock.
node --experimental-strip-types --no-warnings e2e/prepare-database.ts

prepare_shared() {
  # Windows writes the traced pnpm links as the wrong type, which stops the
  # standalone server before it binds. A no-op on Linux and macOS, and a no-op
  # on Windows too when the repair documented in CLAUDE.md was run after the
  # build.
  node --experimental-strip-types --no-warnings e2e/repair-standalone-links.ts \
    apps/web/.next/standalone/node_modules

  mkdir -p "$STANDALONE/.next"
  cp -r apps/web/.next/static "$STANDALONE/.next/"
  [ -d apps/web/public ] && cp -r apps/web/public "$STANDALONE/" || true
}

if mkdir "$LOCK" 2>/dev/null; then
  prepare_shared
  rmdir "$LOCK"
else
  # The other server got there first. Waiting for the lock to disappear, rather
  # than for a marker file, is what keeps a previous run's leftovers from being
  # read as this run's progress.
  waited=0
  while [ -d "$LOCK" ]; do
    if [ "$waited" -ge 120 ]; then
      # A killed run leaves the lock behind and every run after it would wait
      # here forever, so a stale lock is taken over rather than obeyed. Two
      # minutes is far longer than the copy has ever taken and far shorter than
      # the readiness window it sits inside.
      echo "e2e: taking over a stale prepare lock after 120s." >&2
      rmdir "$LOCK" 2>/dev/null || true
      prepare_shared
      break
    fi
    sleep 1
    waited=$((waited + 1))
  done
fi

exec node "$STANDALONE/server.js"
