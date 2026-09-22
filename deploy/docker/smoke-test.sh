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
# The count is not pinned. It was, and adding a migration broke this check for
# a reason that had nothing to do with what it tests. What matters is that the
# boot applied a schema to an empty database, which the volume teardown in
# cleanup guarantees. The cluster test makes the same check the same way.
app_log | grep -qE "applied [0-9]+ migration" \
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

# --- the public address carries the port it is published on ---------------
# **This is checked as a written value, not as a request that worked** (P8-G06).
# `public_url()` ignored OPENOKR_HTTP_PORT and wrote a bare http://localhost
# into BETTER_AUTH_URL, and Better Auth then refused every sign-in with
# "Invalid origin" because a browser's Origin header carries the port. This
# script runs on 8088 and never noticed, because curl sends no Origin header at
# all, so the sign-up below passed while a real browser could not sign in.
#
# Anything that drives this instance with curl will keep passing whatever this
# value says, so the value itself is the check.
written="$(grep '^BETTER_AUTH_URL=' secrets/app.env | cut -d= -f2-)"
[ "$written" = "$BASE" ] \
  || fail "BETTER_AUTH_URL is '$written', but the instance is served on $BASE"
pass "the public address matches the port the instance is published on"

# It must also survive a second `up`, because reconcile_public_url runs on every
# start and used to overwrite a hand-fixed value with the portless one.
./openokr up >/dev/null 2>&1 || fail "a second up failed"
written="$(grep '^BETTER_AUTH_URL=' secrets/app.env | cut -d= -f2-)"
[ "$written" = "$BASE" ] \
  || fail "a second up rewrote BETTER_AUTH_URL to '$written'"
pass "a second up leaves the public address alone"

# --- the proxy forwards the host with its port --------------------------
# **A configuration assertion, and it says so** (P8-G07). Caddy's `{host}` is
# the hostname with the port stripped, so an instance on any port but 80 sent
# `X-Forwarded-Host: localhost` while the browser sent `Origin: localhost:8088`.
# Next.js compares those two on every forwarded Server Action and aborts when
# they disagree, so every form and every write from the interface failed.
#
# **This cannot be checked behaviourally from here.** A Server Action is a
# browser mechanism carrying headers this script cannot honestly reproduce, and
# a curl POST to an API route is not one and never trips the check. So the
# configuration is what is asserted, and the behaviour belongs to the
# end-to-end suite the day it runs behind this proxy rather than in front of it.
grep -q 'header_up X-Forwarded-Host {hostport}' Caddyfile \
  || fail "the proxy forwards X-Forwarded-Host without the port; every Server Action will be refused"
pass "the proxy forwards the host with its port"

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

# --- the upgrade path takes a backup, then re-runs migrations -------------
# Idempotence is what makes an upgrade safe to repeat, so it is checked rather
# than assumed.
# The image is already on this host, so the pull is skipped: reaching a
# registry that does not have it takes minutes to fail and proves nothing.
backups_before="$(ls -1d ./backups/*/ 2>/dev/null | wc -l | tr -d ' ')"
OPENOKR_SKIP_PULL=1 ./openokr upgrade >/dev/null 2>&1 || fail "upgrade failed"
pass "the upgrade command ran"

# **The backup is the rollback** (P7-T09c). Migrations are forward-only, so
# once one has applied the previous image cannot read the schema and
# restoring is the only way back. An upgrade that proceeded without a backup
# would have removed the way back before anybody knew they needed it, so the
# helper refuses. This is the assertion that the refusal is not theoretical.
backups_after="$(ls -1d ./backups/*/ 2>/dev/null | wc -l | tr -d ' ')"
[ "$backups_after" -gt "$backups_before" ] \
  || fail "the upgrade took no backup (before ${backups_before}, after ${backups_after})"
pass "the upgrade took a backup first"

# And the refusal itself: an unwritable backup directory must stop the
# upgrade rather than proceed without one. Checked with a file where the
# directory should be, which is the cheapest way to make the dump fail for a
# reason that has nothing to do with the database.
mkdir -p ./backups-refusal-probe && rmdir ./backups-refusal-probe
: > ./backups-refusal-probe
if OPENOKR_BACKUP_DIR=./backups-refusal-probe OPENOKR_SKIP_PULL=1 \
     ./openokr upgrade >/dev/null 2>&1; then
  rm -f ./backups-refusal-probe
  fail "the upgrade proceeded with a backup directory it could not write"
fi
rm -f ./backups-refusal-probe
pass "an upgrade that cannot back up refuses to run"

# The opt-out still works, for a deployment whose database is backed up
# elsewhere. It is a variable rather than a flag because it is a thing an
# operator decides once about their deployment, not per upgrade.
OPENOKR_SKIP_BACKUP=1 OPENOKR_SKIP_PULL=1 ./openokr upgrade >/dev/null 2>&1 \
  || fail "the upgrade refused even with OPENOKR_SKIP_BACKUP=1"
pass "OPENOKR_SKIP_BACKUP=1 upgrades without one"

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

# **"Migrations are current" is not "the server is listening".** The entrypoint
# prints that line and then execs the server, so the check below used to race a
# process that had not opened its port yet: the proxy answered 502 with
# "connection refused" and the failure read as "the instance did not survive the
# upgrade", which is the one thing it had not proved.
#
# It won that race for seven runs and lost it on the eighth, when P6-G01b
# registered one more cron at boot and P6-G07a added a badge query to the
# application shell that every render of `/` now makes. Neither is a reason the
# instance would not survive an upgrade, and the end-to-end job boots the same
# standalone server and passed. So the wait is what was missing.
#
# The first boot needs none of this because `./openokr up` waits for health
# itself. Only the restart path asserted straight off a log line.
waited=0
until [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")" != "502" ]; do
  waited=$((waited + 2))
  [ "$waited" -lt 60 ] || fail "the app did not start listening after the upgrade"
  sleep 2
done
pass "the app is serving again after the upgrade"

curl -s -b "$jar" -L "$BASE/" | grep -q "Ada Lovelace" \
  || fail "the instance did not survive the upgrade"
pass "the instance survived the upgrade"

# --- key rotation ---------------------------------------------------------
# A documented lifecycle command that had never run. The script pointed at a
# file the image did not contain, so it failed on a missing module, and nothing
# here exercised it. P2-T14 puts every AI provider key under this same root
# key, so rotation needs to work before there is more to lose.
key_before="$(grep '^OPENOKR_ENCRYPTION_KEY=' secrets/app.env | cut -d= -f2-)"

./openokr rotate-key >/dev/null 2>&1 || fail "rotate-key failed"
pass "the root key rotated"

key_after="$(grep '^OPENOKR_ENCRYPTION_KEY=' secrets/app.env | cut -d= -f2-)"
[ "$key_before" != "$key_after" ] || fail "rotate-key left the same key in place"
pass "the stored root key actually changed"

grep -q '^OPENOKR_PREVIOUS_ENCRYPTION_KEYS=' secrets/app.env \
  && fail "the previous key was left on the ring after a completed rotation"
pass "the previous key was removed once rotation completed"

# The point of the exercise: the instance still reads its own stored data.
curl -s -b "$jar" -L "$BASE/" | grep -q "Ada Lovelace" \
  || fail "the instance stopped working after rotation"
pass "the instance still works after rotation"

echo "openokr: all checks passed in ${elapsed}s"
