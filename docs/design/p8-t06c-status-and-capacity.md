# P8-T06c: the public status surface and the capacity view

Authority: REQUIREMENTS.md SS5, PLAN.md SS5, TECHNICAL-PLAN.md SS13.1.
Depends on: P8-T06a (admission), P8-T06b (relay round-robin, pool ceiling).
Extends: P7-T06a to c (metrics, gauges, the observability profile).

The tenant-limits design (p8-t01a-tenant-limits.md SS9 #5) says both
deliverables need their own document and are not limits. This is that
document.

## 0. What already exists

| Component | Where | Ships at | What it does today |
|---|---|---|---|
| `/api/health` | `apps/web/app/api/health/route.ts` | P1-T09 | Unauthenticated. `SELECT 1` against Postgres. Returns `{status: "ok"}` or 503. Used by compose `healthcheck` and the Caddy dependency graph. Says almost nothing on purpose |
| `/api/metrics` | `apps/web/app/api/metrics/route.ts` | P7-T06a | Authenticated (instance admin). Prometheus text exposition. 16 series. Per-action duration, queue depth, relay liveness, nudges, channels, agents, AI usage |
| Two Grafana dashboards | `deploy/docker/observability/dashboards/` | P7-T06c | "The SS13.1 budgets" and "Delivery and the background". Provisioned from committed JSON. Off unless the observability profile is started |
| The observability profile | `deploy/docker/compose.yaml` | P7-T06c | Prometheus + Grafana behind `profiles: ["observability"]`. Published on `127.0.0.1:3001`. Nothing leaves the compose network |
| Outbox gauges | `packages/adapters/src/relay.ts` | P7-T06b | `openokr_outbox_pending` and `openokr_outbox_oldest_pending_seconds`, read at scrape time. The relay registers them at construction; a stopped relay keeps reporting a growing lag |
| Per-tenant admission | `packages/core/src/tenancy/admission.ts` | P8-T06a | `actionsPerMinute` and `concurrentActions` in `callAction`, before the metrics span. Refused calls throw `AdmissionError` with a reset time |
| Pool ceiling | `apps/web/lib/pool.ts` | P8-T06b | `OPENOKR_DB_POOL_MAX`, default 20. One `max` for the whole process |
| Operator usage snapshots | `packages/db/src/schema/operator-usage.ts` | P8-T03b | Five per-workspace counts (members, goals, check-ins, storage, last activity) with `measured_at`. Above the tenant floor |
| `/api/app-version` | `apps/web/app/api/app-version/route.ts` | P2-T10 | Authenticated. Returns the build id for the stale-deployment handshake. Not public, on the reasoning that a version string is reconnaissance |

**What does not exist.** No public endpoint that reports whether the
instance is healthy in any dimension beyond "can it reach Postgres". No
metric for connection-pool utilization, for concurrent actions in flight,
or for admission refusals. No dashboard that charts capacity and limit
engagement.

## 1. The two deliverables and why they are separate

A status surface answers "is it working". A capacity view answers "how
much room is left". The audience is different too: the status surface is
public and unauthenticated, so it must say the minimum that is still
useful. The capacity view is behind the observability profile, read by an
operator who already has an admin session.

## 2. The status surface

### 2.1 What it is

A machine-readable JSON endpoint at `GET /api/status`. Unauthenticated.
Present on every deployment, self-hosted or cloud, with no flag.

It is **not** a human-readable status page. Building a page, with
incident history, maintenance windows and subscriber notifications, is a
product in itself (Statuspage, Instatus, Upptime) and outside scope. The
endpoint is a probe target that an operator feeds into whatever external
monitoring they already use.

### 2.2 Why the instance serves it

The alternative is to host the status surface somewhere else, on the
reasoning that a page hosted on the thing it reports on goes down with
it. That reasoning is correct for a human-readable page: a person opens
a blank tab and cannot tell a service outage from a network problem.

For a probe target the reasoning inverts. An external monitor polling
`/api/status` and getting no response *is* the down signal. The monitor
produces the alert, the incident, the page update. The instance not
answering is not a failure of the status surface; it is exactly the
event the surface exists to detect.

The alternative, an external service that can still answer when the
instance is down, requires running a second service. Self-hosted
operators do not have one, and requiring one makes every deployment
harder for the case that matters least often.

**The endpoint is a probe target, not a page.** That is the design
decision, and it is why it lives on the instance.

### 2.3 What it says

Three components, each with a verdict of `operational`, `degraded` or
`unavailable`. The overall verdict is the worst of the three.

| Component | How it is checked | Operational | Degraded | Unavailable |
|---|---|---|---|---|
| `database` | `SELECT 1`, the same query `/api/health` uses | The query succeeds | (binary, no degraded state) | The query fails or times out |
| `relay` | The age of the oldest pending outbox row, the same query the `openokr_outbox_oldest_pending_seconds` gauge runs | Zero pending rows, or the oldest is under `status.relayDegradedSeconds` | The oldest pending row is above that threshold | The oldest pending row is above `status.relayUnavailableSeconds` |
| `scheduler` | The most recent `openokr_job_runs_total` observation, tracked as a timestamp on each successful run | A successful run within the expected interval plus grace | No successful run within that window but the process is alive | Longer than the unavailable threshold |

**What it never contains, and why each exclusion is load-bearing.**

| Excluded | Reason |
|---|---|
| Workspace names, ids or slugs | Leaks which customers exist. The whole point of SS2.2 |
| Tenant count | A number going up or down is a signal about the business, not about health |
| Queue depth or row counts | A number that changes with load is a number an attacker uses to measure the effect of their traffic |
| Version string or build id | Reconnaissance. `/api/app-version` exists for authenticated callers who need it |
| Error messages or stack traces | A machine-readable probe target does not need them and an attacker reads them |
| Metric values or series names | The `/api/metrics` endpoint exists for that, behind authentication |

### 2.4 The response shape

```json
{
  "status": "operational",
  "components": {
    "database":  { "status": "operational" },
    "relay":     { "status": "operational" },
    "scheduler": { "status": "operational" }
  },
  "checked_at": "2026-09-17T12:00:00.000Z"
}
```

HTTP 200 for `operational` and `degraded`. HTTP 503 for `unavailable`.
No `Content-Type` negotiation; JSON only. No caching headers; every
request is a fresh probe.

### 2.5 Relay health check

The relay's own `#oldestPendingSeconds()` query is the honest signal.
The status endpoint cannot call it directly (it is a private method on
the `OutboxRelay` class and that class lives in `packages/adapters`,
which `apps/web` may import). Two options:

(a) Export a standalone function from `packages/adapters` that runs the
    same query against a pool.
(b) Duplicate the query in the route handler, since it is a single
    `SELECT`.

Option (a) is better because it keeps the definition of "how old is the
oldest pending row" in one place. The relay already does this; a second
copy would be a second answer that can quietly diverge.

The thresholds are settings, because the right numbers depend on the
deployment and on what the relay's normal lag looks like under load:

| Setting | Default | Meaning |
|---|---|---|
| `status.relayDegradedSeconds` | 300 (5 minutes) | The relay is behind but probably catching up |
| `status.relayUnavailableSeconds` | 1800 (30 minutes) | The relay has likely stopped |

Both default to a value that fires on a stopped relay and not on a busy
one. An import writing forty thousand rows with the round-robin relay
from P8-T06b takes minutes, not half an hour; a lag above thirty minutes
means nothing is draining.

### 2.6 Scheduler health check

The scheduler runs as part of the same process. Its main jobs are the
Champion's daily cadence, the usage sweep (hourly), and the audit chain
check.

Rather than coupling to pg-boss internals, the scheduler records its own
heartbeat: a `last_scheduler_run_at` timestamp on `globalThis`, updated
after each successful sweep. The status endpoint reads that timestamp
and compares it against a grace period.

| Setting | Default | Meaning |
|---|---|---|
| `status.schedulerDegradedSeconds` | 7200 (2 hours) | No successful run in this window |
| `status.schedulerUnavailableSeconds` | 14400 (4 hours) | The scheduler has likely stopped |

The defaults are generous because the shortest scheduled interval is one
hour (the usage sweep). A two-hour grace fires only when the scheduler
has missed at least one full cycle.

On a fresh start, before the first sweep completes, the scheduler
component reports `operational` rather than immediately degraded. The
grace period starts from boot, not from an absent timestamp.

### 2.7 Difference from /api/health

| | `/api/health` | `/api/status` |
|---|---|---|
| Purpose | Container orchestration (compose, Kubernetes) | External monitoring |
| Authentication | None | None |
| Checks | Database only | Database, relay, scheduler |
| Response | `{status: "ok"}` or 503 | Structured component verdicts |
| Consumers | Docker healthcheck, readiness probe | Uptime monitors, status page tools, alerting systems |

`/api/health` stays as it is. It is deliberately minimal because it runs
on every healthcheck interval and a failure restarts the container. The
status endpoint is richer and does not restart anything.

### 2.8 Self-host

No cloud flag. The endpoint is present everywhere. A self-hosted
operator points their uptime monitor at it and gets the same verdicts a
cloud operator does.

## 3. The capacity view

### 3.1 What it is

A third Grafana dashboard provisioned from a committed JSON file,
alongside the two that P7-T06c ships:

| Dashboard | File | What it answers |
|---|---|---|
| "The SS13.1 budgets" (existing) | `openokr-budgets.json` | Is each action inside its budget? |
| "Delivery and the background" (existing) | `openokr-delivery.json` | Are nudges, channels and jobs moving? |
| **"Capacity and limits"** (new) | `openokr-capacity.json` | How much room is left, and are limits engaging? |

Same profile, same Prometheus, same Grafana. No second monitoring stack.

### 3.2 New metrics

Three series. All bounded-cardinality labels. No workspace id, no member
id, following the same privacy rule the existing sixteen series follow.

| Series | Type | Labels | Registered by | What it answers |
|---|---|---|---|---|
| `openokr_pool_connections` | gauge | `state` (active, idle, waiting) | The pool in `apps/web/lib/pool.ts`, read at scrape time | How full is the connection pool? |
| `openokr_concurrent_actions` | gauge | none | `callAction`, read at scrape time from the in-process counter P8-T06a already maintains | How many actions are in flight right now? |
| `openokr_admission_refusals_total` | counter | `reason` (rate, concurrency) | `admit()` in `packages/core/src/tenancy/admission.ts`, counted on each refusal | How often are limits engaging, and which kind? |

**`openokr_pool_connections`** reads from `pg`'s pool statistics at
scrape time. Three label values: `active` (connections in use by a
query), `idle` (connections in the pool waiting for work), `waiting`
(callers blocked because every connection is taken). If `waiting` is
consistently above zero, `OPENOKR_DB_POOL_MAX` is set too low. The max
itself is charted as a threshold line.

**`openokr_concurrent_actions`** exposes the counter that `admit()`
already maintains for the concurrency check. On a self-hosted instance
with limits at zero, the counter is never incremented and the gauge
reads zero. The cost of exposing it as a gauge is one integer read per
scrape.

**`openokr_admission_refusals_total`** counts refusals at the point they
happen: inside `admit()`, where the `AdmissionError` is thrown. The
`reason` label distinguishes rate-limit breaches from concurrency
breaches, because the remediation is different (wait for the window vs.
reduce parallelism). On a self-hosted instance with limits at zero, this
counter never increments.

### 3.3 The dashboard panels

| Row | Panel | Series | Notes |
|---|---|---|---|
| 1 | Connection pool | `openokr_pool_connections` by state | Stacked time series. `OPENOKR_DB_POOL_MAX` as a threshold line |
| 2 | Concurrent actions | `openokr_concurrent_actions` | With the configured `concurrentActions` limit as a threshold line, absent when zero |
| 3 | Admission refusals | `rate(openokr_admission_refusals_total[5m])` by reason | Per-minute rate. Zero is normal on self-host |
| 4 | Outbox backpressure | `openokr_outbox_pending` and `openokr_outbox_oldest_pending_seconds` | Both existing series. The lag chart is what the relay section of the status endpoint visualises |
| 5 | Relay throughput | `rate(openokr_outbox_dispatched_total[5m])` by outcome | Existing series. Shows how fast the relay is clearing work |
| 6 | Overall request throughput | `rate(openokr_actions_total[5m])` by outcome | Existing series. The denominator the pool and admission charts are fractions of |

No per-workspace breakdown. The privacy rule that keeps workspace ids
out of labels applies here as it does everywhere. Per-workspace data
lives in the operator console (S-45 and S-46) behind authentication.

### 3.4 Where the gauges are registered

`openokr_pool_connections` is registered in `apps/web`, the only package
that holds the pool. It reads `pool.totalCount`, `pool.idleCount` and
`pool.waitingCount` from the `pg` pool instance. Three separate gauge
registrations with the `state` label, or one with a reader that returns
all three. The relay's own pattern (register the gauge at construction,
pass the recorder from outside) applies here too.

`openokr_concurrent_actions` and `openokr_admission_refusals_total` are
registered in `packages/core`, alongside the existing `METRIC` list.
They follow the same pattern the action and operation metrics use.

The concurrent-actions gauge needs the in-process counter that
`admit()` already maintains. Today that counter lives in the cache
driver, keyed per workspace. The gauge cannot read per-workspace cache
keys (unbounded, and the cache may be external). Instead, the gauge
tracks a process-local total: an atomic increment on entry, decrement on
release, and the gauge reads that number. This is a separate counter
from the per-workspace concurrency check, which stays in the cache. The
gauge says "how many actions is this process running", not "how many is
one workspace running".

### 3.5 Self-host

The dashboard is provisioned alongside the other two. An operator who
starts the observability profile gets all three. The admission panels
read zero on a self-hosted instance, which is the correct reading.

## 4. Settings

Four new entries in the SS4.14 settings map, all at instance scope.

| Setting | Kind | Default | Environment | Summary |
|---|---|---|---|---|
| `status.relayDegradedSeconds` | number | 300 | `OPENOKR_STATUS_RELAY_DEGRADED_SECONDS` | Oldest pending outbox row age above which the relay reports degraded |
| `status.relayUnavailableSeconds` | number | 1800 | `OPENOKR_STATUS_RELAY_UNAVAILABLE_SECONDS` | Oldest pending outbox row age above which the relay reports unavailable |
| `status.schedulerDegradedSeconds` | number | 7200 | `OPENOKR_STATUS_SCHEDULER_DEGRADED_SECONDS` | Seconds without a successful scheduler run before degraded |
| `status.schedulerUnavailableSeconds` | number | 14400 | `OPENOKR_STATUS_SCHEDULER_UNAVAILABLE_SECONDS` | Seconds without a successful scheduler run before unavailable |

Validation: each `unavailable` threshold must be strictly greater than
its `degraded` threshold. Both must be positive. Checked at resolve time,
the same as the admission floors.

## 5. What is not built

| Item | Why |
|---|---|
| A human-readable status page | A product in itself. The endpoint is the probe target; the page is the operator's |
| Incident history | Requires a persistence model, a timeline, maintenance windows and subscriber notifications. Not in P8-T06's scope |
| Per-workspace status | Leaks tenant existence. The operator console handles per-workspace health |
| A websocket or SSE stream | A probe is a poll. Streaming adds a connection per subscriber, indefinitely |
| An RSS or Atom feed | Requires incident history, which is not built |

## 6. Acceptance criteria

1. **Given** an unauthenticated `GET /api/status` on a healthy instance,
   **when** the database, relay and scheduler are all operational,
   **then** the response is HTTP 200 with `status: "operational"` for
   every component and overall, and the body contains no workspace name,
   id, count, queue depth, version string or error message.

2. **Given** the database is unreachable,
   **when** `/api/status` is read,
   **then** the response is HTTP 503 with `database.status: "unavailable"`
   and the overall status is `unavailable`.

3. **Given** the oldest pending outbox row is older than
   `status.relayDegradedSeconds`,
   **when** `/api/status` is read,
   **then** `relay.status` is `degraded` and the overall status is at
   least `degraded`.

4. **Given** the oldest pending outbox row is older than
   `status.relayUnavailableSeconds`,
   **when** `/api/status` is read,
   **then** `relay.status` is `unavailable` and the overall status is
   `unavailable`.

5. **Given** the scheduler has not completed a run within
   `status.schedulerDegradedSeconds`,
   **when** `/api/status` is read,
   **then** `scheduler.status` is `degraded`.

6. **Given** the observability profile is running,
   **when** the capacity dashboard is opened in Grafana,
   **then** pool utilization, concurrent actions, admission refusals and
   outbox backpressure are charted from the instance's own data.

7. **Given** a self-hosted instance with all limits at zero,
   **when** the capacity dashboard is read,
   **then** admission refusals show no data and pool utilization shows
   the actual usage against `OPENOKR_DB_POOL_MAX`.

8. **Given** the observability runbook,
   **when** compared against the code,
   **then** all nineteen series (sixteen existing plus three new) are
   listed and the claims match. This is the same assertion
   `telemetry.test.ts` already runs for the original sixteen.

9. **Given** `/api/status` with no pending outbox rows,
   **when** the relay component is checked,
   **then** it reports `operational`, not `degraded`, because an empty
   queue is a healthy queue.

10. **Given** a fresh process start before the first scheduler sweep,
    **when** `/api/status` is read,
    **then** the scheduler component reports `operational` rather than
    immediately degraded.

## 7. Open questions

| # | Question | Why it is not answered here |
|---|---|---|
| 1 | The relay degradation thresholds | 300 and 1800 seconds are guesses. The round-robin relay from P8-T06b changes what normal lag looks like under an import. Should they be tuned after observing the capacity dashboard on a loaded instance? |
| 2 | Whether `/api/status` should set `Cache-Control: no-store` explicitly | The endpoint says `force-dynamic` and returns a fresh probe, but an intermediary reverse proxy might cache the 200 unless told not to. Adding the header costs nothing; the question is whether it is the product's job or the operator's proxy configuration |
| 3 | Whether the pool gauge should report `OPENOKR_DB_POOL_MAX` as a fourth label value or as a separate info-style series | A threshold line in Grafana can read a constant or a series. A series survives a restart that changes the setting; a constant does not |
