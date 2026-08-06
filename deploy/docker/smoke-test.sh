#!/bin/sh
# Proves the compose target actually works (P1-T09).
#
# The acceptance criterion is "given a clean server, when compose and the
# wizard run, then a secured instance with an admin exists inside the
# 30-minute budget". That is a claim about a deployment, not about a function,
# so it is checked by making a deployment and using it.
#
# Run from this directory:
#     OPENOKR_IMAGE=openokr:test sh smoke-test.sh
set -eu

cd "$(dirname "$0")"

: "${OPENOKR_IMAGE:=openokr:test}"
: "${OPENOKR_HTTP_PORT:=8088}"
: "${OPENOKR_HTTPS_PORT:=8443}"
export OPENOKR_IMAGE OPENOKR_HTTP_PORT OPENOKR_HTTPS_PORT

BASE="http://localhost:$OPENOKR_HTTP_PORT"
BUDGET_SECONDS=1800

pass() { echo "  ok    $1"; }
fail() { echo "  FAIL  $1" >&2; exit 1; }

# Not `./openokr logs`, which follows and never returns. A test that reads a
# log needs a snapshot of it.
service_log() {
  if docker compose version >/dev/null 2>&1; then
    docker compose -p openokr logs "$1" 2>&1
  else
    docker-compose -p openokr logs "$1" 2>&1
  fi
}

app_log() { service_log app; }
proxy_log() { service_log proxy; }

cleanup() {
  # Volumes too. "From nothing" has to include the database volume: Postgres
  # sets its password only when it initialises an empty data directory, so a
  # surviving volume plus regenerated secrets is an instance that can never
  # authenticate. `destroy` asks for confirmation, so compose is called here.
  if docker compose version >/dev/null 2>&1; then
    docker compose -p openokr down -v >/dev/null 2>&1 || true
  else
    docker-compose -p openokr down -v >/dev/null 2>&1 || true
  fi
  rm -rf ./secrets
}

# Print the logs before tearing anything down. A test that destroys its own
# evidence on failure leaves whoever reads the CI output with nothing to go on.
on_exit() {
  status=$?
  if [ "$status" -ne 0 ]; then
    echo "--- app log ---------------------------------------------------" >&2
    app_log | tail -40 >&2
    echo "--- proxy log -------------------------------------------------" >&2
    proxy_log | tail -20 >&2
    echo "---------------------------------------------------------------" >&2
  fi
  cleanup
}
trap on_exit EXIT

echo "openokr: starting from nothing"
cleanup
started=$(date +%s)

./openokr up >/dev/null

ready=$(date +%s)
elapsed=$((ready - started))
echo "openokr: reached healthy in ${elapsed}s"

# --- the budget ------------------------------------------------------------
[ "$elapsed" -lt "$BUDGET_SECONDS" ] \
  || fail "took ${elapsed}s, over the ${BUDGET_SECONDS}s budget"
pass "inside the 30-minute budget (${elapsed}s)"

# --- migrations ran on boot ------------------------------------------------
app_log | grep -q "applied 7 migration" \
  || fail "migrations did not run on boot"
pass "migrations ran on boot"

# --- an unconfigured instance leads to the wizard --------------------------
location=$(curl -s -o /dev/null -w '%{redirect_url}' "$BASE/sign-in")
case "$location" in
  */setup) pass "an unconfigured instance sends you to the wizard" ;;
  *) fail "expected a redirect to /setup, got '$location'" ;;
esac

# --- the wizard reports the deployment honestly ----------------------------
page=$(curl -sL "$BASE/setup")
echo "$page" | grep -q "PostgreSQL" || fail "the wizard did not detect Postgres"
pass "the wizard detected the database"

echo "$page" | grep -q "Not in this build" \
  || fail "a port with no driver did not say so"
pass "ports with no driver say so rather than showing a tick"

# --- the proxy is doing its job -------------------------------------------
headers=$(curl -s -D - -o /dev/null "$BASE/setup")
echo "$headers" | grep -qi "X-Frame-Options: DENY" \
  || fail "the proxy did not set X-Frame-Options"
echo "$headers" | grep -qi "^Server:" \
  && fail "the proxy is still announcing itself"
pass "the proxy set its security headers"

# --- an admin can be created and can use the instance ---------------------
jar=$(mktemp)
code=$(curl -s -c "$jar" -b "$jar" -o /dev/null -w '%{http_code}' \
  -X POST "$BASE/api/auth/sign-up/email" \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"correct-horse-battery-staple","name":"Ada Lovelace"}')
[ "$code" = "200" ] || fail "creating the first account returned $code"
pass "the first account was created"

curl -s -b "$jar" -L "$BASE/" | grep -q "Ada Lovelace" \
  || fail "the admin could not reach a provisioned workspace"
pass "the admin reached a provisioned workspace"

# --- the upgrade path re-runs migrations without damage -------------------
# Idempotence is what makes an upgrade safe to repeat, so it is checked rather
# than assumed.
# The image is already on this host, so the pull is skipped: reaching a
# registry that does not have it takes minutes to fail and proves nothing.
OPENOKR_SKIP_PULL=1 ./openokr upgrade >/dev/null 2>&1 || fail "upgrade failed"
pass "the upgrade command ran"

# Restarting is what actually re-runs the entrypoint. `compose up -d` leaves a
# container alone when its image has not changed, which is right for an
# upgrade and useless for testing what a second boot does.
if docker compose version >/dev/null 2>&1; then
  docker compose -p openokr restart app >/dev/null 2>&1
else
  docker-compose -p openokr restart app >/dev/null 2>&1
fi

waited=0
until app_log | grep -q "schema is up to date"; do
  waited=$((waited + 2))
  [ "$waited" -lt 60 ] || fail "a second boot did not report the schema as already current"
  sleep 2
done
pass "re-running migrations is idempotent"

curl -s -b "$jar" -L "$BASE/" | grep -q "Ada Lovelace" \
  || fail "the instance did not survive the upgrade"
pass "the instance survived the upgrade"

echo "openokr: all checks passed in ${elapsed}s"
