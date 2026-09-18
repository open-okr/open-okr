#!/bin/sh
# Rebuilds the public demonstration instance from nothing (P8-T13c).
#
# Run it from a checkout of this repository, on the host that runs the demo:
#
#     sh deploy/demo/reset.sh
#
# On a schedule, which is the point. Every night at three, keeping the log:
#
#     0 3 * * *  cd /srv/open-okr && sh deploy/demo/reset.sh >> /var/log/openokr-demo-reset.log 2>&1
#
# **It destroys everything, every time, and that is the design.** A demo
# instance strangers can write to accumulates whatever they wrote, and a reset
# that tried to delete only what they added would be a delete path nobody
# exercises against a schema of 129 tables. Starting from an empty volume is
# the only reset that cannot leave half of something behind.
#
# **It is not a general erasure tool and must never become one.** The compose
# project name below is fixed rather than read from the environment, so this
# cannot be pointed at a production stack by passing a variable, and it starts
# by destroying the volumes of that one project and nothing else.
set -eu

cd "$(dirname "$0")/../.."
REPO="$(pwd)"

# Fixed on purpose. Every other deployment variable here is overridable and
# this one is not: a reset that took its target from the environment is one
# typo away from destroying somebody's instance.
PROJECT="openokr-demo"

: "${OPENOKR_DEMO_DB_PORT:=55433}"
: "${OPENOKR_DEMO_HTTP_PORT:=80}"
: "${OPENOKR_DEMO_OWNER_EMAIL:=demo-owner@northwind.example}"
: "${OPENOKR_DEMO_OWNER_NAME:=Demo Operator}"
# Not a secret: this account exists only inside an instance that is destroyed
# every night, and the whole instance is public. It is separate from the
# persona password so that the operator account and the visitor accounts are
# not the same credential.
: "${OPENOKR_DEMO_OWNER_PASSWORD:=demo-operator-passphrase}"
export OPENOKR_DEMO_DB_PORT

BASE="http://localhost:$OPENOKR_DEMO_HTTP_PORT"

log() { echo "demo-reset: $1"; }
fail() { echo "demo-reset: $1" >&2; exit 1; }

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose -p "$PROJECT" \
      -f "$REPO/deploy/docker/compose.yaml" \
      -f "$REPO/deploy/demo/compose.demo.yaml" "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose -p "$PROJECT" \
      -f "$REPO/deploy/docker/compose.yaml" \
      -f "$REPO/deploy/demo/compose.demo.yaml" "$@"
  else
    fail "Docker Compose is not installed."
  fi
}

command -v pnpm >/dev/null 2>&1 \
  || fail "pnpm is not installed. The seed and the persona command run from this checkout."
command -v curl >/dev/null 2>&1 || fail "curl is not installed."

# Both commands below are run with --env-file-if-exists=../../.env, and Node
# lets a file in that flag overwrite what is already in the environment. A
# checkout carrying a developer .env would therefore point the seed at that
# database instead of at the container this script just started, which is the
# one way this script could write to something it did not create.
if [ -f "$REPO/.env" ]; then
  fail "This checkout has a .env. Remove it: the seed would read its DATABASE_URL instead of the demo container's."
fi

# --- tear it down, volumes and all ---------------------------------------
log "stopping $PROJECT and deleting its volumes"
compose down -v >/dev/null 2>&1 || true
# The secrets are generated once and kept forever, which is right for a real
# install and wrong here: Postgres sets its password only when it initialises
# an empty data directory, so a surviving secrets file plus a fresh volume is
# an instance that can never authenticate.
rm -rf "$REPO/deploy/docker/secrets"

# --- bring it back -------------------------------------------------------
log "generating secrets and starting"
( cd "$REPO/deploy/docker" \
  && OPENOKR_HTTP_PORT="$OPENOKR_DEMO_HTTP_PORT" \
     OPENOKR_DEMO_DB_PORT="$OPENOKR_DEMO_DB_PORT" \
     COMPOSE_FILE="compose.yaml:../demo/compose.demo.yaml" \
     COMPOSE_PROJECT_NAME="$PROJECT" \
     ./openokr up ) \
  || fail "the stack did not start"

log "waiting for the application"
waited=0
until [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health")" = "200" ]; do
  waited=$((waited + 5))
  if [ "$waited" -gt 300 ]; then
    fail "the application did not become healthy in five minutes"
  fi
  sleep 5
done
log "healthy after ${waited}s"

# --- claim it ------------------------------------------------------------
# The first account on an unclaimed instance. Registration closes behind it,
# which is the rule rather than a demo-specific setting: every visitor after
# this signs in as a persona.
log "creating the operator account"
code=$(curl -s -o /dev/null -w '%{http_code}' \
  -X POST "$BASE/api/auth/sign-up/email" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$OPENOKR_DEMO_OWNER_EMAIL\",\"password\":\"$OPENOKR_DEMO_OWNER_PASSWORD\",\"name\":\"$OPENOKR_DEMO_OWNER_NAME\"}")
[ "$code" = "200" ] || fail "creating the operator account returned $code"

# --- fill it -------------------------------------------------------------
db_password=$(grep '^POSTGRES_PASSWORD=' "$REPO/deploy/docker/secrets/db.env" | cut -d= -f2-)
[ -n "$db_password" ] || fail "could not read the generated database password"
DATABASE_URL="postgres://openokr:$db_password@127.0.0.1:$OPENOKR_DEMO_DB_PORT/openokr"
export DATABASE_URL
BETTER_AUTH_URL="$BASE"
export BETTER_AUTH_URL
BETTER_AUTH_SECRET=$(grep '^BETTER_AUTH_SECRET=' "$REPO/deploy/docker/secrets/app.env" | cut -d= -f2-)
export BETTER_AUTH_SECRET

log "seeding the demo organisation"
( cd "$REPO" && pnpm db:seed ) || fail "the seed failed"

log "giving the cast accounts and running the agents"
( cd "$REPO" && pnpm demo:prepare ) || fail "demo:prepare failed"

log "done. $BASE is a fresh demonstration instance."
