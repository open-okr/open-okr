# Watching an OpenOKR instance

What this instance measures about itself, what leaves the host, and how to
look at any of it.

The series names below, and this page's claims about what leaves the host,
are asserted against the code by `packages/adapters/test/telemetry.test.ts`, so
one of those claims that stops being true fails the build rather than
misleading the next operator.

## The short version

| Question | Answer |
|---|---|
| Does OpenOKR send anything anywhere by default? | No. |
| What has to be configured before it measures itself? | Nothing. |
| Where are the numbers? | `GET /api/metrics`, for a signed-in member with `full` access. |
| What makes data leave the host? | Two settings, both empty: `observability.otlp.endpoint` for traces, and `observability.errors.dsn` for error reports. |

## Two settings, and they are not the same thing

The distinction matters more than anything else on this page, and conflating
the two is the direct route to an instance that reports home when its
operator believed it did not.

| Setting | Default | What it does |
|---|---|---|
| `instance.telemetry` | off | Anonymous usage reporting **to the OpenOKR project**. Data leaving your instance. Unrelated to everything else here. |
| `observability.metrics` | **on** | This instance measuring itself and serving the numbers at `/api/metrics`. Local. Nothing leaves. |
| `observability.otlp.endpoint` | **empty** | Where to send traces. The only setting in this product that can make a measurement leave the host. |
| `observability.errors.dsn` | **empty** | Where to send error reports: the DSN of a tracker that speaks Sentry's protocol. The only other setting that can make anything leave the host. See [Sending errors to a tracker](#sending-errors-to-a-tracker). |

`observability.metrics` defaults to on because a local endpoint behind an
administrator session sends nothing anywhere, and a product that has to be
configured before it can be watched is a product nobody watches. Turning it
off costs nothing rather than a little: the driver that replaces the meter
does nothing at all, and the gauges' database queries are never run.

Both are read from the environment at boot
(`OPENOKR_OBSERVABILITY_METRICS`, `OPENOKR_OTLP_ENDPOINT`), and no admin screen
sets them. `OPENOKR_OBSERVABILITY_METRICS=false` or `0` turns metrics off. The
environment is read deliberately: the meter is built before the first request
and therefore before any query, so reading the stored row would either block
boot on Postgres or leave the first requests unmeasured.

## Reading the numbers by hand

Open `https://your-instance/api/metrics` in a browser signed in as a member
with `full` access in the workspace it has open. Anything else gets a
not-found, which is the same answer a signed-out visitor gets: the endpoint is
deliberately not an oracle for whether this instance is measuring itself.

**A scraper uses the instance's scrape token**, `OPENOKR_METRICS_TOKEN`, sent
as `Authorization: Bearer <token>`. `./openokr up` generates it into
`deploy/docker/secrets/app.env` and writes the same value to
`deploy/docker/secrets/observability-token`; the Helm chart generates it into
its Secret. Unset means only a signed-in administrator is answered. A token
from `/account/api-tokens` is not accepted here: it is a member's, for
`/api/v1`. A wrong or missing token gets the same not-found as anybody else.

To rotate it, change `OPENOKR_METRICS_TOKEN` in `app.env`, write the same
value to `secrets/observability-token`, and run `./openokr up`.

The body is Prometheus text exposition, `version=0.0.4`.

## What is measured

Twenty-eight series. Every one is a count, a duration, a queue reading or a
capacity gauge.

**On the request's own thread**

| Series | Labels |
|---|---|
| `openokr_actions_total` | action, outcome |
| `openokr_action_duration_seconds` | action |
| `openokr_operations_total` | action, outcome |
| `openokr_operation_duration_seconds` | action |
| `openokr_authorisation_total` | action, required, outcome |
| `openokr_channel_inbound_refusals_total` | provider, reason (no_tenant, unknown_tenant, no_connection, failed_verification) |

**After the request has returned, or because a clock said so**

| Series | Labels |
|---|---|
| `openokr_outbox_dispatched_total` | topic, outcome |
| `openokr_outbox_pending` | none |
| `openokr_outbox_oldest_pending_seconds` | none |
| `openokr_outbox_dead_lettered_total` | topic |
| `openokr_outbox_rate_held_workspaces` | none. Workspaces at their outbox rate now (`cloud.limits.outboxRowsPerMinute`). 0 while the limit is unset |
| `openokr_outbox_rate_held_rows` | none. Due rows waiting only because their workspace is at its rate. A steady number here is the limit doing its job, not an outage: those rows are not counted as relay lag |
| `openokr_job_runs_total` | job, outcome |
| `openokr_job_duration_seconds` | job |
| `openokr_nudges_total` | rule, outcome, channel |
| `openokr_channel_deliveries_total` | provider, outcome |
| `openokr_realtime_events_total` | topic |
| `openokr_agent_runs_total` | trigger, outcome |
| `openokr_agent_tool_call_record_failures_total` | none. An agent tool call whose record row could not be written; the agent's answer is unaffected |
| `openokr_agent_run_duration_seconds` | trigger |
| `openokr_ai_tokens_total` | provider, model, direction |
| `openokr_ai_cost_total` | provider, model |

**Capacity**

| Series | Labels |
|---|---|
| `openokr_pool_connections` | state (active, idle, waiting) |
| `openokr_concurrent_actions` | none |
| `openokr_admission_refusals_total` | reason (rate, concurrency) |
| `openokr_sign_in_held_total` | scope (pair, account). A password attempt refused by a sign-in hold. A steady `account` rate is somebody guessing one account from many networks |

**Errors**

| Series | Labels |
|---|---|
| `openokr_errors_total` | source (request, action, relay, dead_letter, job, agent, process, browser). Every unexpected error, including those the caps below hold back. Refusals are not errors and are not counted here: they are the `refused` and `not_found` outcomes above. Alert on this one |
| `openokr_error_reports_dropped_total` | reason (queue_full, rate_limited, send_failed). A report the tracker did not get. Always zero with no tracker. A steady `send_failed` is a tracker that is down or a DSN pointing at the wrong place |

### The four readings that are taken at scrape time

`openokr_outbox_pending`, `openokr_outbox_oldest_pending_seconds`,
`openokr_pool_connections` and `openokr_concurrent_actions` are
queried when you read the endpoint, not written when an event happens.
For the outbox pair,
that is the only shape that answers the question worth asking: a counter
written during a drain says nothing once draining stops, so a dead relay
produces a flat line and the outage reads as a quiet queue. Those two keep
climbing. For the pool and concurrency gauges, the scrape-time read reflects
the world at the moment somebody asks rather than a snapshot from a moment
that may have passed.

The age is measured from the row's own `created_at`, not from `available_at`.
A row being retried has `available_at` in the future, so measuring from that
would report a negative lag for exactly the rows that are struggling.

### What is never in a label

No workspace id. No member id. No email address or phone number. No goal
title, no check-in text, no message body. No provider error string, because a
channel driver's failure text can quote the address it failed to reach or a
fragment of what it was sending.

This is not only privacy. Each distinct label combination is a separate time
series held for the life of the process, so an unbounded label is a memory
leak that also happens to be a disclosure.

The consequence worth knowing: **these numbers cannot tell you which
workspace is slow.** That is deliberate. Use the audit trail and the
access-scoped screens, which apply authorisation, for anything that names a
subject.

## What is not measured here, and where it is

HTTP request count, status class and duration are taken at the reverse proxy,
not in application code. `apps/web/proxy.ts` is the only application file that
sees every request and it cannot measure one: it is synchronous and returns
before the handler that produces the status and the duration has run.
Instrumenting it would also pull the whole adapter package, the S3 and
Postgres clients included, into a bundle that executes on every request.

Six of the TECHNICAL-PLAN §13.1 budgets need a browser or a real channel and
so cannot come from a server-side series at all. They are named on the
budgets dashboard with the tool that measures each, rather than left silently
absent.

## Unexpected errors

Every unexpected error is one JSON line on stderr, on every install, with
nothing to configure. A refusal (forbidden, not found, a conflict, input that
failed validation, a limit) is not an error and writes nothing; neither does
Next's own `notFound()` or `redirect()`. Design:
[error-reporting.md](../design/error-reporting.md).

```
docker compose logs app | grep '"kind":"error.report"'
```

| Field | What it is |
|---|---|
| `source` | Where it was caught: `request`, `action`, `relay`, `dead_letter`, `job`, `agent`, `process` or `browser` |
| `class`, `message` | The error's class. The message only for a class whose messages name code, such as `TypeError`; every other message reads `(message withheld)`, because a message here can quote what somebody typed |
| `fingerprint` | The same for every repeat of one error, across releases |
| `digest` | The reference the error page showed the person. Search for it when somebody quotes one |
| `traceId`, `spanId` | The span it failed inside, with tracing on |
| `route`, `method`, `action` | The route pattern (`/goals/[id]`, never the address), the method, and the action's name |
| `workspaceId`, `memberId`, `userId` | Who was affected, as ids. In the line, never in a metric label |
| `sqlState`, `constraint` | For a database error, instead of its message, which quotes the row |
| `stack` | The frames, with the machine's own directories removed |

One error is reported once, by the first place that catches it, and carries
what the later ones knew: an action that fails inside a page carries the
action's name and the page's digest. A dead letter is always reported, because
giving up on work is its own event.

**Caps.** One error at most ten times a minute and sixty reports a minute in
all. Past either, the error is still counted in `openokr_errors_total` and not
written; one `"kind":"error.report.held"` line a minute says how many were held
back. A broken page under load cannot flood the log.

## Sending errors to a tracker

Only do this if you run a tracker. It is the second thing on this page that
leaves the host. Any tracker that speaks Sentry's protocol works: Sentry,
self-hosted Sentry, GlitchTip or Bugsink. No SDK is involved; the instance
POSTs one small envelope per report.

```
OPENOKR_ERROR_DSN=https://<key>@<tracker host>/<project id>
OPENOKR_ERROR_ENVIRONMENT=production    # the default; staging for a staging instance
```

Copy the DSN from the tracker's project settings and restart. A value that is
not a DSN refuses to boot and names the variable. The DSN is never logged and
never shown on a screen, because its key lets anyone write into your tracker;
in Compose it belongs in `secrets/app.env`, in Helm in a Secret
(`errors.existingSecret`).

| What the tracker receives | What it never receives |
|---|---|
| The class, the safe message (see "Unexpected errors" above), the scrubbed frames, the fingerprint the tracker groups by, the digest, the trace id with tracing on, the release (the version), the environment, `cloud.region`, the route pattern, the action, the method, and the workspace, member or user id as tags | A request body, a query string, a cookie, a header value, a name or email address, rich text, an AI prompt or reply, a provider's response, local variables |

The local floor does not change: every error is still a JSON line and a count.
Sending never slows a request: reports wait in a queue of at most a hundred and
go out every two seconds, each send gives up after three seconds, and a `429`
from the tracker pauses sending for as long as its `Retry-After` says. What
does not arrive is counted in `openokr_error_reports_dropped_total`.

**A tracker's reader may be an AI agent**, through Sentry's MCP server or
Bugsink's API. Text a person typed into the product never reaches the tracker,
so nobody can plant instructions there for it.

## One error the log leaves out

"The destination stream closed early" is not logged unless `LOG_LEVEL` is
`debug`. It means a browser stopped reading a page before the server finished
drawing it. Almost always that is the page's own prefetching, which reads a
screen up to its loading state and cancels the rest, and nothing failed. It
was left out because a single test run logged more than a thousand of them
and real errors were lost among them. If you suspect a proxy is cutting
responses off, set `LOG_LEVEL=debug` and they come back.

## Looking at it: the observability profile

Off unless asked for. `./openokr up` starts three services and none of this.

```
./openokr up                        # writes secrets/observability-token
docker compose --profile observability up -d
open http://localhost:3001          # Grafana, admin/admin on first run
```

The `openokr` target scrapes with the token `./openokr up` wrote (see "Reading
the numbers by hand"); the `caddy` target, the proxy's HTTP series, needs none.

Three dashboards are provisioned from files in
`deploy/docker/observability/dashboards/`, so they are reviewable in a diff
and an edit in the browser is not silently kept.

- **Performance budgets.** The rows this instance can measure from its own
  series, each with its budget drawn as a threshold line.
- **Delivery and the background.** Queue lag, dead letters, nudges, channels,
  scheduled jobs, agent runs, AI spend, and authorisation refusals.
- **Capacity and limits.** Connection pool utilization, concurrent
  actions, admission refusals, outbox backpressure and relay throughput. The
  admission panels read zero on a self-hosted instance with limits at zero,
  which is the correct reading.

Nothing in the profile talks to anything outside the compose network.
Grafana's update check, plugin check, usage reporting and news feed are all
switched off, because a stack whose purpose is to prove an instance can watch
itself without phoning home should not phone home.

Grafana is published on `127.0.0.1:3001` only. Put it behind the same proxy
as everything else if it needs to be reachable from a network.

## Turning on tracing

Only do this if you have somewhere to send spans. It is the one thing here
that leaves the host.

```
OPENOKR_OTLP_ENDPOINT=http://collector:4318/v1/traces
```

With that set, each action runs inside a span carrying the action's name and
the access level it required, and the Operation, the access reads and the
outbox row all nest inside it. A failed span records the error's **class
name**, never its message: an error message from this product can name a goal
or echo a provider's body, and a span leaves the host.

With it empty, no tracer provider is constructed, no exporter object exists,
and no socket is opened.

## What is kept, and for how long

By default, everything anybody wrote. Two kinds of bookkeeping are cleared on
a clock out of the box; the channel message log is cleared only once an
administrator puts a number on it.

| Setting | Default | What it sweeps |
|---|---|---|
| `messageLogRetentionDays` | `0`, meaning keep everything | Rows in the channel message log older than the window |
| `outbox.retentionDays` (`OPENOKR_OUTBOX_RETENTION_DAYS`) | `30` | Outbox rows delivered or given up on longer ago than that, daily at 04:00 UTC. Zero keeps every row |
| `orphanBlobMinutes` | `1440`, a day | Uploads that were started and never attached to anything, daily at 03:20 UTC |

For the message log, zero is off. The sweep reads the setting and returns without touching a row
unless it finds a number, because "not configured" must never mean "delete
everything": an instance upgrading into this feature loses nothing it did
not agree to lose.

The floor is seven days when it does run. A one-day window would delete the
delivery record for a message sent yesterday, which is exactly what somebody
debugging a delivery reaches for.

The sweep runs daily at 03:40 UTC, twenty minutes after the orphan-upload
reap. Both hold a transaction per workspace and both walk every workspace in
turn, so starting them together would double the load on the one minute of
the day an instance does its housekeeping for no benefit. It removes at most
a thousand rows per workspace per run and says whether a backlog remains, so
a workspace turning retention on after a year of messages drains over
several nights rather than holding one transaction open over the lot.

Every sweep writes an audit row carrying the count and the window. It
carries no message and no address: the rows are being deleted for holding
words, so the trail must not keep them.

### What is deliberately never swept

**Nudge records and agent run logs.** These two are not ordinary data: this product requires
that every proactive message it sends is a recorded nudge row carrying a
rule key, a channel, an escalation step and a suppression reason, and an
agent run log is the record of what an agent did on the workspace's behalf.
A retention sweep over either would delete the evidence the product is
required to keep.

**Everything else.** There is no general retention. Check-ins, comments,
decisions, retro notes and every other thing a member wrote stay until
somebody removes them or the member is erased.

## An air-gapped install

Everything on this page works with no outbound network at all. The exposition
is served by the instance to whoever asks it. The profile scrapes over the
compose network. Leave `observability.otlp.endpoint` and
`observability.errors.dsn` empty and nothing in the product has an address to
dial. A tracker on the same isolated network is fine.
