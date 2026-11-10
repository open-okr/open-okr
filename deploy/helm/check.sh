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
# A bucket with no Secret leaves the credentials to the pod's own role
# (plan 0.8.0 H9): no key variable at all, so the AWS SDK's chain decides.
keyless=$(render --set storage.s3.bucket=openokr-files 2>&1)
if printf '%s' "$keyless" | grep -q "name: OPENOKR_STORAGE_S3_BUCKET" \
  && ! printf '%s' "$keyless" | grep -q "name: OPENOKR_STORAGE_S3_ACCESS_KEY_ID"; then
  pass "a bucket with no Secret renders with no key, for workload identity"
else
  fail "a bucket with no Secret was refused, or rendered a key from nowhere"
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
#
# Both greps match on `name:` rather than on the bare variable. helm template
# renders a template's `#` comments into its output, and the comment on the
# deployment explains this very rename, so a bare grep finds the explanation
# and reports it as the setting. That is what turned this check red while the
# chart was correct.
if printf '%s' "$defaults" | grep -q "name: OPENOKR_STORAGE_ROOT"; then
  pass "sets the storage root variable the application reads"
else
  fail "sets a storage variable the application does not read"
fi

if printf '%s' "$defaults" | grep -q "name: OPENOKR_STORAGE_DIR"; then
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

# --- what the install notes say about storage -----------------------------
# `helm template` never renders NOTES.txt, so this used to grep the file for
# the warning, which passed whatever the condition around it said. That is
# how an install with a bucket came to be told its uploads go to an emptyDir.
# A client-side dry run renders the notes and needs no cluster. An output with
# no NOTES section fails, rather than passing on a helm that cannot render it.
notes() {
  helm install openokr . --dry-run=client --set "database.url=$DB" "$@" 2>&1 \
    | sed -n '/^NOTES:/,$p'
}

emptydir_notes=$(notes --set persistence.enabled=false --set replicaCount=2)
if [ -z "$emptydir_notes" ]; then
  fail "this helm cannot render the install notes with --dry-run=client"
elif printf '%s' "$emptydir_notes" | grep -q "WARNING: persistence is off" \
  && printf '%s' "$emptydir_notes" | grep -q "invisible to the other"; then
  pass "warns when uploads are going to an emptyDir"
else
  fail "says nothing when uploads are going to an emptyDir"
fi

bucket_notes=$(notes --set persistence.enabled=false --set replicaCount=2 \
  --set storage.s3.bucket=openokr-files --set storage.s3.existingSecret=openokr-s3)
if printf '%s' "$bucket_notes" | grep -q "WARNING: persistence is off\|invisible to the other\|pinned to one replica"; then
  fail "tells an install with a bucket that its uploads are on a volume"
elif printf '%s' "$bucket_notes" | grep -q "S3 bucket openokr-files"; then
  pass "says uploads go to the bucket when one is named"
else
  fail "does not say where uploads go when a bucket is named"
fi

# --- the database's CA bundle (plan 0.8.0 H6) ------------------------------
# A managed Postgres signs with an authority Node does not hold, so without a
# bundle the only working connection was sslmode=no-verify. With one, every
# workload mounts it and points Node and libpq (the backup jobs) at it.
ca_all=$(render --set database.caBundle.configMap=rds-ca \
  --set database.caBundle.key=global-bundle.pem \
  --set backup.enabled=true --set cloud.erasure.schedule="0 3 * * *" \
  --set database.adminUrl=postgres://owner:secret@db:5432/openokr)
ca_ok=true
for workload in deployment.yaml migration-job.yaml erasure-cronjob.yaml backup-cronjob.yaml backup-verify-job.yaml; do
  doc=$(printf '%s' "$ca_all" | awk -v src="# Source: openokr/templates/$workload" '
    $0 == src { on = 1; next } /^# Source:/ { on = 0 } on')
  if ! printf '%s' "$doc" | grep -A 1 "name: NODE_EXTRA_CA_CERTS" | grep -q "/etc/openokr/db-ca/global-bundle.pem" \
    || ! printf '%s' "$doc" | grep -q "name: PGSSLROOTCERT" \
    || ! printf '%s' "$doc" | grep -A 1 "name: db-ca" | grep -q "mountPath: /etc/openokr/db-ca\|configMap:"; then
    ca_ok=false
    echo "  ($workload has no CA bundle)" >&2
  fi
done
if $ca_ok; then
  pass "a named CA bundle reaches the server and every job"
else
  fail "a named CA bundle did not reach every workload"
fi

if ! printf '%s' "$defaults" | grep -q "NODE_EXTRA_CA_CERTS\|name: db-ca"; then
  pass "no CA bundle unless one is named"
else
  fail "a CA bundle appeared with none named"
fi

if render_expecting_failure --set "database.url=$DB" \
  --set database.caBundle.configMap=a --set database.caBundle.existingSecret=b \
  | grep -q "names both a Secret and a ConfigMap"; then
  pass "refuses a CA bundle named in two places"
else
  fail "accepted a CA bundle named in two places"
fi

# --- the owner role from the operator's own Secret (plan 0.8.0 H8) ---------
# adminUrl beside existingSecret read DATABASE_ADMIN_URL from a Secret the
# chart renders only without existingSecret, so the migration hook could not
# start unless the operator had made a Secret of exactly that name.
own_admin=$(render_one migration-job.yaml \
  --set database.existingSecret=my-db \
  --set database.existingSecretAdminKey=admin-url)
if echo "$own_admin" | grep -A 4 "name: DATABASE_ADMIN_URL" | grep -q "name: my-db" \
  && echo "$own_admin" | grep -A 4 "name: DATABASE_ADMIN_URL" | grep -q "key: admin-url" \
  && echo "$own_admin" | grep -q "name: OPENOKR_APP_ROLE"; then
  pass "reads the owner role from the operator's own Secret, by its key"
else
  fail "does not read the owner role from the operator's own Secret"
fi

if render_expecting_failure --set "database.url=$DB" \
  --set database.existingSecretAdminKey=admin-url \
  | grep -q "existingSecretAdminKey names a key"; then
  pass "refuses an admin key with no Secret to read it from"
else
  fail "accepted an admin key with no Secret to read it from"
fi

old_pair=$(notes --set database.existingSecret=my-db \
  --set database.adminUrl=postgres://owner:secret@db:5432/openokr)
new_pair=$(notes --set database.existingSecret=my-db \
  --set database.existingSecretAdminKey=admin-url)
if printf '%s' "$old_pair" | grep -q "WARNING: database.adminUrl is set beside" \
  && ! printf '%s' "$new_pair" | grep -q "WARNING: database.adminUrl"; then
  pass "warns about adminUrl beside existingSecret, and not about the key"
else
  fail "says nothing about adminUrl beside existingSecret"
fi

if render --set mail.transport=smtp 2>&1 | grep -q "mail.host is empty"; then
  pass "refuses the smtp transport with no host"
else
  fail "allowed an smtp transport with no host"
fi

if render --set instance.registration=sometimes 2>&1 \
  | grep -q "auto, open, company_domains or invite_only"; then
  pass "refuses an unrecognised registration policy"
else
  fail "accepted an unrecognised registration policy"
fi

# The application accepts every policy Admin > General offers, so the chart
# must not refuse one of them. It refused company_domains until 0.7.0.
for policy in auto open company_domains invite_only; do
  if render --set "instance.registration=$policy" 2>&1 \
    | grep -A1 "name: OPENOKR_REGISTRATION" | grep -q "value: \"$policy\""; then
    pass "accepts the $policy registration policy"
  else
    fail "refused the $policy registration policy"
  fi
done

# The metrics scrape token (plan 0.7.0 B3): generated beside the other two
# secrets, read by the pod, and optional so a release's own Secret without it
# still starts.
manifest=$(render)
if echo "$manifest" | grep -q "metrics-token:"; then
  pass "the chart generates a metrics scrape token"
else
  fail "the chart generates no metrics scrape token"
fi
if echo "$manifest" | grep -A6 "name: OPENOKR_METRICS_TOKEN" | grep -q "optional: true"; then
  pass "the pod reads the metrics token, and starts without it"
else
  fail "the pod does not read the metrics token as optional"
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

# --- how a pod stops (plan 0.8.0 H10b) ---------------------------------------
# docs/design/worker-deployment.md D9. A pause before SIGTERM, so the pod keeps
# answering while the endpoint change reaches whatever sends it traffic, the
# drain's bound in the pod, and a grace period derived from both plus 15
# seconds for the flushes, so the three cannot disagree.
stop_shape() {
  doc=$(render_one deployment.yaml "$@")
  pause=$(printf '%s\n' "$doc" | sed -n 's/.*command: \["sleep", "\([0-9]*\)"\].*/\1/p')
  grace=$(printf '%s\n' "$doc" | sed -n 's/^ *terminationGracePeriodSeconds: \([0-9]*\)$/\1/p')
  drain=$(printf '%s\n' "$doc" | grep -A 1 "name: OPENOKR_SHUTDOWN_SECONDS" \
    | sed -n 's/^ *value: "\([0-9]*\)"$/\1/p')
  echo "pause=${pause:-none} grace=${grace:-none} drain=${drain:-none}"
}

shape=$(stop_shape)
if [ "$shape" = "pause=10 grace=45 drain=20" ]; then
  pass "a pod pauses 10s before SIGTERM, drains for 20s and is killed only at 45s"
else
  fail "the default stop is not a 10s pause, a 20s drain and a 45s grace period ($shape)"
fi

shape=$(stop_shape --set shutdown.preStopSeconds=0)
if [ "$shape" = "pause=none grace=35 drain=20" ] \
  && ! render_one deployment.yaml --set shutdown.preStopSeconds=0 | grep -q "lifecycle:"; then
  pass "a pause of 0 removes the pre-stop hook and takes 10s off the grace period"
else
  fail "a pause of 0 did not remove the hook or shorten the grace period ($shape)"
fi

shape=$(stop_shape --set shutdown.drainSeconds=40)
if [ "$shape" = "pause=10 grace=65 drain=40" ]; then
  pass "a longer drain reaches the pod and lengthens the grace period with it"
else
  fail "a longer drain did not reach the pod and the grace period together ($shape)"
fi

# Values reused from 0.7.0 have no `shutdown` at all (helm upgrade
# --reuse-values), and must stop the way a fresh install does.
shape=$(stop_shape --set shutdown=null)
if [ "$shape" = "pause=10 grace=45 drain=20" ]; then
  pass "values reused from v0.7.0 stop the way a fresh install does"
else
  fail "values reused from v0.7.0 stop differently from a fresh install ($shape)"
fi

for bad in "shutdown.drainSeconds=0" "shutdown.drainSeconds=301" "shutdown.drainSeconds=2.5"; do
  if render_expecting_failure --set "database.url=$DB" --set "$bad" \
    | grep -q "shutdown.drainSeconds must be a whole number of seconds from 1 to 300"; then
    pass "refuses $bad, which the server would refuse at boot"
  else
    fail "accepted $bad, which the server refuses at boot"
  fi
done

if render_expecting_failure --set "database.url=$DB" --set shutdown.preStopSeconds=-1 \
  | grep -q "shutdown.preStopSeconds must be a whole number of seconds, 0 or more"; then
  pass "refuses a negative pause"
else
  fail "accepted a negative pause"
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

# --- backup verification Job (P8-T06d) ------------------------------------
if render --set backup.enabled=true --set backup.existingClaim=my-backups 2>&1 \
  | grep -q "backup-verify"; then
  pass "the verify Job renders when backups are enabled"
else
  fail "the verify Job does not render when backups are enabled"
fi

if render --set backup.enabled=true --set backup.existingClaim=my-backups 2>&1 \
  | grep -q 'helm.sh/hook.*test'; then
  pass "the verify Job is a helm test hook"
else
  fail "the verify Job is not a helm test hook"
fi

if echo "$defaults" | grep -q "backup-verify"; then
  fail "the verify Job renders when backups are disabled"
else
  pass "the verify Job does not render when backups are disabled"
fi

# The verify Job must mount the PVC read-only.
verify_job=$(render_one backup-verify-job.yaml --set backup.enabled=true \
  --set backup.existingClaim=my-backups 2>&1)
if printf '%s' "$verify_job" | grep -q "readOnly: true"; then
  pass "the verify Job mounts the backup PVC read-only"
else
  fail "the verify Job does not mount the backup PVC read-only"
fi

# --- the backup jobs read the Secrets the chart creates (H-19) --------------
# `check.sh` passed while every backup failed with `secret "okr-openokr" not
# found`: it rendered the CronJob and never asked whether the Secret it names
# is one the chart renders. This asks, for the CronJob and the verify Job.
backups=$(render --set backup.enabled=true --set backup.existingClaim=my-backups)
rendered_secrets=$(echo "$backups" | awk '/^kind: Secret/{s=1} s&&/^  name:/{print $2; s=0}' | sort -u)
for job in backup-cronjob.yaml backup-verify-job.yaml; do
  named=$(render_one "$job" --set backup.enabled=true --set backup.existingClaim=my-backups \
    | grep -A1 "secretKeyRef:" | awk '/name:/{print $2}' | sort -u)
  missing=""
  for secret in $named; do
    echo "$rendered_secrets" | grep -qx "$secret" || missing="$missing $secret"
  done
  if [ -z "$named" ]; then
    fail "$job names no Secret at all"
  elif [ -n "$missing" ]; then
    fail "$job names Secrets the chart does not create:$missing"
  else
    pass "$job reads only Secrets the chart creates"
  fi
done

# And the files: on the chart's own volume they are backed up with the database.
if render_one backup-cronjob.yaml --set backup.enabled=true | grep -q "blobs.tar.enc"; then
  pass "the backup takes the uploaded files from the chart's volume"
else
  fail "the backup leaves the uploaded files behind"
fi
if render_one backup-cronjob.yaml --set backup.enabled=true --set storage.s3.bucket=files \
  | grep -q "tar -C /storage"; then
  fail "the backup tries to archive files that live in object storage"
else
  pass "the backup leaves object storage to the bucket"
fi

# --- a release installed before a block existed ----------------------------
# `helm upgrade --reuse-values`, which the restore runbook uses, keeps the old
# release's values and does not merge in the defaults added since. A template
# that walks a path through a block the old values lack fails to render, and
# the upgrade fails before anything rolls out: the nightly Upgrade workflow
# caught exactly that with `scan` on 30 September 2026. Setting the block to
# null removes it the way an older release lacks it.
if render_one deployment.yaml --set scan=null | grep -q "^kind: Deployment"; then
  pass "a release from before the scan block still renders"
else
  fail "a release from before the scan block fails to render on upgrade"
fi
if render_one deployment.yaml --set scan.clamd.host=clamd \
  | grep -A1 "OPENOKR_CLAMD_PORT" | grep -q '"3310"'; then
  pass "a named clamd host is passed on with its port"
else
  fail "a named clamd host is not passed on with its port"
fi
if render_one deployment.yaml | grep -q "OPENOKR_CLAMD_HOST"; then
  fail "the scan is switched on although no clamd host is named"
else
  pass "no clamd host means no scan"
fi

# Error reports (docs/design/error-reporting.md D14, D22).
if render_one deployment.yaml | grep -q "OPENOKR_ERROR_DSN"; then
  fail "error reports are sent somewhere although no Secret is named"
else
  pass "no error Secret means no error reports leave"
fi
if render_one deployment.yaml --set errors=null | grep -q "^kind: Deployment"; then
  pass "a release from before the errors block still renders"
else
  fail "a release from before the errors block fails to render on upgrade"
fi
errors=$(render_one deployment.yaml --set errors.existingSecret=tracker \
  --set errors.environment=staging)
if echo "$errors" | grep -A3 "OPENOKR_ERROR_DSN" | grep -q "secretKeyRef" \
  && echo "$errors" | grep -A1 "OPENOKR_ERROR_ENVIRONMENT" | grep -q '"staging"'; then
  pass "a named error Secret gives the DSN by reference, with the environment"
else
  fail "a named error Secret does not reach the pod by reference"
fi

# --- whose address a request is counted under (trusted-proxies.md D15) -----
# Both empty renders neither variable, which keeps the application's default.
# A list reaches the pod joined by commas; both set, or a range that trusts
# every address, is refused before anything reaches the cluster.
if render_one deployment.yaml | grep -q "OPENOKR_TRUSTED_PROXIES\|OPENOKR_CLIENT_ADDRESS_HEADER"; then
  fail "a caller address setting rendered although none is set"
else
  pass "no trusted proxies and no header means neither variable"
fi
if render_one deployment.yaml --set 'network.trustedProxies={10.0.1.0/24,2606:4700::/32}' \
  | grep -A1 "name: OPENOKR_TRUSTED_PROXIES" | grep -q '"10.0.1.0/24,2606:4700::/32"'; then
  pass "a list of trusted proxies reaches the pod joined by commas"
else
  fail "a list of trusted proxies did not reach the pod joined by commas"
fi
if render_one deployment.yaml --set network.clientAddressHeader=cf-connecting-ip \
  | grep -A1 "name: OPENOKR_CLIENT_ADDRESS_HEADER" | grep -q '"cf-connecting-ip"'; then
  pass "a client address header reaches the pod"
else
  fail "a client address header did not reach the pod"
fi
if render_expecting_failure --set "database.url=$DB" \
  --set 'network.trustedProxies={10.0.1.0/24}' --set network.clientAddressHeader=cf-connecting-ip \
  | grep -q "network.trustedProxies and network.clientAddressHeader are both set"; then
  pass "refuses trusted proxies and a client address header together, naming both"
else
  fail "accepted trusted proxies and a client address header together"
fi
for everything in "0.0.0.0/0" "::/0"; do
  if render_expecting_failure --set "database.url=$DB" \
    --set "network.trustedProxies={10.0.1.0/24,$everything}" \
    | grep -q "trusts every address"; then
    pass "refuses $everything as a trusted proxy"
  else
    fail "accepted $everything as a trusted proxy"
  fi
done
if render_one deployment.yaml --set network=null | grep -q "^kind: Deployment"; then
  pass "a release from before the network block still renders"
else
  fail "a release from before the network block fails to render on upgrade"
fi

# --- the setups in PLAN.md section 5.2 -------------------------------------
if render_one deployment.yaml | grep -q "OPENOKR_CLOUD"; then
  fail "an ordinary install is told it is a cloud"
else
  pass "an ordinary install is not a cloud"
fi

cloud=$(render_one deployment.yaml --set cloud.enabled=true \
  --set cloud.defaultPlan=free --set instance.termsUrl=https://example.com/terms)
if echo "$cloud" | grep -q "OPENOKR_CLOUD$" \
  && echo "$cloud" | grep -q "OPENOKR_CLOUD_DEFAULT_PLAN" \
  && echo "$cloud" | grep -q "OPENOKR_TERMS_URL"; then
  pass "a cloud install names its flag, its default plan and its terms"
else
  fail "a cloud install lost a setting on the way to the pod"
fi

if render_one deployment.yaml --set cloud.defaultPlan=free \
  | grep -q "OPENOKR_CLOUD_DEFAULT_PLAN"; then
  fail "a default plan reached a pod with the cloud off"
else
  pass "plans mean nothing with the cloud off"
fi

extra=$(render_one deployment.yaml \
  --set-json 'extraEnvFrom=[{"secretRef":{"name":"providers"}}]' \
  --set-json 'extraEnv=[{"name":"OPENOKR_AI_PROVIDER","value":"anthropic"}]')
if echo "$extra" | grep -q "name: providers" \
  && echo "$extra" | grep -q "OPENOKR_AI_PROVIDER"; then
  pass "extra variables reach the pod, by value or from a Secret"
else
  fail "extra variables did not reach the pod"
fi

# --- erasure CronJob (docs/design/workspace-erasure.md §7) -----------------
if echo "$defaults" | grep -q "component: erasure"; then
  fail "the erasure CronJob renders with no schedule"
else
  pass "the erasure CronJob is off until a schedule is set"
fi

erase_job=$(render_one erasure-cronjob.yaml \
  --set cloud.erasure.schedule="30 3 * * *" \
  --set database.adminUrl=postgres://owner:secret@db:5432/openokr 2>&1)
if echo "$erase_job" | grep -q "cloud-erase.ts" \
  && echo "$erase_job" | grep -q -- "- --write" \
  && echo "$erase_job" | grep -q "name: DATABASE_ADMIN_URL" \
  && ! echo "$erase_job" | grep -q "secret@db"; then
  pass "the erasure CronJob runs with the owner role, from a Secret"
else
  fail "the erasure CronJob does not run with the owner role from a Secret"
fi

# The command loads the server's whole environment, and in production that
# refuses a missing auth secret. The chart gave the job the database and the
# encryption key but not this, so every scheduled run stopped before it read
# anything (plan 0.8.0 O3). By reference, never by value.
if echo "$erase_job" | grep -A 4 "name: BETTER_AUTH_SECRET" | grep -q "secretKeyRef"; then
  pass "the erasure CronJob gets the auth secret its command needs, from a Secret"
else
  fail "the erasure CronJob has no auth secret, so it stops before it starts"
fi

# --- data changes after install and upgrade (plan 0.8.0 H10c) ----------------
# docs/design/worker-deployment.md D17 and D18. A post-install, post-upgrade
# hook runs the data-change runner inside a budget that ends it between two
# batches, with the migration hook's environment and the auth secret its
# command needs, by reference (the lesson of O3).
dc_job=$(render_one data-change-job.yaml)
dc_command() {
  printf '%s\n' "$1" | sed -n '/^ *command:/,/^ *workingDir:/p' \
    | sed -n 's/^ *- //p' | tr -d '"' | tr '\n' ' ' | sed 's/ $//'
}
if printf '%s' "$dc_job" | grep -q "^  name: openokr-data-change-1$" \
  && printf '%s' "$dc_job" | grep -q '"helm.sh/hook": post-install,post-upgrade' \
  && printf '%s' "$dc_job" | grep -q "^  backoffLimit: 0$" \
  && printf '%s' "$dc_job" | grep -q "^  activeDeadlineSeconds: 360$"; then
  pass "a post-install and post-upgrade Job runs the data changes, once, with a backstop of 360s"
else
  fail "no data-change hook with one attempt and a 360s backstop"
fi
case "$(dc_command "$dc_job")" in
  *"/data-change.ts --max-seconds 240")
    pass "the hook runs the data changes inside a 240-second budget" ;;
  *) fail "the hook does not run data-change.ts --max-seconds 240 ($(dc_command "$dc_job"))" ;;
esac
dc_env_ok=true
for variable in DATABASE_URL OPENOKR_ENCRYPTION_KEY BETTER_AUTH_SECRET; do
  if ! printf '%s' "$dc_job" | grep -A 4 "name: $variable$" | grep -q "secretKeyRef"; then
    dc_env_ok=false
    echo "  (the data-change hook has no $variable from a Secret)" >&2
  fi
done
if $dc_env_ok && ! printf '%s' "$dc_job" | grep -q "secret@postgres"; then
  pass "the hook gets the database, the encryption key and the auth secret, each by reference"
else
  fail "the hook lacks a variable its command needs, or carries one by value"
fi

if render_one data-change-job.yaml --set dataChanges.enabled=false 2>&1 | grep -q "kind: Job"; then
  fail "the data-change hook renders although it is turned off"
else
  pass "dataChanges.enabled=false renders no hook"
fi
if render_one data-change-job.yaml --set dataChanges=null | grep -q "^  name: openokr-data-change-1$"; then
  pass "values reused from v0.7.0 run the data-change hook, as a fresh install does"
else
  fail "values reused from v0.7.0 lost the data-change hook"
fi
unbounded=$(render_one data-change-job.yaml --set dataChanges.timeBudgetSeconds=0)
if [ "$(dc_command "$unbounded")" = "node --experimental-strip-types --no-warnings ./migrator/packages/db/src/bin/data-change.ts" ] \
  && ! printf '%s' "$unbounded" | grep -q "activeDeadlineSeconds"; then
  pass "a budget of 0 runs to the end, with no flag and no deadline"
else
  fail "a budget of 0 still bounds the hook"
fi
if render_expecting_failure --set "database.url=$DB" --set dataChanges.timeBudgetSeconds=-1 \
  | grep -q "dataChanges.timeBudgetSeconds must be a whole number of seconds, 0 or more"; then
  pass "refuses a negative data-change budget"
else
  fail "accepted a negative data-change budget"
fi

dc_notes=$(notes)
if printf '%s' "$dc_notes" | grep -q "Data changes run after each install and upgrade" \
  && printf '%s' "$dc_notes" | grep -q "exec deploy/openokr -- node"; then
  pass "the install notes say the data changes run, and how to finish them by hand"
else
  fail "the install notes do not say how the data changes run"
fi
if notes --set dataChanges.enabled=false | grep -q "nothing runs the data changes"; then
  pass "the install notes say so when nothing runs the data changes"
else
  fail "the install notes are silent when nothing runs the data changes"
fi

# --- values reused from an older release -------------------------------------
# `helm upgrade --reuse-values` keeps the old release's values and adds nothing
# from the new chart, so every key a newer release introduced is missing. A
# template that reads such a key without a default fails the upgrade (it did
# for `cloud` in 0.6 and `secrets.metricsTokenKey` in 0.7). Setting a key to
# null makes Helm delete it, which is the same shape.
#
# For each earlier release this finds the keys present in values.yaml and
# absent from that release's values.yaml, then renders with all of them
# deleted at once. A key that no template reads costs nothing, so the check
# needs no list of its own to keep current.
#
# Reads only the key structure: mappings by indentation, ignoring comments,
# list items and anything nested under a list item. Reports the shallowest
# missing key, because that is what an older release lacks entirely.
missing_keys() {
  python3 -I -c '
import re, subprocess, sys

def paths(text):
    found, stack, skip = set(), [], None
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        indent = len(line) - len(line.lstrip())
        if skip is not None:
            if indent > skip:
                continue
            skip = None
        if line.lstrip().startswith("-"):
            skip = indent
            continue
        m = re.match(r"^\s*([A-Za-z0-9_-]+):", line)
        if not m:
            continue
        while stack and stack[-1][0] >= indent:
            stack.pop()
        stack.append((indent, m.group(1)))
        found.add(".".join(k for _, k in stack))
    return found

old = subprocess.run(["git", "show", sys.argv[1] + ":deploy/helm/values.yaml"],
                     capture_output=True, text=True)
if old.returncode != 0:
    sys.exit(3)
new = paths(open("values.yaml").read())
gone = new - paths(old.stdout)
# Keep a key only when its parent exists in the old release.
for p in sorted(gone):
    if "." not in p or p.rsplit(".", 1)[0] not in gone:
        print(p)
' "$1"
}

previous=$(git describe --tags --abbrev=0 --match 'v[0-9]*' --exclude '*-*' 2>/dev/null || true)
for tag in $(printf '%s\n' "v0.5.0" "$previous" | sort -u | grep .); do
  status=0
  keys=$(missing_keys "$tag") || status=$?
  if [ "$status" -ne 0 ]; then
    # In CI a missing tag means the checkout is shallow and the check would
    # silently test nothing, so it fails there. Locally it is skipped.
    if [ -n "${CI:-}" ]; then
      fail "values reused from $tag: tag not available in this checkout (CI needs full history, fetch-depth: 0)"
    else
      echo "  skip  values reused from $tag (tag not available in this checkout)"
    fi
    continue
  fi
  if [ -z "$keys" ]; then
    pass "no values added since $tag"
    continue
  fi
  nulled=""
  for key in $keys; do
    nulled="$nulled --set $key=null"
  done
  echo "  keys missing from $tag values, set to null: $(echo $keys)"
  # shellcheck disable=SC2086
  if render $nulled >/dev/null 2>&1; then
    pass "renders with every value added since $tag missing (helm upgrade --reuse-values)"
  else
    fail "does not render with values added since $tag missing; first error:"
    # shellcheck disable=SC2086
    render $nulled | head -5 >&2
  fi
done

echo ""
if [ "$FAILURES" -gt 0 ]; then
  echo "openokr: $FAILURES chart check(s) failed." >&2
  exit 1
fi
echo "openokr: all chart checks passed."
