{{/*
Configuration this chart refuses, and why.

Every one of these fails at template time with a sentence an operator can act
on. The alternative is a deployment that installs cleanly and then does
something wrong at three in the morning: pods crash-looping on a missing
database, or two replicas quietly corrupting each other's uploads.

`fail` stops the render, so nothing reaches the cluster.
*/}}
{{- define "openokr.validate" -}}

{{- if and (not .Values.database.url) (not .Values.database.existingSecret) -}}
{{- fail "\n\nOpenOKR needs a database. There is no sensible default for someone else's Postgres, and this chart deploys none.\n\nSet one of:\n  --set database.url='postgres://user:password@host:5432/openokr'\n  --set database.existingSecret=my-db-secret\n" -}}
{{- end -}}

{{- if and .Values.database.url (not (or (hasPrefix "postgres://" .Values.database.url) (hasPrefix "postgresql://" .Values.database.url))) -}}
{{- fail "\n\ndatabase.url must be a postgres:// or postgresql:// connection string.\n" -}}
{{- end -}}

{{- if and (dig "caBundle" "existingSecret" "" .Values.database) (dig "caBundle" "configMap" "" .Values.database) -}}
{{- fail "\n\ndatabase.caBundle names both a Secret and a ConfigMap. Name one: the bundle is mounted from exactly one place.\n" -}}
{{- end -}}

{{- /* A key in a Secret that is not there: the owner role would be read from nothing (plan 0.8.0 H8). */ -}}
{{- if and (dig "existingSecretAdminKey" "" .Values.database) (not .Values.database.existingSecret) -}}
{{- fail "\n\ndatabase.existingSecretAdminKey names a key in database.existingSecret, which is empty.\n\nPut the owner-role connection in the same Secret as the application's and name both:\n  --set database.existingSecret=my-db-secret\n  --set database.existingSecretAdminKey=database-admin-url\n" -}}
{{- end -}}

{{/*
The one that actually bites. The local-disk storage driver writes to a
volume, and a ReadWriteOnce claim can only be mounted by pods on one node. Two
replicas against it means uploads land on whichever pod served the request and
are missing from the other, which reads as random data loss rather than as a
configuration error.

The message named a third remedy from P1-T09 until P6-G04, "point storage at
S3-compatible object storage", and no such driver existed. Advice an operator
cannot follow is worse than no advice, because they spend the afternoon looking
for the setting. P6-G05 built the driver, so the line is back and true.

Several replicas with persistence *off* is the other unsafe combination and it
is deliberately not refused: an instance that accepts no uploads is entitled to
run that way, and refusing it would break existing releases on upgrade. The
defaults no longer produce it, and NOTES.txt says what it costs.

A named S3 bucket exempts the whole check: object storage is shared by
definition, so the replica count stops mattering.
*/}}
{{- if and (not .Values.storage.s3.bucket) .Values.persistence.enabled (gt (int .Values.replicaCount) 1) (eq .Values.persistence.accessMode "ReadWriteOnce") -}}
{{- fail "\n\npersistence.accessMode is ReadWriteOnce but replicaCount is greater than 1.\n\nA ReadWriteOnce volume cannot be shared across nodes, so uploads would land on one pod and be missing from the others.\n\nChoose one:\n  - set replicaCount=1, which is the default\n  - use a ReadWriteMany storage class: --set persistence.accessMode=ReadWriteMany\n  - use S3-compatible object storage: --set storage.s3.bucket=... --set storage.s3.existingSecret=...\n" -}}
{{- end -}}

{{/*
S3 credentials come from a Secret, never from values, so a key cannot land in
the release where `helm get values` reads it back. A bucket with no Secret is
allowed since 0.8.0 (plan H9): the AWS SDK's default chain then finds the pod's
own credentials, which is how EKS Pod Identity, IRSA and an instance profile
work. Annotate the service account for that (serviceAccount.annotations).
*/}}

{{- if and .Values.storage.s3.forcePathStyle (not (has .Values.storage.s3.forcePathStyle (list "on" "off"))) -}}
{{- fail "\n\nstorage.s3.forcePathStyle must be \"on\", \"off\" or empty.\n\nEmpty lets the driver decide: on when an endpoint is set, off for AWS S3.\n" -}}
{{- end -}}

{{- if and (eq .Values.mail.transport "smtp") (not .Values.mail.host) -}}
{{- fail "\n\nmail.transport is 'smtp' but mail.host is empty.\n\nSet mail.host, or leave the transport as 'console', which writes mail to the log and needs no server.\n" -}}
{{- end -}}

{{- if not (has .Values.instance.registration (list "auto" "open" "company_domains" "invite_only")) -}}
{{- fail "\n\ninstance.registration must be auto, open, company_domains or invite_only.\n" -}}
{{- end -}}

{{- /* One reading of the caller's address, and never one that trusts every
       address (docs/design/trusted-proxies.md D5, D7, D15). The application
       refuses both at boot too; refused here, nothing reaches the cluster. */ -}}
{{- $network := .Values.network | default dict -}}
{{- if and $network.trustedProxies (not (kindIs "slice" $network.trustedProxies)) -}}
{{- fail "\n\nnetwork.trustedProxies must be a list, such as --set 'network.trustedProxies={10.0.1.0/24,10.0.2.0/24}'.\n" -}}
{{- end -}}
{{- if and $network.trustedProxies $network.clientAddressHeader -}}
{{- fail "\n\nnetwork.trustedProxies and network.clientAddressHeader are both set. Set one.\n\ntrustedProxies names the proxies in front of the instance, so X-Forwarded-For is read from the right past them. clientAddressHeader names the one header your CDN writes the visitor's address into. docs/install/behind-a-proxy.md says which to use.\n" -}}
{{- end -}}
{{- range $network.trustedProxies -}}
{{- if or (eq (toString .) "0.0.0.0/0") (eq (toString .) "::/0") -}}
{{- fail (printf "\n\nnetwork.trustedProxies holds %s, which trusts every address, so every caller could choose their own.\n\nName your proxies' own addresses or ranges.\n" (toString .)) -}}
{{- end -}}
{{- end -}}

{{- if and .Values.ingress.enabled (not .Values.ingress.hosts) -}}
{{- fail "\n\ningress.enabled is true but no hosts are set.\n" -}}
{{- end -}}

{{- end -}}
