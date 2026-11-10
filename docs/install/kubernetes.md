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
   back to full text. It is not a trusted extension, so the migration hook can
   create it only if its role is a superuser (on RDS, a member of
   `rds_superuser`). Otherwise run `create extension vector` in the database
   first.
2. **Connect as a role that is not a superuser and has no `BYPASSRLS`.** Row
   level security is what keeps one workspace out of another's rows, and
   Postgres never applies it to either kind of role. A role that owns the
   database is right: the tables force the policy on their owner too. The
   instance warns at boot, in `/api/health` and on `/admin/general` when its
   role bypasses the floor.
3. Put the connection string in a Secret rather than on the command line, and
   point `database.existingSecret` at it.
4. Install the chart, with your ingress host.
5. **Back up the generated secret.** The chart generates a root encryption key
   on first install and keeps it across upgrades and uninstalls, and it cannot
   recover it. Losing it makes stored credentials unreadable while everything
   else keeps working, which is the worst way to find out.
6. Open the host. The first-run wizard takes over exactly as it does on a
   single server.

Migrations run as a job from the same image, before the application rolls, so
an upgrade is `helm upgrade` and nothing else.

## Behind a load balancer or a CDN

**Name what is in front of the instance.** Every per-address limit, the
sign-in hold and the session list read the visitor's address from a header. With
nothing set, `X-Forwarded-For` is believed only when it holds one address, so a
layer-7 load balancer or a CDN, which leave a chain, make every visitor one.
Set `network.trustedProxies` to the proxies' own addresses or ranges, or, behind
a CDN that is the only way to reach the load balancer,
`network.clientAddressHeader` to the header it writes. Never both: the chart
refuses that, and `0.0.0.0/0`. [Behind a CDN or a load balancer](behind-a-proxy.md)
has the table per setup, the ingress-controller settings that go with it, and
the check to run afterwards.

The inbox, the feed, the board, the agents screen and the copilot each hold a
live stream open. Every one sends a comment line every 25 seconds when nothing
else is said, so an idle timeout of 60 seconds or more (AWS load balancers
default to 60, Cloudflare to about 100) never cuts it. A proxy set below 25
seconds will, and every open tab reconnects each time. Do not buffer the
responses: they are `text/event-stream`, and the server already sends
`X-Accel-Buffering: no` for nginx.

## Stopping a pod

Every rollout, scale-down and node drain stops pods. A stopping pod first
pauses for `shutdown.preStopSeconds` (10 seconds) while it keeps answering,
because whatever sends it traffic learns that it is leaving a few seconds after
Kubernetes does. Then the server drains for up to `shutdown.drainSeconds` (20):
it finishes the delivery it is sending, hands back the rest of its work for
another pod to pick up, and waits for the actions in flight. Kubernetes kills
it only at the grace period, the two added together plus 15 seconds.

| In front of the pods | What the pause has to cover |
|---|---|
| kube-proxy alone, or an ingress controller in the cluster | A second or two. The default is generous |
| The AWS Load Balancer Controller | The controller seeing the change and calling AWS. Start at 20 seconds and watch the load balancer's 5xx count during a rollout |
| A CDN in front of a load balancer | Whatever the load balancer needs; the CDN reconnects on its own |

A long live stream, such as an open inbox, closes when the pod exits, and the
browser reconnects to another pod by itself. The chart's README has
[the whole sequence](../../deploy/helm/README.md#stopping-a-pod).

## Behind PgBouncer

Point the instance at Postgres directly. A connection pooler such as PgBouncer
in **transaction** mode hands a server connection to a client for one
transaction only, and four things need one connection for longer than that:

| What | What happens through a transaction pooler |
|---|---|
| Live updates (the inbox, the feed, the board) | They stop: the `LISTEN` that receives them lands on a connection that is handed to somebody else at once |
| The first workspace on sign-up, creating another workspace, finishing setup | Two requests at once can each create one: the lock that keeps them apart is session-level, and its lock and unlock can land on different connections |
| Background jobs | They still run, but by polling rather than being woken, so later than they would be |
| Migrations | Not affected, as long as `DATABASE_ADMIN_URL` points at Postgres directly, which it must anyway |

Session mode is safe. A setting that sends these to a direct connection while
the rest goes through a transaction pooler is designed
([direct-connection.md](../design/direct-connection.md)) and will be built when
a deployment needs it.

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
