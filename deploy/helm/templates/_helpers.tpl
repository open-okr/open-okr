{{/*
Naming, labels, and the two pieces of logic worth stating once: how secrets
survive an upgrade, and how the database URL is resolved.
*/}}

{{- define "openokr.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "openokr.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "openokr.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "openokr.labels" -}}
helm.sh/chart: {{ include "openokr.chart" . }}
{{ include "openokr.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: openokr
{{- end -}}

{{- define "openokr.selectorLabels" -}}
app.kubernetes.io/name: {{ include "openokr.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "openokr.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "openokr.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "openokr.secretName" -}}
{{- if .Values.secrets.existingSecret -}}
{{- .Values.secrets.existingSecret -}}
{{- else -}}
{{- printf "%s-secrets" (include "openokr.fullname" .) -}}
{{- end -}}
{{- end -}}

{{/*
A generated secret that survives an upgrade.

`lookup` reads the Secret already in the cluster, so an upgrade re-emits the
value that is there rather than a new one. Rotating OPENOKR_ENCRYPTION_KEY on
every `helm upgrade` would make every stored credential unreadable, and
rotating BETTER_AUTH_SECRET would sign out every user. Both would look like
the chart working.

`lookup` returns nothing during `helm template` and on a dry run, so those
render a fresh value. That is correct for rendering and never reaches a
cluster.

The caller supplies the fresh value, because the two keys are not the same
shape. `OPENOKR_ENCRYPTION_KEY` must itself be base64 of exactly 32 bytes:
the application refuses anything else at boot, which is how the first version
of this template was caught generating a 32-character string that decoded to
24 bytes.

Call with a dict: (dict "ctx" $ "key" "encryption-key" "value" (randBytes 32))
*/}}
{{- define "openokr.keepSecret" -}}
{{- $ctx := .ctx -}}
{{- $name := printf "%s-secrets" (include "openokr.fullname" $ctx) -}}
{{- $existing := lookup "v1" "Secret" $ctx.Release.Namespace $name -}}
{{- /* A key can be nil when values reused from an older release lack the setting that names it. */ -}}
{{- if and $existing .key (index $existing.data .key) -}}
{{- index $existing.data .key -}}
{{- else -}}
{{- .value | b64enc -}}
{{- end -}}
{{- end -}}

{{/*
The address people actually use.

Passkeys are bound to their origin, so getting this wrong does not degrade
gracefully: credentials registered against the wrong origin cannot be used
from the right one. Falls back to the first ingress host, then to the service
inside the cluster, which is right for a smoke test and obviously wrong for
production, where the ingress supplies it.
*/}}
{{- define "openokr.publicUrl" -}}
{{- if .Values.publicUrl -}}
{{- .Values.publicUrl -}}
{{- else if and .Values.ingress.enabled .Values.ingress.hosts -}}
{{- $host := (first .Values.ingress.hosts).host -}}
{{- if .Values.ingress.tls -}}
{{- printf "https://%s" $host -}}
{{- else -}}
{{- printf "http://%s" $host -}}
{{- end -}}
{{- else -}}
{{- printf "http://%s.%s.svc.cluster.local" (include "openokr.fullname" .) .Release.Namespace -}}
{{- end -}}
{{- end -}}

{{/*
The database environment variable, from a Secret either way.

A URL passed through values still ends up in a Secret rather than the pod
spec, so it does not sit in `kubectl describe pod` output. `existingSecret`
is better still, because a value passed to Helm is stored in the release.
*/}}
{{- define "openokr.databaseEnv" -}}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      {{- if .Values.database.existingSecret }}
      name: {{ .Values.database.existingSecret }}
      key: {{ .Values.database.existingSecretKey }}
      {{- else }}
      name: {{ printf "%s-database" (include "openokr.fullname" .) }}
      key: database-url
      {{- end }}
{{- end -}}

{{/*
Everything the application and the migration hook both need.
*/}}
{{/*
Whether an owner-role connection is configured: from values (adminUrl), or a
key in the operator's own Secret (existingSecretAdminKey, plan 0.8.0 H8).
`dig` because a release from before 0.8 reuses values without the new key.
*/}}
{{- define "openokr.adminEnabled" -}}
{{- $db := .Values.database -}}
{{- if or $db.adminUrl (and $db.existingSecret (dig "existingSecretAdminKey" "" $db)) -}}true{{- end -}}
{{- end -}}

{{/*
The database's CA bundle (plan 0.8.0 H6). A managed Postgres (RDS, Cloud SQL,
Azure) signs its certificate with an authority Node's own store does not hold,
so `sslmode=verify-full` failed and the only working choice was `no-verify`:
encrypted, unchecked. With a bundle named, every workload mounts it and points
Node (NODE_EXTRA_CA_CERTS) and libpq, which the backup jobs' pg_dump and
pg_restore use (PGSSLROOTCERT), at it. `dig` because a release from before 0.8
reuses values without `caBundle`.
*/}}
{{- define "openokr.dbCa" -}}
{{- if or (dig "caBundle" "existingSecret" "" .Values.database) (dig "caBundle" "configMap" "" .Values.database) -}}true{{- end -}}
{{- end -}}

{{- define "openokr.dbCaPath" -}}
/etc/openokr/db-ca/{{ dig "caBundle" "key" "ca.pem" .Values.database | default "ca.pem" }}
{{- end -}}

{{- define "openokr.dbCaEnv" -}}
{{- if include "openokr.dbCa" . -}}
- name: NODE_EXTRA_CA_CERTS
  value: {{ include "openokr.dbCaPath" . | quote }}
- name: PGSSLROOTCERT
  value: {{ include "openokr.dbCaPath" . | quote }}
{{- end -}}
{{- end -}}

{{- define "openokr.dbCaMount" -}}
{{- if include "openokr.dbCa" . -}}
- name: db-ca
  mountPath: /etc/openokr/db-ca
  readOnly: true
{{- end -}}
{{- end -}}

{{- define "openokr.dbCaVolume" -}}
{{- if include "openokr.dbCa" . -}}
- name: db-ca
  {{- with dig "caBundle" "existingSecret" "" .Values.database }}
  secret:
    secretName: {{ . }}
  {{- else }}
  configMap:
    name: {{ dig "caBundle" "configMap" "" .Values.database }}
  {{- end }}
{{- end -}}
{{- end -}}

{{/*
How a pod stops (plan 0.8.0 H10b, docs/design/worker-deployment.md D9): a
pause before SIGTERM, the server's drain, and a grace period derived from
both. `dig` with the values.yaml defaults, because a release from before 0.8
reuses values without `shutdown`; never `| default` on a number, which would
read a pause of 0 as unset and put the pause back.
*/}}
{{- define "openokr.preStopSeconds" -}}
{{- dig "preStopSeconds" 10 (.Values.shutdown | default dict) | int -}}
{{- end -}}

{{- define "openokr.drainSeconds" -}}
{{- dig "drainSeconds" 20 (.Values.shutdown | default dict) | int -}}
{{- end -}}

{{/*
The pause, the drain, and 15 seconds for the error flush (2 s), the span
flush (5 s) and slack. Kubernetes counts the grace period from the deletion,
pause included, and kills the pod when it ends.
*/}}
{{- define "openokr.terminationGraceSeconds" -}}
{{- add (include "openokr.preStopSeconds" . | int) (include "openokr.drainSeconds" . | int) 15 -}}
{{- end -}}

{{- define "openokr.commonEnv" -}}
{{ include "openokr.databaseEnv" . }}
{{- if include "openokr.adminEnabled" . }}
- name: DATABASE_ADMIN_URL
  valueFrom:
    secretKeyRef:
      {{- if and .Values.database.existingSecret (dig "existingSecretAdminKey" "" .Values.database) }}
      name: {{ .Values.database.existingSecret }}
      key: {{ .Values.database.existingSecretAdminKey }}
      {{- else }}
      name: {{ printf "%s-database" (include "openokr.fullname" .) }}
      key: database-admin-url
      {{- end }}
{{- end }}
- name: OPENOKR_ENCRYPTION_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "openokr.secretName" . }}
      key: {{ .Values.secrets.encryptionKeyKey }}
- name: NODE_ENV
  value: production
{{- with (include "openokr.dbCaEnv" .) }}
{{ . }}
{{- end }}
{{- end -}}

{{/*
The server's environment, for the web Deployment and the worker alike (plan
0.8.0 H10e, docs/design/worker-deployment.md D12). Only OPENOKR_RELAY and
OPENOKR_SCHEDULER differ, and each Deployment adds those itself. One list, so
a variable added for one cannot be forgotten in the other, which is how the
erasure job lost the auth secret (plan 0.8.0 O3). check.sh compares the two.
*/}}
{{- define "openokr.serverEnv" -}}
{{- /* `cloud` is absent from values reused from a release older than 0.6 (helm upgrade --reuse-values). */ -}}
{{- $cloud := .Values.cloud | default dict -}}
{{ include "openokr.commonEnv" . }}
# Migrations run in the pre-install and pre-upgrade hook, not here.
# Without this every replica would race to migrate on every restart;
# the advisory lock makes that safe but not fast, and a rollout
# should not depend on it.
- name: OPENOKR_SKIP_MIGRATIONS
  value: "1"
# How long the server may finish its work in flight once SIGTERM
# arrives. The pod's grace period is derived from it.
- name: OPENOKR_SHUTDOWN_SECONDS
  value: {{ include "openokr.drainSeconds" . | quote }}
- name: BETTER_AUTH_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ include "openokr.secretName" . }}
      key: {{ .Values.secrets.authSecretKey }}
- name: BETTER_AUTH_URL
  value: {{ include "openokr.publicUrl" . | quote }}
# Optional, so a release with its own Secret and no metrics key
# still starts (plan 0.7.0 B3).
- name: OPENOKR_METRICS_TOKEN
  valueFrom:
    secretKeyRef:
      name: {{ include "openokr.secretName" . }}
      {{- /* Absent from values reused from a release older than 0.7 (helm upgrade --reuse-values). */}}
      key: {{ .Values.secrets.metricsTokenKey | default "metrics-token" }}
      optional: true
- name: OPENOKR_INSTANCE_NAME
  value: {{ .Values.instance.name | quote }}
- name: OPENOKR_DEFAULT_LANGUAGE
  value: {{ .Values.instance.language | quote }}
- name: OPENOKR_TELEMETRY
  value: {{ .Values.instance.telemetry | quote }}
- name: OPENOKR_REGISTRATION
  value: {{ .Values.instance.registration | quote }}
{{- with .Values.instance.sourceUrl }}
- name: OPENOKR_SOURCE_URL
  value: {{ . | quote }}
{{- end }}
{{- with .Values.instance.termsUrl }}
- name: OPENOKR_TERMS_URL
  value: {{ . | quote }}
{{- end }}
{{- with .Values.instance.privacyUrl }}
- name: OPENOKR_PRIVACY_URL
  value: {{ . | quote }}
{{- end }}
{{- with .Values.instance.supportEmail }}
- name: OPENOKR_SUPPORT_EMAIL
  value: {{ . | quote }}
{{- end }}
{{- if $cloud.enabled }}
- name: OPENOKR_CLOUD
  value: "true"
{{- with $cloud.region }}
- name: OPENOKR_CLOUD_REGION
  value: {{ . | quote }}
{{- end }}
{{- with $cloud.plans }}
- name: OPENOKR_CLOUD_PLANS
  value: {{ . | quote }}
{{- end }}
{{- with $cloud.defaultPlan }}
- name: OPENOKR_CLOUD_DEFAULT_PLAN
  value: {{ . | quote }}
{{- end }}
{{- end }}
{{- /* Whose address a request is counted under
       (docs/design/trusted-proxies.md D15). Absent unless set, so
       the application keeps its default. `default dict` for the
       reason the scan block below gives. */}}
{{- $network := .Values.network | default dict }}
{{- with $network.trustedProxies }}
- name: OPENOKR_TRUSTED_PROXIES
  value: {{ join "," . | quote }}
{{- end }}
{{- with $network.clientAddressHeader }}
- name: OPENOKR_CLIENT_ADDRESS_HEADER
  value: {{ . | quote }}
{{- end }}
{{- with .Values.extraEnv }}
{{- toYaml . | nindent 0 }}
{{- end }}
- name: OPENOKR_MAIL_TRANSPORT
  value: {{ .Values.mail.transport | quote }}
{{- if eq .Values.mail.transport "smtp" }}
- name: OPENOKR_MAIL_HOST
  value: {{ .Values.mail.host | quote }}
- name: OPENOKR_MAIL_PORT
  value: {{ .Values.mail.port | quote }}
- name: OPENOKR_MAIL_SECURE
  value: {{ .Values.mail.secure | quote }}
- name: OPENOKR_MAIL_USER
  value: {{ .Values.mail.user | quote }}
- name: OPENOKR_MAIL_FROM
  value: {{ .Values.mail.from | quote }}
{{- if .Values.mail.existingSecret }}
- name: OPENOKR_MAIL_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ .Values.mail.existingSecret }}
      key: {{ .Values.mail.existingSecretKey }}
{{- end }}
{{- end }}
# OPENOKR_STORAGE_ROOT, not OPENOKR_STORAGE_DIR. The chart set the
# second name from P1-T10 until P6-G05 and nothing in the product
# has ever read it: the schema declares ROOT. It happened to work,
# because ROOT defaults to the relative path `storage` and the image
# runs from /app, so it resolved to the mount by coincidence. A
# variable nobody reads plus a coincidence is not a configuration.
- name: OPENOKR_STORAGE_ROOT
  value: /app/storage
{{- if .Values.storage.s3.bucket }}
# Naming a bucket switches the driver (P6-G05). The local-disk
# volume above stays mounted and unused, which costs nothing and
# means turning S3 off again does not need a new claim.
- name: OPENOKR_STORAGE_S3_BUCKET
  value: {{ .Values.storage.s3.bucket | quote }}
- name: OPENOKR_STORAGE_S3_REGION
  value: {{ .Values.storage.s3.region | quote }}
{{- with .Values.storage.s3.endpoint }}
- name: OPENOKR_STORAGE_S3_ENDPOINT
  value: {{ . | quote }}
{{- end }}
{{- with .Values.storage.s3.keyPrefix }}
- name: OPENOKR_STORAGE_S3_KEY_PREFIX
  value: {{ . | quote }}
{{- end }}
{{- if .Values.storage.s3.forcePathStyle }}
- name: OPENOKR_STORAGE_S3_FORCE_PATH_STYLE
  value: {{ .Values.storage.s3.forcePathStyle | quote }}
{{- end }}
# Credentials come from a Secret and never from values, so they do
# not land in the release's stored values where `helm get values`
# would read them back. Same rule as database.existingSecret.
# With no Secret, nothing is set and the AWS SDK finds the pod's
# own credentials: workload identity (plan 0.8.0 H9).
{{- if .Values.storage.s3.existingSecret }}
- name: OPENOKR_STORAGE_S3_ACCESS_KEY_ID
  valueFrom:
    secretKeyRef:
      name: {{ .Values.storage.s3.existingSecret }}
      key: {{ .Values.storage.s3.accessKeyIdKey }}
- name: OPENOKR_STORAGE_S3_SECRET_ACCESS_KEY
  valueFrom:
    secretKeyRef:
      name: {{ .Values.storage.s3.existingSecret }}
      key: {{ .Values.storage.s3.secretAccessKeyKey }}
{{- end }}
{{- end }}
{{- /* The optional virus scan. Absent unless a host is named.
       Read through `default dict` rather than as a path: a
       release installed before this block existed and upgraded
       with --reuse-values has no `scan` at all, and a path through
       a missing map fails the upgrade before anything rolls out. */}}
{{- $scan := .Values.scan | default dict }}
{{- $clamd := $scan.clamd | default dict }}
{{- with $clamd.host }}
- name: OPENOKR_CLAMD_HOST
  value: {{ . | quote }}
- name: OPENOKR_CLAMD_PORT
  value: {{ $clamd.port | default 3310 | quote }}
{{- end }}
{{- /* Error reports. The DSN only from a Secret, and absent unless
       one is named, which is what sends nothing. `default dict`
       for the reason the scan block gives. */}}
{{- $errors := .Values.errors | default dict }}
- name: OPENOKR_ERROR_ENVIRONMENT
  value: {{ $errors.environment | default "production" | quote }}
{{- with $errors.existingSecret }}
- name: OPENOKR_ERROR_DSN
  valueFrom:
    secretKeyRef:
      name: {{ . }}
      key: {{ $errors.dsnKey | default "dsn" }}
{{- end }}
{{- end -}}

{{/*
The worker (plan 0.8.0 H10e, docs/design/worker-deployment.md D10, D11, D14).
`dig` with the values.yaml defaults, because a release from before 0.8 reuses
values without `worker`.
*/}}
{{- define "openokr.workerEnabled" -}}
{{- if dig "enabled" false (.Values.worker | default dict) -}}true{{- end -}}
{{- end -}}

{{- define "openokr.workerReplicas" -}}
{{- dig "replicaCount" 1 (.Values.worker | default dict) | int -}}
{{- end -}}

{{/*
The worker's pods carry another name label, so the Service, the web
Deployment's selector, its PDB and the backup job's affinity, which all select
name and instance, never select them. The web Deployment's selector cannot be
changed after install, which is why the worker differs rather than the web
pods.
*/}}
{{- define "openokr.workerSelectorLabels" -}}
app.kubernetes.io/name: {{ printf "%s-worker" (include "openokr.name" .) | trunc 63 | trimSuffix "-" }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: worker
{{- end -}}

{{- define "openokr.workerLabels" -}}
helm.sh/chart: {{ include "openokr.chart" . }}
{{ include "openokr.workerSelectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: openokr
{{- end -}}

{{/*
No pause for the worker: nothing routes to it, so there is nothing to wait for
before SIGTERM. The drain and the 15 seconds for the flushes.
*/}}
{{- define "openokr.workerTerminationGraceSeconds" -}}
{{- add (include "openokr.drainSeconds" . | int) 15 -}}
{{- end -}}

{{/*
The autoscaler on the web Deployment (plan 0.8.0 H10f,
docs/design/worker-deployment.md D16). `dig` with the values.yaml defaults,
because a release from before 0.8 reuses values without `autoscaling`.
*/}}
{{- define "openokr.autoscaling" -}}
{{- if dig "enabled" false (.Values.autoscaling | default dict) -}}true{{- end -}}
{{- end -}}

{{- define "openokr.minReplicas" -}}
{{- dig "minReplicas" 2 (.Values.autoscaling | default dict) | int -}}
{{- end -}}

{{- define "openokr.maxReplicas" -}}
{{- dig "maxReplicas" 6 (.Values.autoscaling | default dict) | int -}}
{{- end -}}

{{/*
The most web pods there can be: the autoscaler's ceiling when it is on, the
replica count otherwise. The storage rule and the install notes read this.
*/}}
{{- define "openokr.mostWebReplicas" -}}
{{- if include "openokr.autoscaling" . -}}
{{- include "openokr.maxReplicas" . -}}
{{- else -}}
{{- .Values.replicaCount | int -}}
{{- end -}}
{{- end -}}

{{/*
The fewest web pods there will be, which decides whether a PDB can keep one
through a node drain.
*/}}
{{- define "openokr.fewestWebReplicas" -}}
{{- if include "openokr.autoscaling" . -}}
{{- include "openokr.minReplicas" . -}}
{{- else -}}
{{- .Values.replicaCount | int -}}
{{- end -}}
{{- end -}}
