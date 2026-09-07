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

echo ""
echo "openokr: the chart installs, serves, registers a user and upgrades cleanly."
