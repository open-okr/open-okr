# OpenOKR on Kubernetes

The chart is published to `oci://ghcr.io/open-okr/charts/openokr` with every
release, versioned with the release, and its default image is that release's
`ghcr.io/open-okr/open-okr`. Pin both with `--version` and `image.tag`.

```sh
kubectl create namespace openokr
kubectl -n openokr create secret generic openokr-database \
  --from-literal=database-url='postgres://user:password@host:5432/openokr'

helm install openokr oci://ghcr.io/open-okr/charts/openokr \
  --version 0.7.0 \
  --namespace openokr \
  --set database.existingSecret=openokr-database \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=okr.example.com \
  --set ingress.hosts[0].paths[0].path=/ \
  --set ingress.hosts[0].paths[0].pathType=Prefix
```

Then open the host and the first-run wizard takes over: create the owner
account, and registration closes behind it.

## What this chart does not do

**It does not deploy a database.** The enterprise tier brings their own
Postgres, their own backups and their own single sign-on. A bundled database
would be a stateful set nobody owns. Point `database.url` at yours, or better,
put it in a Secret and use `database.existingSecret`.

**It does not manage certificates.** That is your ingress controller's job.
The Compose target uses Caddy for that, because a single server has no ingress
controller to delegate to.

## Back up the generated secret

On first install the chart generates two keys into a Secret. One of them
encrypts every stored credential in the instance.

```sh
kubectl -n openokr get secret openokr-secrets -o yaml > openokr-secrets-backup.yaml
```

The chart keeps this Secret across upgrades and across `helm uninstall`, and
an upgrade never rotates it. But it cannot recover it. Lose it and mail
passwords, channel credentials and provider keys become unreadable, while
everything else keeps working. That is the worst way to discover the loss.

Operators with their own secret management should set `secrets.existingSecret`
and skip generation entirely.

That Secret may also hold `metrics-token` (or the key `secrets.metricsTokenKey` names), the bearer Prometheus scrapes `/api/metrics` with. The chart generates one when it makes the Secret. Without the key the pod still starts and the endpoint answers a signed-in administrator only.

## Values worth knowing

| Value | Default | Notes |
|---|---|---|
| `database.url` | none | Required unless `database.existingSecret` is set |
| `database.adminUrl` | none | Owner-role connection used only by the migration hook, so the application role never owns the tables |
| `database.existingSecretAdminKey` | none | With `database.existingSecret`: the key in that Secret holding the owner-role connection. Prefer it to `adminUrl`, which lands in the release's stored values. Refused without `existingSecret` |
| `database.caBundle.configMap` or `.existingSecret`, and `.key` | none, `ca.pem` | A CA bundle that signs your database's certificate, mounted in every workload. With it, connect with `sslmode=verify-full` |
| `publicUrl` | first ingress host | Passkeys are bound to this origin. Get it right |
| `replicaCount` | 1 | Migrations run in a hook, so more than one is safe. One is the default because the default storage mode cannot be shared |
| `persistence.enabled` | true | A volume for uploaded files. See below |
| `mail.transport` | console | `console` writes mail to the pod log and needs no server |
| `instance.registration` | auto | Open until the instance is claimed, then closed |
| `network.trustedProxies` | empty | The load balancers or CDN in front of the instance, as addresses or CIDR ranges. `X-Forwarded-For` is then read from the right past them, so every per-address limit counts people rather than proxies. Never fetched: copy your CDN's current list. See [behind a CDN or a load balancer](../../docs/install/behind-a-proxy.md) |
| `network.clientAddressHeader` | empty | Instead of the above, the one header your CDN writes the visitor's address into, such as `cf-connecting-ip`. Safe only when the load balancer refuses every request that did not come through your CDN zone. Both set is refused |
| `instance.sourceUrl` | upstream | Where every member is offered the source. Name your own if you changed the code |
| `instance.termsUrl`, `instance.privacyUrl` | empty | Named on the sign-up page once set |
| `instance.supportEmail` | empty | Who a customer writes to about their plan |
| `cloud.enabled` | false | Tenant records and the operator console, for running this for other people or for several companies of your own |
| `cloud.plans`, `cloud.defaultPlan`, `cloud.region` | empty | The plan catalogue as JSON, the plan a new workspace starts on, and the region recorded on each tenant |
| `cloud.erasure.schedule` | empty | A cron schedule for `pnpm cloud:erase --write`, which erases closed workspaces past their retention window. Runs with `database.adminUrl`, the owner role. Nothing is erased while `OPENOKR_CLOUD_CLOSURE_RETENTION_DAYS` is 0, its default |
| `extraEnv`, `extraEnvFrom` | empty | Anything else the application reads. Prefer `extraEnvFrom` with a Secret for a credential |
| `shutdown.preStopSeconds` | 10 | How long a stopping pod keeps answering before it is sent SIGTERM, while the load balancer stops sending to it. 0 removes the pause. See [Stopping a pod](#stopping-a-pod) |
| `shutdown.drainSeconds` | 20 | How long the server may finish its work in flight after SIGTERM (`OPENOKR_SHUTDOWN_SECONDS`, 1 to 300). The pod's grace period is the pause plus this plus 15 |

## Storage and replicas

**The defaults keep files: one replica, one `ReadWriteOnce` volume at
`/app/storage`.** Two replicas with persistence off is the one combination
that loses uploads without saying anything: the mount falls back to an
`emptyDir`, so a file lands on whichever pod served the request, is missing
from the other, and is gone when either restarts.

`persistence.enabled=true` with `ReadWriteOnce` and more than one replica is
refused at template time, with an explanation, because such a volume cannot be
mounted by pods on more than one node.

To run more than one replica, pick one:

- a `ReadWriteMany` class: `--set persistence.accessMode=ReadWriteMany`
- S3-compatible object storage, which is shared by definition

Turning persistence off is allowed and not refused. An instance that accepts no
uploads is entitled to run that way, and refusing it would break a release that
is already running. `helm install` prints what it costs.

### S3-compatible object storage

Naming a bucket is the whole switch. Works with AWS S3, MinIO, Ceph, Garage,
Cloudflare R2, Backblaze B2 and DigitalOcean Spaces: set `storage.s3.endpoint`
for anything that is not AWS.

```sh
kubectl create secret generic openokr-s3 \
  --from-literal=access-key-id=... \
  --from-literal=secret-access-key=...

helm upgrade openokr . \
  --set storage.s3.bucket=openokr-files \
  --set storage.s3.existingSecret=openokr-s3 \
  --set storage.s3.endpoint=https://s3.example.com \
  --set replicaCount=3
```

Credentials come from a Secret and never from values, because a value lands in
the release and `helm get values` reads it back.

**On AWS, prefer no key at all.** Leave `storage.s3.existingSecret` empty and
give the pod a role: the AWS SDK's default chain finds it, so no long-lived key
exists anywhere. With IRSA, annotate the service account; with EKS Pod
Identity, associate the service account with the role; on EC2, an instance
profile does the same. With no key the SDK may ask the cloud's metadata
service for credentials, so a store inside an air-gapped network, MinIO for
one, keeps using a key pair.

```sh
helm upgrade openokr . \
  --set storage.s3.bucket=openokr-files \
  --set storage.s3.region=eu-west-1 \
  --set-string serviceAccount.annotations."eks\.amazonaws\.com/role-arn"=arn:aws:iam::123456789012:role/openokr-files
```

A named bucket lifts the single-replica limit: object storage is shared, so the
access mode of the local volume stops mattering. The volume stays mounted and
unused, which costs nothing and means turning S3 off again needs no new claim.

| Value | Default | Notes |
|---|---|---|
| `storage.s3.bucket` | none | Empty means local disk |
| `storage.s3.region` | `us-east-1` | Required by the SDK even where it is ignored |
| `storage.s3.endpoint` | none | Empty means AWS S3 itself |
| `storage.s3.forcePathStyle` | none | `on`, `off`, or empty to let the driver decide |
| `storage.s3.keyPrefix` | none | So one bucket can hold several instances |
| `storage.s3.existingSecret` | none | A Secret holding a key pair. Empty means no key: the AWS SDK finds the pod's own credentials (IRSA, EKS Pod Identity, an instance profile) |

## A managed Postgres's certificate

RDS, Cloud SQL and Azure Database sign their certificates with an authority
Node does not carry, so `sslmode=require` or `verify-full` fails to connect
and `sslmode=no-verify` connects without checking who answered. Give the chart
the provider's bundle and check it:

```sh
curl -fsSLo global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
kubectl create configmap rds-ca --from-file=global-bundle.pem

helm upgrade openokr . \
  --set database.caBundle.configMap=rds-ca \
  --set database.caBundle.key=global-bundle.pem
```

and end the connection string with `?sslmode=verify-full`. The bundle is
mounted read-only in the server, the migration hook and every job, as
`NODE_EXTRA_CA_CERTS` for Node and `PGSSLROOTCERT` for the backups'
`pg_dump` and `pg_restore`. A Secret works the same way through
`database.caBundle.existingSecret`; naming both is refused.

## Stopping a pod

A rollout, a scale-down or a node drain stops pods, and none of them should
fail a request or lose work. Each stop has three parts:

| Part | Default | What happens |
|---|---|---|
| The pause | `shutdown.preStopSeconds`, 10 | The pod has been taken out of the Service's endpoints but keeps answering, because kube-proxy, an ingress controller or a cloud load balancer goes on sending to it for a few seconds while the change reaches it |
| The drain | `shutdown.drainSeconds`, 20 | SIGTERM. The server finishes the delivery it is sending and hands the rest of its batch back, lets a scheduled run finish or hands it back three seconds before the end, and waits for actions in flight. Then it sends the error reports and spans it holds, writes `shutdown: stopped after ...` and exits |
| The grace period | The two above plus 15, so 45 | Kubernetes kills the pod only if something above hung. It is derived, so raising either value raises it too |

Behind the AWS Load Balancer Controller a target is deregistered only after the
controller has seen the endpoint change and called AWS, which is slower than
kube-proxy. Start `shutdown.preStopSeconds` at 20 there and watch the load
balancer's 5xx count during a rollout.

## Upgrading

```sh
helm upgrade openokr oci://ghcr.io/open-okr/charts/openokr --reuse-values --version 1.2.3
```

Migrations run in a `pre-upgrade` hook before any new pod starts. They are
forward-only and take a Postgres advisory lock, so the upgrade is safe to
retry and safe with several replicas. A failed migration stops the release
rather than producing pods that serve a half-migrated schema.

`--reuse-values` keeps the old values and adds no new defaults, so an upgrade
to a release that added a chart value can fail. Use `--reset-then-reuse-values`
(Helm 3.14 or later) there; see
[the upgrade runbook](../../docs/runbooks/upgrade.md#helm-coming-from-05).

Roll back with `helm rollback openokr`. Note that this rolls back the
application, not the schema: migrations are forward-only by design, and a
schema change that has to be undone is a new migration.

## Verifying the image

Every released image is signed with cosign, keyless. There is no public key to
distribute; the signature records which workflow at which commit built it.

```sh
cosign verify \
  --certificate-identity-regexp '^https://github.com/open-okr/open-okr/.github/workflows/release.yml@refs/tags/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/open-okr/open-okr:1.2.3
```

## Testing a change to this chart

```sh
sh deploy/helm/check.sh          # what the chart refuses, and what it renders
kind create cluster
docker build -f deploy/docker/Dockerfile -t openokr:ci .
kind load docker-image openokr:ci
OPENOKR_IMAGE_TAG=ci sh deploy/helm/cluster-test.sh
```

Both run in CI on every pull request that is not documentation only.
