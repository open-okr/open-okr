# OpenOKR on Kubernetes

```sh
helm install openokr oci://ghcr.io/open-okr/charts/openokr \
  --namespace openokr --create-namespace \
  --set database.url='postgres://user:password@host:5432/openokr' \
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
everything else keeps working — which is the worst way to discover the loss.

Operators with their own secret management should set `secrets.existingSecret`
and skip generation entirely.

## Values worth knowing

| Value | Default | Notes |
|---|---|---|
| `database.url` | none | Required unless `database.existingSecret` is set |
| `database.adminUrl` | none | Owner-role connection used only by the migration hook, so the application role never owns the tables |
| `publicUrl` | first ingress host | Passkeys are bound to this origin. Get it right |
| `replicaCount` | 2 | Migrations run in a hook, so more than one is safe from the first install |
| `persistence.enabled` | false | Local-disk file storage. See the warning below |
| `mail.transport` | console | `console` writes mail to the pod log and needs no server |
| `instance.registration` | auto | Open until the instance is claimed, then closed |

## Storage and replicas

`persistence.enabled=true` with the default `ReadWriteOnce` access mode and
more than one replica is refused at template time, with an explanation. A
ReadWriteOnce volume cannot be shared across nodes, so uploads would land on
one pod and be missing from the others — which reads as random data loss
rather than as a configuration error.

Pick one:

- one replica
- a `ReadWriteMany` storage class
- S3-compatible object storage, leaving persistence off

## Upgrading

```sh
helm upgrade openokr oci://ghcr.io/open-okr/charts/openokr --reuse-values --version 1.2.3
```

Migrations run in a `pre-upgrade` hook before any new pod starts. They are
forward-only and take a Postgres advisory lock, so the upgrade is safe to
retry and safe with several replicas. A failed migration stops the release
rather than producing pods that serve a half-migrated schema.

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

Both run in CI on every pull request.
