#!/bin/sh
# Chart checks (P1-T10).
#
# `helm lint` proves a chart parses. These prove it behaves: that it refuses
# what it should refuse, that migrations do not run in the pods, that secrets
# are not in the pod spec, and that the probes are wired to a real endpoint.
#
# A chart that lints and installs a broken deployment is the same failure this
# repository has met four times: a gate that passes while checking nothing.
#
#     sh deploy/helm/check.sh
set -eu

cd "$(dirname "$0")"

DB="postgres://openokr:secret@postgres:5432/openokr"
FAILURES=0

pass() { echo "  ok    $1"; }
fail() { echo "  FAIL  $1" >&2; FAILURES=$((FAILURES + 1)); }

render() { helm template openokr . --set "database.url=$DB" "$@" 2>&1; }

# One template at a time. Grepping the whole manifest for "is this credential
# in the pod spec" reads the next document too, and answers the wrong
# question.
render_one() {
  template="$1"
  shift
  helm template openokr . --set "database.url=$DB" -s "templates/$template" "$@" 2>&1
}

# Renders and expects failure. Returns the message so it can be matched.
render_expecting_failure() { helm template openokr . "$@" 2>&1 || true; }

echo "openokr: chart checks"

# --- it lints -------------------------------------------------------------
if helm lint . --set "database.url=$DB" >/dev/null 2>&1; then
  pass "the chart lints"
else
  fail "the chart does not lint"
fi

# --- what it refuses ------------------------------------------------------
if render_expecting_failure | grep -q "OpenOKR needs a database"; then
  pass "refuses an install with no database, and says what to set"
else
  fail "installed without a database"
fi

if render_expecting_failure --set database.url=mysql://nope | grep -q "postgres://"; then
  pass "refuses a database URL that is not Postgres"
else
  fail "accepted a non-Postgres database URL"
fi

if render --set persistence.enabled=true --set replicaCount=3 2>&1 \
  | grep -q "cannot be shared across nodes"; then
  pass "refuses ReadWriteOnce storage with several replicas"
else
  fail "allowed several replicas to share a ReadWriteOnce volume"
fi

if render --set mail.transport=smtp 2>&1 | grep -q "mail.host is empty"; then
  pass "refuses the smtp transport with no host"
else
  fail "allowed an smtp transport with no host"
fi

if render --set instance.registration=sometimes 2>&1 \
  | grep -q "auto, open or invite_only"; then
  pass "refuses an unrecognised registration policy"
else
  fail "accepted an unrecognised registration policy"
fi

# --- migrations run in the hook, not in the pods -------------------------
manifest=$(render)

if echo "$manifest" | grep -q "helm.sh/hook.*pre-install,pre-upgrade"; then
  pass "migrations run in a pre-install and pre-upgrade hook"
else
  fail "no migration hook found"
fi

if echo "$manifest" | grep -q "OPENOKR_SKIP_MIGRATIONS"; then
  pass "the application pods skip migrations, so replicas do not race"
else
  fail "the pods would run migrations themselves"
fi

# --- secrets stay out of the pod spec ------------------------------------
# The literal password from $DB. If this appears in the Deployment or the
# migration Job, the credential is readable with `kubectl describe pod` by
# anyone who can see the namespace.
if render_one deployment.yaml | grep -q "secret@postgres"; then
  fail "the database password is in the pod spec"
else
  pass "no credential is inlined in the pod spec"
fi

if render_one migration-job.yaml | grep -q "secret@postgres"; then
  fail "the database password is in the migration job spec"
else
  pass "no credential is inlined in the migration job"
fi

if echo "$manifest" | grep -q "helm.sh/resource-policy: keep"; then
  pass "the generated secret survives an uninstall"
else
  fail "an uninstall would delete the encryption key"
fi

# The generated encryption key must itself be base64 of exactly 32 bytes: the
# application refuses anything else at boot. The first version of this chart
# generated 32 characters, which decodes to 24 bytes, and every pod
# crash-looped on a key ring error. The Secret stores it base64-encoded, so
# this decodes twice.
secrets=$(render_one secrets.yaml)
key=$(echo "$secrets" | grep "encryption-key:" | head -1 | sed 's/.*encryption-key: *//')
if [ -n "$key" ]; then
  bytes=$(echo "$key" | base64 -d 2>/dev/null | base64 -d 2>/dev/null | wc -c | tr -d ' ')
  if [ "$bytes" = "32" ]; then
    pass "the generated encryption key is 32 bytes, as the application requires"
  else
    fail "the generated encryption key decodes to $bytes bytes, not 32"
  fi
else
  fail "no encryption key was generated"
fi

# The migration hook runs before the chart's normal resources, so anything it
# needs must be a hook as well. Helm's first install fails otherwise, which is
# how this was found.
if echo "$secrets" | grep -q "hook-weight"; then
  pass "secrets are created before the migration hook that reads them"
else
  fail "the migration hook would run before its secrets exist"
fi

# --- probes hit something real -------------------------------------------
if echo "$manifest" | grep -q "path: /api/health"; then
  pass "probes read the readiness endpoint"
else
  fail "probes do not read the readiness endpoint"
fi

for probe in readinessProbe livenessProbe startupProbe; do
  if echo "$manifest" | grep -q "$probe"; then
    pass "$probe is set"
  else
    fail "$probe is missing"
  fi
done

# --- security defaults ----------------------------------------------------
if echo "$manifest" | grep -q "runAsNonRoot: true"; then
  pass "pods run as a non-root user"
else
  fail "pods may run as root"
fi

if echo "$manifest" | grep -q "readOnlyRootFilesystem: true"; then
  pass "the root filesystem is read-only"
else
  fail "the root filesystem is writable"
fi

if echo "$manifest" | grep -q "automountServiceAccountToken: false"; then
  pass "no Kubernetes API token is mounted"
else
  fail "a Kubernetes API token is mounted for no reason"
fi

# --- the optional pieces render ------------------------------------------
if render --set ingress.enabled=true --set ingress.hosts[0].host=okr.example.com \
  --set ingress.hosts[0].paths[0].path=/ \
  --set ingress.hosts[0].pathType=Prefix 2>&1 | grep -q "kind: Ingress"; then
  pass "the ingress renders when enabled"
else
  fail "the ingress does not render"
fi

if render --set database.existingSecret=my-secret 2>&1 | grep -q "name: my-secret"; then
  pass "an existing database secret is used when given"
else
  fail "an existing database secret was ignored"
fi

if render --set secrets.existingSecret=my-keys 2>&1 | grep -q "name: my-keys"; then
  pass "an existing key secret is used when given"
else
  fail "an existing key secret was ignored"
fi

echo ""
if [ "$FAILURES" -gt 0 ]; then
  echo "openokr: $FAILURES chart check(s) failed." >&2
  exit 1
fi
echo "openokr: all chart checks passed."
