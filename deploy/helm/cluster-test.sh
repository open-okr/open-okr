#!/bin/sh
# Installs the chart into a real cluster and uses the result (P1-T10).
#
# The acceptance criterion is "given a cluster and a database, when the chart
# installs, then the skeleton serves and a user can register". That is a claim
# about a running deployment, so it is checked by making one.
#
# Expects a kind cluster with the image already loaded, and kubectl and helm on
# the path:
#
#     kind create cluster
#     kind load docker-image openokr:ci
#     OPENOKR_IMAGE_TAG=ci sh deploy/helm/cluster-test.sh
set -eu

cd "$(dirname "$0")"

: "${OPENOKR_IMAGE_REPO:=openokr}"
: "${OPENOKR_IMAGE_TAG:=ci}"
: "${NAMESPACE:=openokr-test}"
RELEASE=okr

pass() { echo "  ok    $1"; }
fail() { echo "  FAIL  $1" >&2; exit 1; }

dump() {
  echo "--- helm status -----------------------------------------------" >&2
  helm status "$RELEASE" -n "$NAMESPACE" 2>&1 | tail -30 >&2 || true
  echo "--- pods ------------------------------------------------------" >&2
  kubectl get pods -n "$NAMESPACE" -o wide 2>&1 >&2 || true
  echo "--- events ----------------------------------------------------" >&2
  kubectl get events -n "$NAMESPACE" --sort-by=.lastTimestamp 2>&1 | tail -25 >&2 || true
  echo "--- migration job ---------------------------------------------" >&2
  kubectl logs -n "$NAMESPACE" -l app.kubernetes.io/component=migration --tail=40 2>&1 >&2 || true
  echo "--- app -------------------------------------------------------" >&2
  kubectl logs -n "$NAMESPACE" -l app.kubernetes.io/name=openokr --tail=40 2>&1 >&2 || true
  echo "--- request loop ----------------------------------------------" >&2
  kubectl logs -n "$NAMESPACE" pod/probe-loop --tail=10 2>&1 >&2 || true
  echo "---------------------------------------------------------------" >&2
}

cleanup() {
  status=$?
  # Evidence before teardown. A test that deletes its own namespace on failure
  # leaves whoever reads the CI output with nothing to go on.
  [ "$status" -ne 0 ] && dump
  if [ -n "${PORT_FORWARD_PID:-}" ]; then
    kill "$PORT_FORWARD_PID" 2>/dev/null || true
  fi
  return 0
}
trap cleanup EXIT

echo "openokr: installing into a real cluster"

# From nothing. Reusing a namespace means reusing its database, and then
# "migrations ran" cannot be told apart from "migrations ran last time".
if kubectl get namespace "$NAMESPACE" >/dev/null 2>&1; then
  echo "openokr: removing the previous test namespace"
  kubectl delete namespace "$NAMESPACE" --wait --timeout=180s >/dev/null 2>&1 || true
fi
kubectl create namespace "$NAMESPACE" >/dev/null

# A Postgres for the test. Deliberately not part of the chart: the chart
# requires an external database, and this stands in for the operator's.
kubectl apply -n "$NAMESPACE" -f - >/dev/null <<'YAML'
apiVersion: v1
kind: Service
metadata:
  name: postgres
spec:
  ports:
    - port: 5432
  selector:
    app: postgres
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgres
spec:
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
        - name: postgres
          image: postgres:17-alpine
          env:
            - name: POSTGRES_USER
              value: openokr
            - name: POSTGRES_PASSWORD
              value: test-only-password
            - name: POSTGRES_DB
              value: openokr
            - name: PGDATA
              value: /var/lib/postgresql/data/pgdata
          ports:
            - containerPort: 5432
          readinessProbe:
            exec:
              command: ["pg_isready", "-U", "openokr", "-d", "openokr"]
            initialDelaySeconds: 5
            periodSeconds: 3
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
      volumes:
        - name: data
          emptyDir: {}
YAML

kubectl wait -n "$NAMESPACE" --for=condition=available deployment/postgres --timeout=180s >/dev/null \
  || fail "the test database never became available"
pass "a database is running"

# --- install --------------------------------------------------------------
# --wait makes helm block until the hook and the pods are ready, so a failure
# here is a real failure rather than a race with the next command.
#
# Two replicas with persistence off, which is not the shipped default any more
# and is deliberate here: this test is about the migration hook running once for
# several pods and about a rolling upgrade, and neither needs a volume. The
# defaults pin the release to one replica, because a ReadWriteOnce claim cannot
# be shared, and one replica would prove nothing about the hook. check.sh is
# where the default storage combination is asserted.
helm install "$RELEASE" . \
  --namespace "$NAMESPACE" \
  --set "image.repository=$OPENOKR_IMAGE_REPO" \
  --set "image.tag=$OPENOKR_IMAGE_TAG" \
  --set image.pullPolicy=Never \
  --set "database.url=postgres://openokr:test-only-password@postgres:5432/openokr" \
  --set replicaCount=2 \
  --set persistence.enabled=false \
  --wait --timeout 5m >/dev/null \
  || fail "helm install did not complete"
pass "the chart installed and every pod became ready"

# --- the migration hook ran ----------------------------------------------
# The count is not pinned: a new migration should not break this test. What
# matters is that the hook applied a schema to an empty database rather than
# finding one already there, which the fresh namespace above guarantees.
kubectl logs -n "$NAMESPACE" -l app.kubernetes.io/component=migration --tail=50 2>/dev/null \
  | grep -qE "applied [0-9]+ migration" \
  || fail "the migration hook did not apply the schema"
pass "the migration hook applied the schema before the pods started"

# Two replicas, one schema: proof the hook is what migrates rather than the
# pods racing for the advisory lock.
kubectl logs -n "$NAMESPACE" -l app.kubernetes.io/name=openokr --tail=50 2>/dev/null \
  | grep -q "running migrations" \
  && fail "an application pod ran migrations; the hook should be the only one"
pass "no application pod ran migrations"

ready=$(kubectl get deployment "$RELEASE-openokr" -n "$NAMESPACE" \
  -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo 0)
[ "$ready" = "2" ] || fail "expected 2 ready replicas, got '$ready'"
pass "both replicas are serving"

# --- it serves, and somebody can register --------------------------------
kubectl port-forward -n "$NAMESPACE" "svc/$RELEASE-openokr" 18080:80 >/dev/null 2>&1 &
PORT_FORWARD_PID=$!

waited=0
until curl -sf -o /dev/null "http://127.0.0.1:18080/api/health" 2>/dev/null; do
  waited=$((waited + 2))
  [ "$waited" -lt 60 ] || fail "the service never answered through a port-forward"
  sleep 2
done
pass "the readiness endpoint answers"

location=$(curl -s -o /dev/null -w '%{redirect_url}' "http://127.0.0.1:18080/sign-in")
case "$location" in
  */setup) pass "a fresh install leads to the first-run wizard" ;;
  *) fail "expected a redirect to /setup, got '$location'" ;;
esac

curl -sL "http://127.0.0.1:18080/setup" | grep -q "PostgreSQL" \
  || fail "the wizard did not reach the database"
pass "the wizard reached the database"

code=$(curl -s -o /dev/null -w '%{http_code}' \
  -X POST "http://127.0.0.1:18080/api/auth/sign-up/email" \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"correct-horse-battery-staple","name":"Grace Hopper"}')
[ "$code" = "200" ] || fail "registration returned $code"
pass "a user can register"

# --- upgrade -------------------------------------------------------------
# The property that matters for a customer: an upgrade re-runs the hook, finds
# nothing to do, and does not rotate the keys underneath their stored data.
before=$(kubectl get secret "$RELEASE-openokr-secrets" -n "$NAMESPACE" \
  -o jsonpath='{.data.encryption-key}')

helm upgrade "$RELEASE" . \
  --namespace "$NAMESPACE" \
  --set "image.repository=$OPENOKR_IMAGE_REPO" \
  --set "image.tag=$OPENOKR_IMAGE_TAG" \
  --set image.pullPolicy=Never \
  --set "database.url=postgres://openokr:test-only-password@postgres:5432/openokr" \
  --set replicaCount=2 \
  --set persistence.enabled=false \
  --wait --timeout 5m >/dev/null \
  || fail "helm upgrade did not complete"
pass "the chart upgraded"

after=$(kubectl get secret "$RELEASE-openokr-secrets" -n "$NAMESPACE" \
  -o jsonpath='{.data.encryption-key}')
[ "$before" = "$after" ] \
  || fail "the upgrade rotated the encryption key, which would orphan every stored credential"
pass "the upgrade kept the encryption key"

kubectl logs -n "$NAMESPACE" -l app.kubernetes.io/component=migration --tail=50 2>/dev/null \
  | grep -q "schema is up to date" \
  || fail "the second migration run did not report the schema as current"
pass "re-running migrations is idempotent"

# --- a replica stops without failing a request (plan 0.8.0 H10b) ------------
# docs/design/worker-deployment.md D9. A client inside the cluster asks the
# Service for /api/health every 100 milliseconds, each time on a new
# connection, which is what kube-proxy routes, while one of the two replicas is
# deleted. The pre-stop pause keeps the deleted pod answering until the
# endpoint change has reached kube-proxy, and the drain lets what it already
# took finish, so nothing fails. Without the pause, the requests that arrive
# in the second after SIGTERM are refused. The image is the one under test,
# because it is already loaded and carries Node.
PROBE_SCRIPT='
const http = require("node:http");
const until = Date.now() + 45000;
const failures = [];
let sent = 0;
const once = () =>
  new Promise((done) => {
    const request = http.get(
      { host: process.env.TARGET, port: 80, path: "/api/health", agent: false, timeout: 5000 },
      (response) => {
        response.resume();
        if (response.statusCode !== 200) failures.push(`status ${response.statusCode}`);
        response.on("end", done);
        response.on("error", (error) => { failures.push(error.code || error.message); done(); });
      },
    );
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", (error) => { failures.push(error.code || error.message); done(); });
  });
(async () => {
  const pending = [];
  while (Date.now() < until) {
    sent += 1;
    pending.push(once());
    await new Promise((wait) => setTimeout(wait, 100));
  }
  await Promise.all(pending);
  console.log(`probe: sent ${sent}, failed ${failures.length}${failures.length ? ": " + failures.slice(0, 5).join(", ") : ""}`);
})();
'
kubectl run probe-loop -n "$NAMESPACE" --restart=Never \
  --image="$OPENOKR_IMAGE_REPO:$OPENOKR_IMAGE_TAG" --image-pull-policy=Never \
  --env="TARGET=$RELEASE-openokr" \
  --command -- node -e "$PROBE_SCRIPT" >/dev/null \
  || fail "the request loop could not be started"
kubectl wait -n "$NAMESPACE" --for=condition=Ready pod/probe-loop --timeout=120s >/dev/null \
  || fail "the request loop never started"

# A few seconds of requests against both replicas first. The web pods are the
# ones with the release's labels and no component: the hook Jobs' pods carry
# one.
sleep 5
victim=$(kubectl get pods -n "$NAMESPACE" \
  -l "app.kubernetes.io/name=openokr,app.kubernetes.io/instance=$RELEASE,!app.kubernetes.io/component" \
  --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}')
[ -n "$victim" ] || fail "found no serving replica to delete"
kubectl delete pod -n "$NAMESPACE" "$victim" --wait=false >/dev/null
echo "openokr: deleted $victim under a request every 100ms"

waited=0
while :; do
  phase=$(kubectl get pod probe-loop -n "$NAMESPACE" -o jsonpath='{.status.phase}' 2>/dev/null || true)
  case "$phase" in Succeeded | Failed) break ;; esac
  waited=$((waited + 2))
  [ "$waited" -lt 120 ] || fail "the request loop did not finish"
  sleep 2
done
probe=$(kubectl logs -n "$NAMESPACE" pod/probe-loop 2>&1 | grep "^probe:" || true)
sent=$(printf '%s' "$probe" | sed -n 's/^probe: sent \([0-9]*\), .*/\1/p')
case "$probe" in
  "probe: sent "*", failed 0")
    [ "${sent:-0}" -ge 100 ] || fail "the request loop sent only ${sent:-no} requests"
    pass "a replica was deleted under $sent requests and none of them failed"
    ;;
  *) fail "requests failed while a replica stopped: ${probe:-the loop printed nothing}" ;;
esac
kubectl delete pod probe-loop -n "$NAMESPACE" --wait=false >/dev/null 2>&1 || true

kubectl rollout status -n "$NAMESPACE" "deployment/$RELEASE-openokr" --timeout=180s >/dev/null \
  || fail "the deleted replica was not replaced"
pass "the deleted replica was replaced"

# --- a backup runs, and verifies (completeness review H-19) ---------------
# With backups enabled the CronJob failed at once, `secret "okr-openokr" not
# found`, and `check.sh` passed because it only rendered. This runs one: a
# volume for the backups, the CronJob's own template as a Job, then the verify
# Job through `helm test`, which restores the newest backup into a scratch
# database and checks every workspace.
kubectl apply -n "$NAMESPACE" -f - >/dev/null <<'YAML'
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: okr-backups
spec:
  accessModes: ["ReadWriteOnce"]
  resources:
    requests:
      storage: 1Gi
YAML

helm upgrade "$RELEASE" . \
  --namespace "$NAMESPACE" \
  --reuse-values \
  --set backup.enabled=true \
  --set backup.existingClaim=okr-backups \
  --wait --timeout 5m >/dev/null \
  || fail "enabling backups did not upgrade cleanly"

kubectl create job -n "$NAMESPACE" --from="cronjob/$RELEASE-openokr-backup" backup-drill >/dev/null \
  || fail "the backup CronJob could not be run as a Job"
if ! kubectl wait -n "$NAMESPACE" --for=condition=complete job/backup-drill --timeout=300s >/dev/null; then
  kubectl logs -n "$NAMESPACE" job/backup-drill --tail=40 >&2 || true
  fail "the backup did not complete"
fi
pass "a backup ran against the chart's own Secrets"

if ! helm test "$RELEASE" --namespace "$NAMESPACE" --timeout 5m >/dev/null 2>&1; then
  kubectl logs -n "$NAMESPACE" -l app.kubernetes.io/component=backup-verify --tail=40 >&2 || true
  fail "the backup did not verify"
fi
pass "the backup restored into a scratch database and verified"

echo ""
echo "openokr: the chart installs, serves, registers a user, upgrades, and backs up cleanly."
