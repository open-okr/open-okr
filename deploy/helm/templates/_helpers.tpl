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
{{- if and $existing (index $existing.data .key) -}}
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
{{- define "openokr.commonEnv" -}}
{{ include "openokr.databaseEnv" . }}
{{- if .Values.database.adminUrl }}
- name: DATABASE_ADMIN_URL
  valueFrom:
    secretKeyRef:
      name: {{ printf "%s-database" (include "openokr.fullname" .) }}
      key: database-admin-url
{{- end }}
- name: OPENOKR_ENCRYPTION_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "openokr.secretName" . }}
      key: {{ .Values.secrets.encryptionKeyKey }}
- name: NODE_ENV
  value: production
{{- end -}}
