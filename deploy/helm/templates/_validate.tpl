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

{{/*
The one that actually bites. The local-disk storage driver writes to a
volume, and a ReadWriteOnce claim can only be mounted by pods on one node. Two
replicas against it means uploads land on whichever pod served the request and
are missing from the other, which reads as random data loss rather than as a
configuration error.
*/}}
{{- if and .Values.persistence.enabled (gt (int .Values.replicaCount) 1) (eq .Values.persistence.accessMode "ReadWriteOnce") -}}
{{- fail "\n\npersistence.accessMode is ReadWriteOnce but replicaCount is greater than 1.\n\nA ReadWriteOnce volume cannot be shared across nodes, so uploads would land on one pod and be missing from the others.\n\nChoose one:\n  - set replicaCount=1\n  - use a ReadWriteMany storage class: --set persistence.accessMode=ReadWriteMany\n  - point storage at S3-compatible object storage and leave persistence disabled\n" -}}
{{- end -}}

{{- if and (eq .Values.mail.transport "smtp") (not .Values.mail.host) -}}
{{- fail "\n\nmail.transport is 'smtp' but mail.host is empty.\n\nSet mail.host, or leave the transport as 'console', which writes mail to the log and needs no server.\n" -}}
{{- end -}}

{{- if not (has .Values.instance.registration (list "auto" "open" "invite_only")) -}}
{{- fail "\n\ninstance.registration must be auto, open or invite_only.\n" -}}
{{- end -}}

{{- if and .Values.ingress.enabled (not .Values.ingress.hosts) -}}
{{- fail "\n\ningress.enabled is true but no hosts are set.\n" -}}
{{- end -}}

{{- end -}}
