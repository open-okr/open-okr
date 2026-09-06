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

# Rendered once with nothing overridden. Several checks below read it, and
# reading the manifest rather than values.yaml is the point: a template that
# ignored a value would still fail here.
defaults=$(render)

# --- S3-compatible object storage (P6-G05) --------------------------------
if render --set storage.s3.bucket=openokr-files 2>&1 \
  | grep -q "storage.s3.existingSecret is empty"; then
  pass "refuses a bucket with no credential Secret"
else
  fail "accepted a bucket with credentials that could only come from values"
fi

if render --set storage.s3.forcePathStyle=yes 2>&1 \
  | grep -q "must be"; then
  pass "refuses a forcePathStyle that is not on or off"
else
  fail "accepted an unrecognised forcePathStyle"
fi

s3=$(render --set storage.s3.bucket=openokr-files \
  --set storage.s3.existingSecret=openokr-s3 \
  --set storage.s3.endpoint=http://minio:9000 \
  --set replicaCount=3)

if printf '%s' "$s3" | grep -q "OPENOKR_STORAGE_S3_BUCKET"; then
  pass "a named bucket reaches the pod"
else
  fail "a named bucket never reached the pod"
fi

if printf '%s' "$s3" | grep -q "OPENOKR_STORAGE_S3_ACCESS_KEY_ID"; then
  if printf '%s' "$s3" | grep -A 3 "OPENOKR_STORAGE_S3_ACCESS_KEY_ID" \
    | grep -q "secretKeyRef"; then
    pass "S3 credentials come from a Secret, not from the pod spec"
  else
    fail "an S3 credential is in the pod spec"
  fi
else
  fail "no S3 credentials reached the pod"
fi

# Object storage is shared by definition, so the replica count stops mattering.
# Rendering above with replicaCount=3 and the default ReadWriteOnce mode is the
# assertion: it would have been refused without a bucket.
if printf '%s' "$s3" | grep -q "replicas: 3"; then
  pass "object storage lifts the single-replica limit"
else
  fail "a bucket did not lift the single-replica limit"
fi

# --- the storage root the application actually reads ----------------------
# The chart set OPENOKR_STORAGE_DIR from P1-T10 until P6-G05 and nothing has
# ever read it: the schema declares OPENOKR_STORAGE_ROOT. It happened to work,
# because ROOT defaults to a relative path and the image runs from /app.
if printf '%s' "$defaults" | grep -q "OPENOKR_STORAGE_ROOT"; then
  pass "sets the storage root variable the application reads"
else
  fail "sets a storage variable the application does not read"
fi

if printf '%s' "$defaults" | grep -q "OPENOKR_STORAGE_DIR"; then
  fail "still sets OPENOKR_STORAGE_DIR, which nothing reads"
else
  pass "no longer sets a variable nothing reads"
fi

# --- the shipped defaults keep files --------------------------------------
# The combination the previous defaults produced, two replicas with persistence
# off, is the one that loses uploads silently (GAP-AUDIT B-11).
if printf '%s' "$defaults" | grep -q "persistentVolumeClaim"; then
  pass "the default install mounts a volume for uploads"
else
  fail "the default install sends uploads to an emptyDir"
fi

if printf '%s' "$defaults" | grep -A 3 "name: storage" | grep -q "emptyDir"; then
  fail "storage is an emptyDir with the shipped values"
else
  pass "storage is not an emptyDir with the shipped values"
fi

if [ "$(printf '%s' "$defaults" | grep -c '^  replicas: 1$')" -ge 1 ]; then
  pass "the default install is one replica, which ReadWriteOnce requires"
else
  fail "the default replica count does not match the default storage mode"
fi

# --- turning it off is allowed, and says what it costs --------------------
if render --set persistence.enabled=false --set replicaCount=3 >/dev/null 2>&1; then
  pass "several replicas with no shared storage is allowed, not refused"
else
  fail "refused a configuration an upgrade could already be running"
fi

if helm template openokr . --set "database.url=$DB" \
  --set persistence.enabled=false --show-only templates/NOTES.txt 2>/dev/null \
  | grep -q "WARNING: persistence is off"; then
  pass "warns when uploads are going to an emptyDir"
else
  # NOTES.txt is not a template helm can --show-only, on some versions. Fall
  # back to reading the file itself, which is what the warning lives in.
  if grep -q "WARNING: persistence is off" templates/NOTES.txt; then
    pass "warns when uploads are going to an emptyDir"
  else
    fail "says nothing when uploads are going to an emptyDir"
  fi
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
