# Install on Kubernetes

For an organisation that already runs Kubernetes, brings its own PostgreSQL,
and has an ingress controller and a certificate story of its own.

The chart itself is documented beside it: **[deploy/helm/README.md](../../deploy/helm/README.md)**
holds the install command, every value worth knowing, and the secret to back
up. This page is what surrounds it.

## What the chart deliberately does not do

| Not included | Why |
|---|---|
| A database | The enterprise tier brings its own PostgreSQL, its own backups and its own failover. A bundled StatefulSet is a database nobody owns |
| Certificates | Your ingress controller already does this. The Compose target bundles a proxy because a single server has nothing to delegate to |
| A mail server | Optional everywhere. Point it at yours when you want delivery |

## The shape of an install

1. Have a PostgreSQL with the `pgvector` extension available, and a database
   for OpenOKR.
2. Put the connection string in a Secret rather than on the command line, and
   point `database.existingSecret` at it.
3. Install the chart, with your ingress host.
4. **Back up the generated secret.** The chart generates a root encryption key
   on first install and keeps it across upgrades and uninstalls, and it cannot
   recover it. Losing it makes stored credentials unreadable while everything
   else keeps working, which is the worst way to find out.
5. Open the host. The first-run wizard takes over exactly as it does on a
   single server.

Migrations run as a job from the same image, before the application rolls, so
an upgrade is `helm upgrade` and nothing else.

## What to check before you call it done

`sh deploy/helm/check.sh` runs the chart's own behaviour checks with no cluster
at all: what the chart refuses, where migrations run, and that no credential
lands in a pod spec. `sh deploy/helm/cluster-test.sh` installs it into a kind
cluster, registers a user and upgrades.

Continuous integration runs the first on every change.

## Next

- [The first run](first-run.md)
- [Administrator guide](../admin/README.md)
- [Upgrade runbook](../runbooks/upgrade.md)
