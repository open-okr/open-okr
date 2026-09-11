# Watching an OpenOKR instance

What this instance measures about itself, what leaves the host, and how to
look at any of it.

Written for P7-T06. The series names and the settings below are asserted
against the code by `packages/adapters/test/telemetry.test.ts`, so a claim on
this page that stops being true fails the build rather than misleading the
next operator.

## The short version

| Question | Answer |
|---|---|
| Does OpenOKR send anything anywhere by default? | No. |
| What has to be configured before it measures itself? | Nothing. |
| Where are the numbers? | `GET /api/metrics`, for an instance administrator. |
| What makes data leave the host? | One setting: `observability.otlp.endpoint`. It is empty. |

## Two settings, and they are not the same thing

The distinction matters more than anything else on this page, and conflating
the two is the direct route to an instance that reports home when its
operator believed it did not.

| Setting | Default | What it does |
|---|---|---|
| `instance.telemetry` | off | Anonymous usage reporting **to the OpenOKR project**. Data leaving your instance. Unrelated to everything else here. |
| `observability.metrics` | **on** | This instance measuring itself and serving the numbers at `/api/metrics`. Local. Nothing leaves. |
| `observability.otlp.endpoint` | **empty** | Where to send traces. The only setting in this product that can make a measurement leave the host. |

`observability.metrics` defaults to on because a local endpoint behind an
administrator session sends nothing anywhere, and a product that has to be
configured before it can be watched is a product nobody watches. Turning it
off costs nothing rather than a little: the driver that replaces the meter
does nothing at all, and the gauges' database queries are never run.

Both can be set by environment variable at boot
(`OPENOKR_OBSERVABILITY_METRICS`, `OPENOKR_OTLP_ENDPOINT`) or through the
admin screens. The boot-time read is the environment, deliberately: the meter
is built before the first request and therefore before any query, so reading
the stored row would either block boot on Postgres or leave the first requests
unmeasured.

## Reading the numbers by hand

```
curl -H "Authorization: Bearer $TOKEN" https://your-instance/api/metrics
```

The token comes from `/account/api-tokens` and must belong to a member with
`full` access. Anything else gets a not-found, which is the same answer a
signed-out visitor gets: the endpoint is deliberately not an oracle for
whether this instance is measuring itself.

The body is Prometheus text exposition, `version=0.0.4`.

## What is measured

Sixteen series. Every one is a count, a duration or a queue reading.

**On the request's own thread**

| Series | Labels |
|---|---|
| `openokr_actions_total` | action, outcome |
| `openokr_action_duration_seconds` | action |
| `openokr_operations_total` | action, outcome |
| `openokr_operation_duration_seconds` | action |
| `openokr_authorisation_total` | action, required, outcome |

**After the request has returned, or because a clock said so**

| Series | Labels |
|---|---|
| `openokr_outbox_dispatched_total` | topic, outcome |
| `openokr_outbox_pending` | none |
| `openokr_outbox_oldest_pending_seconds` | none |
| `openokr_outbox_dead_lettered_total` | topic |
| `openokr_job_runs_total` | job, outcome |
| `openokr_job_duration_seconds` | job |
| `openokr_nudges_total` | rule, outcome, channel |
| `openokr_channel_deliveries_total` | provider, outcome |
| `openokr_realtime_events_total` | topic |
| `openokr_agent_runs_total` | trigger, outcome |
| `openokr_agent_run_duration_seconds` | trigger |
| `openokr_ai_tokens_total` | provider, model, direction |
| `openokr_ai_cost_total` | provider, model |

### The two readings that are taken at scrape time

`openokr_outbox_pending` and `openokr_outbox_oldest_pending_seconds` are
queried when you read the endpoint, not written when the relay drains. That
is the only shape that answers the question worth asking. A counter written
during a drain says nothing once draining stops, so a dead relay produces a
flat line and the outage reads as a quiet queue. These two keep climbing.

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

## Looking at it: the observability profile

Off unless asked for. `./openokr up` starts three services and none of this.

```
# one instance administrator token, for Prometheus to read /api/metrics
printf '%s' "$TOKEN" > deploy/docker/secrets/observability-token

docker compose --profile observability up -d
open http://localhost:3001          # Grafana, admin/admin on first run
```

Two dashboards are provisioned from files in
`deploy/docker/observability/dashboards/`, so they are reviewable in a diff
and an edit in the browser is not silently kept.

- **The §13.1 budgets.** The rows this instance can measure from its own
  series, each with its budget drawn as a threshold line.
- **Delivery and the background.** Queue lag, dead letters, nudges, channels,
  scheduled jobs, agent runs, AI spend, and authorisation refusals.

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

## An air-gapped install

Everything on this page works with no outbound network at all. The exposition
is served by the instance to whoever asks it. The profile scrapes over the
compose network. Leave `observability.otlp.endpoint` empty and nothing in the
product has an address to dial.
