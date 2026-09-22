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

## What the nodes have to be

**Control-plane and worker nodes must be on cgroup v2.** Kubernetes 1.32 and
later refuse to start on a host using cgroup v1, so this is a requirement of
your cluster rather than of this chart, and it is worth checking before an
install rather than during one. On a node:

    stat -fc %T /sys/fs/cgroup

`cgroup2fs` is what you want. `tmpfs` means cgroup v1, and the symptom is
misleading: the API server refuses connections immediately, kubeadm reports a
timeout waiting for the control plane, and nothing says the word cgroup unless
you read the kubelet's own log. Every current distribution ships v2; the hosts
that do not are older installs and some virtual machines, including the WSL2
kernel a Windows workstation runs kind on.

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

**The upgrade is the one worth rehearsing.** `.github/workflows/upgrade.yml`
installs the release an instance is actually running, upgrades it to the
commit under test, and asserts the workspace survived. Pods of both releases
serve together against the new schema for the length of a rolling upgrade, so
a migration that drops a column the previous release still reads breaks every
request those pods serve, and no other gate can see it. Run it against your
own baseline before an upgrade you care about.

## Next

- [The first run](first-run.md)
- [Administrator guide](../admin/README.md)
- [Upgrade runbook](../runbooks/upgrade.md)
