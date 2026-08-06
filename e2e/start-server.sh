#!/bin/sh
# Starts the end-to-end server (P1-T09).
#
# Runs the standalone build, which is exactly what the Docker image runs, so
# the suite exercises the shipped server rather than `next start`. Next traces
# only the server into the standalone output, so the static assets are copied
# beside it here, the same way the Dockerfile does.
set -eu

cd "$(dirname "$0")/.."

STANDALONE="apps/web/.next/standalone/apps/web"

if [ ! -f "$STANDALONE/server.js" ]; then
  echo "e2e: no standalone build. Run 'pnpm build' first." >&2
  exit 1
fi

node --experimental-strip-types --no-warnings e2e/prepare-database.ts

mkdir -p "$STANDALONE/.next"
cp -r apps/web/.next/static "$STANDALONE/.next/"
[ -d apps/web/public ] && cp -r apps/web/public "$STANDALONE/" || true

exec node "$STANDALONE/server.js"
