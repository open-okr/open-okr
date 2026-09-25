#!/bin/sh
# Adds the seven UAT persona accounts to a running staging instance.
#
# Run it on the staging host, from a checkout of this repository, after the
# first account has finished the setup wizard (UAT modules M01 and M02):
#
#     sh deploy/staging/seed.sh --inbox qa@example.com [--password <value>]
#
# Everything after the script name goes to `pnpm uat:personas` unchanged. The
# stack must be running with compose.staging.yaml overlaid, which is what
# publishes Postgres on the loopback address this reads.
#
# It creates people and nothing else, and refuses a workspace that has anybody
# in it besides its founder and the seven personas. It never starts, stops or
# resets the stack: that is `deploy/docker/openokr`, and a seed script that
# could also destroy volumes is one flag away from destroying the wrong ones.
set -eu

cd "$(dirname "$0")/../.."
REPO="$(pwd)"
SECRETS="$REPO/deploy/docker/secrets"

: "${OPENOKR_STAGING_DB_PORT:=55434}"

fail() { echo "staging-seed: $1" >&2; exit 1; }

command -v pnpm >/dev/null 2>&1 \
  || fail "pnpm is not installed. The persona command runs from this checkout."

# `pnpm uat:personas` loads ../../.env if it exists, and Node lets that file
# overwrite what is exported here. A developer .env would point the command at
# a different database, which is the one way this could write somewhere it
# was not asked to.
if [ -f "$REPO/.env" ]; then
  fail "This checkout has a .env. Remove it: the command would read its DATABASE_URL instead of the staging container's."
fi

[ -f "$SECRETS/db.env" ] && [ -f "$SECRETS/app.env" ] \
  || fail "No secrets in $SECRETS. Start the stack with deploy/docker/openokr up first."

secret() {
  grep "^$2=" "$SECRETS/$1" | cut -d= -f2-
}

db_password="$(secret db.env POSTGRES_PASSWORD)"
[ -n "$db_password" ] || fail "could not read POSTGRES_PASSWORD from db.env"

DATABASE_URL="postgres://openokr:$db_password@127.0.0.1:$OPENOKR_STAGING_DB_PORT/openokr"
BETTER_AUTH_URL="$(secret app.env BETTER_AUTH_URL)"
BETTER_AUTH_SECRET="$(secret app.env BETTER_AUTH_SECRET)"
export DATABASE_URL BETTER_AUTH_URL BETTER_AUTH_SECRET

[ -n "$BETTER_AUTH_URL" ] && [ -n "$BETTER_AUTH_SECRET" ] \
  || fail "could not read BETTER_AUTH_URL and BETTER_AUTH_SECRET from app.env"

pnpm uat:personas "$@"
