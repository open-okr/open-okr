# Error reporting

Status: proposed 9 November 2026 for release 0.7.0 (plan rows E1 to E4). Waiting for "design approved". A new subsystem that can send data off the host, so it is designed first (CLAUDE.md).

**In one sentence:** the product catches its own unexpected errors and records each one locally, and an operator who sets one address sends them to any tracker that speaks Sentry's protocol: Sentry, self-hosted Sentry, GlitchTip or Bugsink.

## 0. What exists

| Piece | Where | Today |
|---|---|---|
| Metrics | `packages/core/src/telemetry/recorder.ts`, `/api/metrics` | Counters by outcome (`ok`, `refused`, `not_found`, `error`) for actions, operations, outbox rows, scheduled runs, channel deliveries and agent runs. A rate, never the error itself |
| Traces | `packages/adapters/src/drivers/telemetry/otel.ts`, `observability.otlp.endpoint` | Opt-in. A failed span records the error's class name only, never its message ([privacy.md](privacy.md)) |
| Error pages | `apps/web/app/error.tsx`, `global-error.tsx` and the per-section `error.tsx` boundaries | Show Next's digest as a reference. Nothing is reported from the browser |
| Server log | `apps/web/lib/relay.ts:71-75`, `apps/web/lib/scheduler.ts:64-68`, and Next's own output | Unstructured text on stdout and stderr. The only place a stack trace exists, and only until the container's log rotates |
| Dead letters | `apps/web/lib/relay.ts:484`, `onDeadLetter` | "The loudest line this process writes", and a log line is all it is |
| Next's hook | `onRequestError` in `instrumentation.ts` (Next 15 and later) | Not exported, so server errors are not captured anywhere |

So on every setup today, an operator learns about an unexpected error from a person, or by reading `docker compose logs app`. Nothing groups errors, counts them by kind, or alerts. On OKRGoal, no AI tool can query them.

## 1. The shape

Four rows. Each layer works without the ones after it.

| Row | Layer | Who gets it | Leaves the host |
|---|---|---|---|
| E1 | Capture, classify, scrub, and the local floor: a JSON log line and a counter | Every install | Never |
| E2 | The `ErrorReporter` port and the Sentry-protocol driver | Whoever sets `OPENOKR_ERROR_DSN` | Only with a DSN |
| E3 | Browser errors, through our own server | Every install; forwarded only with a DSN | Only with a DSN |
| E4 | OKRGoal's tracker, the runbook, and a check by hand against GlitchTip and Bugsink | OKRGoal, and every operator who reads the runbook | OKRGoal's choice |

```
 server render, route, action ─┐
 relay, dead letter, job, agent ┼─> classify ─> scrub ─> report ─┬─> JSON line on stderr        always
 process (unhandled)  ──────────┤   expected?   allow-list        ├─> openokr_errors_total        always
 browser, via /api/client-errors┘   if so, stop                   └─> ErrorReporter driver        with a DSN
                                                                        off | sentry protocol
```

## 2. Decisions

### What is captured

| # | Decision | Why |
|---|---|---|
| D1 | **Only unexpected errors are reported.** Expected: `OperationError` (forbidden, not found, conflict), validation refusals at the boundary (Zod, `RichTextValidationError`), `AdmissionError`, `QuotaExceededError`, `OutboundRefusedError`, `AIEgressRefusedError`, `AIUnavailableError`, the cancelled responses `apps/web/lib/abandoned-responses.ts` already filters, and Next's own control-flow throws (`notFound()`, `redirect()`). One function, `classifyError` in `packages/core/src/errors/`, holds the list | A tracker full of refusals hides the one real failure. The existing metrics already count refusals by outcome |
| D2 | **Capture points:** Next's `onRequestError` (server renders, route handlers, server actions, the proxy); the relay's `onError` and `onDeadLetter`; a scheduled run that throws; an agent run that ends in error; `unhandledRejection` and `uncaughtException` on the process; the browser through E3. The process handlers report, then leave Node's default behaviour unchanged | These are every place an unexpected failure ends up today |
| D3 | **The local floor is always on**, with no setting: one JSON line on stderr for each reported error, and the counter `openokr_errors_total{source}`. `source` is one of `request`, `action`, `relay`, `dead_letter`, `job`, `agent`, `process`, `browser`. The line carries `kind: "error.report"`, the source, the class, the fingerprint, the digest, the trace id, the route pattern, the action name, the version, the workspace id and the scrubbed stack | An instance with no tracker still has a number to alert on and a line any log stack can collect. A JSON line needs no dependency. `source` is a fixed set, so the label stays bounded |

### What a report carries

| # | Decision | Why |
|---|---|---|
| D4 | **An allow-list, never a deny-list.** A report carries: the class name; stack frames (file, function, line, column, and whether the frame is our code); the fingerprint; the digest; the trace and span ids; the release (the `apps/web` version); the environment; `cloud.region`; the route pattern (`/goals/[id]`, never the concrete path or query string); the action name; the HTTP method; the workspace id and member id as tags. **Never** a request body, a query string, a cookie, a header value, a name or email address, rich text, an AI prompt or reply, a provider's response body, or local variables | A field that is not on the list cannot leak by accident when somebody adds a new field to an error |
| D5 | **Messages are withheld unless the class is known to be safe.** Safe: the product's own error classes that declare it, with a `safeMessage` marker; and `TypeError`, `RangeError` and `ReferenceError`, whose messages name code, not data. Every other message becomes `"<class> (message withheld)"`. A Postgres error sends its SQLSTATE code and constraint name, never its message or detail | An error message in this product can name a goal or echo a provider's body, which is why spans already withhold it. `SyntaxError` from `JSON.parse` quotes its input, and a Postgres unique violation's detail quotes the duplicate value, often an email address |
| D6 | **Error text is treated as untrusted input to whoever reads the tracker**, including an AI agent through Sentry's MCP or Bugsink's API. D5 is also the defence here: text a tenant typed never reaches the tracker, so a customer cannot plant instructions for the operator's agent | Indirect prompt injection through error data is a named risk ([Bugsink's guide](https://www.bugsink.com/blog/using-bugsink-with-coding-agents/)). Write the reason beside the rule, so a later change does not relax it without seeing why |
| D7 | **Workspace and member ids are tags in the report and fields in the log line, never metric labels** | A tracker is built to index them. Prometheus keeps every label combination for the life of the process, which is the rule in `recorder.ts` |

### Volume and safety

| # | Decision | Why |
|---|---|---|
| D8 | **We compute the fingerprint:** source, class name, and the file and function of the top three frames in our code, without line numbers. It is sent as the event's `fingerprint` | The same grouping on every tracker, and it survives a release that moves line numbers |
| D9 | **Caps in the process:** one fingerprint at most 10 times a minute, and at most 60 reports a minute in total. Over the cap, the error is still counted and still logged once a minute with how many were held back, but it is not sent | One broken page under load would otherwise spend a tracker's whole monthly quota in minutes. The tracker's own quota and spike protection are the operator's lever; these caps protect the process |
| D10 | **Reporting never blocks and never throws.** A queue in memory of at most 100 reports, sent in batches every 2 seconds or at 20. Each send times out at 3 seconds. When the queue is full, the newest report is dropped and counted in `openokr_error_reports_dropped_total`. A `429` from the tracker is honoured through `Retry-After`, and reports are dropped meanwhile. On shutdown, one last send with a 2-second limit, beside the relay's drain | The same rule `startTelemetry` already follows: an observability feature must never become an availability risk |

### The port and the driver

| # | Decision | Why |
|---|---|---|
| D11 | **A new port, `ErrorReporter`**, in `packages/adapters/src/ports/errors.ts`: `report(event)` and `flush(timeoutMs)`. Two drivers: `off`, the default, which does nothing, and `sentry`, named for the protocol rather than a vendor. The local floor (D3) happens before the port, so it does not depend on the driver | CLAUDE.md: every runtime-sensitive capability goes through a port. A tracker that speaks a different protocol (Rollbar, Honeybadger) is one more driver file and touches no product code. A port of its own, not part of Telemetry, because Telemetry's labels must be bounded and a report carries identifiers |
| D12 | **The driver is a small client we write, not Sentry's SDK.** It builds an envelope with one `event` item and POSTs it to `<dsn host>/api/<project>/envelope/` with the `X-Sentry-Auth` header. No new runtime dependency | The SDK is a new runtime dependency, sets up its own OpenTelemetry beside ours, patches globals, and sends Sentry-only data that GlitchTip and Bugsink may ignore or reject. The subset we need is one HTTP POST of three JSON lines. Question Q1 |
| D13 | **The driver calls the platform `fetch` from inside `packages/adapters`**, like the OTLP exporter and the clamd driver: no redirect followed, 3-second timeout, the response body never read past the status. It does not use the outbound guard's private-address refusal | The guard exists for addresses somebody else chose (`guard.ts:454` says so). The DSN is the deployment's own, set in the environment, never by a tenant, and a self-hoster's GlitchTip most likely sits on a private network the guard would refuse |

### Settings

| # | Decision | Why |
|---|---|---|
| D14 | **`observability.errors.dsn`**: string, empty, from `OPENOKR_ERROR_DSN`. Environment only, with no admin screen, like `scan.clamd.host`. Never logged, because its key lets anyone write into the tracker. A malformed DSN refuses to boot, naming the variable | The DSN belongs to whoever runs the deployment. On a cloud, a workspace admin must never see or change it. Empty means no driver is constructed and no socket is opened |
| D15 | **`observability.errors.environment`**: string, `production`, from `OPENOKR_ERROR_ENVIRONMENT` | So a staging deployment (`deploy/staging`) reports into the same project without mixing with production |

### Browser errors (E3)

| # | Decision | Why |
|---|---|---|
| D16 | **Browser errors go to our own server, never straight to a tracker.** A small client module in the root layout listens for `error` and `unhandledrejection`, and every `error.tsx` boundary calls it once. It POSTs to `/api/client-errors` on the same origin. The DSN never reaches the browser | No third-party script, no change to the content-security policy, it works air-gapped, and nobody can read a DSN from the page and flood the tracker with fake events. One scrub rule for both sides |
| D17 | **The route:** a signed-in session is required, the body is at most 16 KB and validated with Zod, at most 50 frames, and at most 10 reports a minute per member through the Cache port's `rateLimit`. It always answers `204`, including when it refuses. It then classifies, scrubs and reports with `source: browser` | A public write endpoint is an abuse target. Answering the same way every time says nothing about what was accepted. A signed-out page's server errors are still caught by D2 |
| D18 | **Browser frames are resolved to source on the server**, with Node's built-in `SourceMap` from `node:module`, against source maps the build emits. Every tracker then gets readable frames, with no upload step per release | No dependency, and no per-tracker source map upload for a self-hoster to learn. The code the maps reveal is the public repository. E3 measures what the maps add to the image and records it |
| D19 | **Server frames:** turn on server source maps in the build and Node's source map support, so `error.stack` already names source files. E1 measures the cost to boot time and memory, which Next's memory guide warns about. If it is too high, server frames stay as compiled and the function names carry the report | Measure before deciding, because the cost lands on every instance |

### Correlation and the open-source side

| # | Decision | Why |
|---|---|---|
| D20 | **The digest is the join key.** The error page already shows it, the log line carries it, and the report carries it as a tag. With tracing on, the report also carries the trace id | A person can quote what they saw, and the operator finds the same event in the log and in the tracker |
| D21 | **"Copy details" on the error page**: version, digest, time and route pattern, as plain text. The GitHub bug template (`.github/ISSUE_TEMPLATE/bug.yml`) asks for them | A self-hosted instance never reports to the project, because nothing phones home. This is how the project hears about an error: a person chooses to tell it |
| D22 | **A new air-gap checklist row, `errors-off-by-default`**: with no DSN, no reporter driver is constructed and no socket opens. `pnpm check:air-gap` checks it | "Does OpenOKR send anything anywhere by default? No." must stay true and provable |

## 3. What an operator does

| Setup | What they do | What they get |
|---|---|---|
| One company, or air-gapped | Nothing | JSON lines in the log, `openokr_errors_total` on the Grafana dashboards, the digest on the error page |
| One company, wants a tracker | Run GlitchTip, Bugsink or Sentry, set `OPENOKR_ERROR_DSN`, restart | Grouped errors with readable frames, alerts from the tracker |
| On-premises group | The same, once for the instance | The workspace id on each report says which company was affected |
| Another SaaS provider | Their own tracker's DSN in their deployment's secret | The same as OKRGoal, with their tracker |
| OKRGoal | E4 | Sentry, with its MCP, CLI and Seer for AI triage |

Compose: `OPENOKR_ERROR_DSN` and `OPENOKR_ERROR_ENVIRONMENT` join `deploy/docker/compose.yaml` the way `OPENOKR_CLAMD_HOST` does, empty by default. Helm: two values in `values.yaml`, with the DSN read from a Secret key when it is set.

## 4. OKRGoal (E4)

Operations, mostly outside this repository. Nothing below names OKRGoal in product code.

| Step | Detail |
|---|---|
| Sentry project | One project for the cloud, in the region Q3 decides. Staging reports into it with `OPENOKR_ERROR_ENVIRONMENT=staging` |
| DSN | In OKRGoal's deployment secret, never in the repository |
| Releases | When a version is deployed, create the Sentry release for it and link its commits, so a commit that names a Sentry issue (`Fixes OKRGOAL-1A2`) resolves it when that release ships. The release field is already the `apps/web` version (D4) |
| GitHub | Sentry's GitHub integration on `open-okr/open-okr`, with code mappings, so a frame links to its line in the source and an issue can open a GitHub issue |
| Alerts | A new issue in production, and a spike, to whoever is on call |
| AI triage | `claude mcp add --transport http sentry https://mcp.sentry.dev/mcp`, or the Sentry CLI inside the repository |
| Privacy | Sentry is listed as a sub-processor on OKRGoal's privacy page. Retention at most 90 days. D4 and D5 keep what reaches it to identifiers and code |

The runbook section E4 writes, "Sending errors to a tracker", is generic: any DSN, with GlitchTip and Bugsink named as tested. The check by hand runs before release: one GlitchTip and one Bugsink in Docker, one forced error, the issue seen grouped with readable frames in each. The result is written into the runbook with the versions tested.

## 5. Acceptance criteria

**E1**
- Given no DSN, when a server action throws a `TypeError`, then one JSON line with `kind: "error.report"`, source `action`, the class, the digest and the stack is written to stderr, `openokr_errors_total{source="action"}` rises by one, and no outbound request is made.
- Given an action refused with `OperationError` `forbidden`, when it returns, then no error report is written and `openokr_errors_total` does not move.
- Given a dead-lettered outbox row, when the relay gives up on it, then one report with source `dead_letter` carries the topic as a tag and never the row's payload.
- Given a Postgres unique violation whose detail names an email address, when it is reported, then the report carries the SQLSTATE and the constraint name and not the address.
- Given the same error thrown 100 times in a minute, when it is reported, then the counter shows 100 and at most 10 reports reach the reporter.

**E2**
- Given a DSN, when a route handler throws, then within 5 seconds one envelope is POSTed to `/api/<project>/envelope/` with `X-Sentry-Auth`, carrying the class, frames, fingerprint, digest, release, environment and workspace id tag, and no body, query string, cookie or header value.
- Given a DSN whose host does not answer, when an error is reported, then the request that failed answers exactly as it would with no DSN, and the report is counted as dropped.
- Given a tracker answering `429` with `Retry-After: 60`, when more errors arrive within the minute, then none is sent and each is counted as dropped.
- Given `OPENOKR_ERROR_DSN=not-a-dsn`, when the server boots, then it refuses with a message naming `OPENOKR_ERROR_DSN`.
- Given no DSN, when the air-gap check runs, then `errors-off-by-default` passes.

**E3**
- Given a signed-in member, when a client component throws, then the boundary shows the reference and the server reports once with source `browser` and frames resolved to source files.
- Given no session, when anything POSTs to `/api/client-errors`, then it answers `204` and nothing is logged or forwarded.
- Given a member over 10 reports in a minute, when they send another, then it answers `204` and the report is dropped.
- Given any page, when its HTML and scripts are read, then neither the DSN nor the tracker's host appears in them.

**E4**
- Given GlitchTip and Bugsink in Docker, when a forced error is reported to each, then each shows one issue, grouped, with readable frames. Recorded in the runbook with the versions.

## 6. Tests

| Kind | File | Covers |
|---|---|---|
| Unit | `packages/core/test/errors-classify.test.ts` | Expected against unexpected, the message allow-list, the Postgres scrub, the fingerprint |
| Unit | `packages/adapters/test/error-reporter-sentry.test.ts` | The envelope against a recorded fixture, the auth header, batching, the caps, `429`, the timeout, the final send at shutdown, never throwing |
| Unit | `packages/config/test/env.test.ts` (existing) | DSN validation |
| Unit | `apps/web/test/instrumentation-errors.test.ts` | `onRequestError` to the log line and the counter |
| Unit | `apps/web/test/client-errors-route.test.ts` | Session, size, rate, `204`, Zod |
| End to end | `e2e/error-reporting.spec.ts` | A fake tracker in the spec, like the SMTP catcher in `e2e/hosting.ts`, receives the envelope from a forced error. How the spec forces one is settled in E1's build; no route that throws on demand ships enabled in production |
| Gate | `scripts/check-air-gap.ts` | The new row |
| Runbook | The existing test that checks `docs/runbooks/observability.md` against the metric names | The two new metric names |

## 7. Documents changed with the code

| Document | Change | Row |
|---|---|---|
| TECHNICAL-PLAN §4.14 | The two settings. "The only setting that can send measurements off the host" becomes two settings, one for measurements and one for error reports | E2 |
| TECHNICAL-PLAN §5 | An `ErrorReporter` row: `report`, `flush`; Sentry protocol, or off | E2 |
| `docs/runbooks/observability.md` | "The short version" names both settings; "What is measured" gains the two metrics; a new section, "Sending errors to a tracker" | E1, E2, E4 |
| `docs/runbooks/air-gap.md` | The checklist row, and a row in "What needs a connection" | E2 |
| `docs/design/privacy.md` | The telemetry section names the second setting and points here | E2 |
| `docs/runbooks/incident.md` | Triage starts from the digest a person quotes | E1 |
| `.github/ISSUE_TEMPLATE/bug.yml` | Asks for the copied details | E3 |
| Changeset | One per row that a running instance can observe | E1 to E3 |

No schema change, no migration, no table, so no importer mapping row and no `DATABASE.md` change.

## 8. Not in scope

- Performance traces to the tracker. Traces stay on OTLP.
- Session replay, profiling, and a feedback widget.
- Reporting from the `okr` command line and the importer commands. They print their errors to the operator's terminal.
- Alert rules inside the product. The tracker and Grafana own alerting.

## 9. Questions for Akmal

| # | Question | Recommendation |
|---|---|---|
| Q1 | Write the small Sentry-protocol client (D12), or add Sentry's SDK as a runtime dependency? | Write the client. No dependency, no second OpenTelemetry setup, and it sends only what every compatible tracker accepts |
| Q2 | Messages: the allow-list in D5, never send any message, or send every message? | The allow-list. "Never" loses the most useful line of a `TypeError`. "Every" sends tenant data and opens the prompt-injection route in D6 |
| Q3 | Which Sentry region for OKRGoal, EU or US? | The region OKRGoal's database is in, so error data does not cross a border the customer data does not |
