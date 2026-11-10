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

The chart is published with every release at
`oci://ghcr.io/open-okr/charts/openokr`, and its default image is the same
release of `ghcr.io/open-okr/open-okr`. [The chart's README](../../deploy/helm/README.md)
has the whole command. To run an image you built yourself, install the chart
from a checkout with `helm install openokr ./deploy/helm` and set
`image.repository` and `image.tag`.

1. Have a PostgreSQL and a database for OpenOKR. The `pgvector` extension is
   optional: with it, semantic search uses embeddings; without it, search falls
   back to full text.
2. **Connect as a role that is not a superuser and has no `BYPASSRLS`.** Row
   level security is what keeps one workspace out of another's rows, and
   Postgres never applies it to either kind of role. A role that owns the
   database is right: the tables force the policy on their owner too. The
   instance warns at boot and on `/admin/general` when its role bypasses the
   floor, and the server still starts.
3. Put the connection string in a Secret rather than on the command line, and
   point `database.existingSecret` at it.
4. Install the chart, with your ingress host.
5. **Back up the generated secret.** The chart generates a root encryption key
   on first install and keeps it across upgrades and uninstalls, and it cannot
   recover it. Losing it makes stored credentials unreadable while everything
   else keeps working, which is the worst way to find out.
6. Open the host and finish setup right after the first start. Until somebody
   does, anyone who reaches the host can create the owner account. The first-run
   wizard takes over exactly as it does on a single server.

Migrations run as a job from the same image, before the application rolls, so
an upgrade is `helm upgrade` and nothing else.

## Proxies in front of the application

The sign-in limits count each caller by address. The address is the
`X-Forwarded-For` entry that many places from the right as there are reverse
proxies in front of the pods, because the entry the nearest proxy wrote is the
one a caller cannot forge. Set `instance.trustedProxyHops` to match:

| What sits in front of the pods | `instance.trustedProxyHops` |
|---|---|
| One ingress controller (the default) | 1 |
| A cloud load balancer in front of the ingress controller | 2 |
| Nothing, pods reached directly | 0, which ignores the header and gives every caller one shared limit |

Too low and callers share one limit, so a few bad attempts block everyone.
Too high and the entry is one the caller wrote, so a caller can pick its own
limit. Check it once with the address your own request shows in the ingress
controller's access log.

## What to check before you call it done

`sh deploy/helm/check.sh` runs the chart's own behaviour checks with no cluster
at all: what the chart refuses, where migrations run, and that no credential
lands in a pod spec. `sh deploy/helm/cluster-test.sh` installs it into a kind
cluster, registers a user and upgrades.

Continuous integration runs both on every change that is not documentation only.

**The upgrade is the one worth rehearsing.** `.github/workflows/upgrade.yml`
installs the release an instance is actually running, upgrades it to the
commit under test, and asserts the workspace survived. Pods of both releases
serve together against the new schema for the length of a rolling upgrade, so
a migration that drops a column the previous release still reads breaks every
request those pods serve, and no other gate can see it. Run it against your
own baseline before an upgrade you care about.

## Next

- [The first run](first-run.md)
- [Choose a setup](setups.md): several workspaces, a workspace per company, or a cloud of your own
- [Administrator guide](../admin/README.md)
- [Upgrade runbook](../runbooks/upgrade.md)
