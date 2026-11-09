# Per-tenant limits and noisy-neighbour protection

Part two of the Phase 8 design gate. Authority: REQUIREMENTS.md §5,
PLAN.md §2 and risk row R8, TECHNICAL-PLAN.md §5 (the ports), §13.1 (the
performance budgets). Implemented at P8-T06 (cloud operations) and read by
P8-T05 (plans and seats).

Part one is `tenant-lifecycle.md`, which defines the `tenants` row
and the cloud flag this document assumes.

## 0. What already exists

| Component | Where | Ships at | What it already does |
|---|---|---|---|
| `Cache.rateLimit(key, limit, windowSeconds)` | `packages/adapters/src/ports/cache.ts` | P2-T06 | A fixed-window limiter on the cache port, with two drivers. Returns allowed, remaining and reset seconds |
| Edge rate limits | `apps/web/app/api/v1/[[...path]]`, the export download, the CLI device route, channel inbound | P5-T07, P5-T08a, P6-T05 | Per-route limits keyed on the caller, not on the tenant |
| `callAction` | `packages/core/src/actions/registry.ts` | P5-T07 | The one door every surface comes through: the web app, REST, the command line, the agent tool catalogue, the chat commands. Already instrumented there for exactly that reason (P7-T06a) |
| `ai_budgets` | `packages/db` | P2-T14 | A workspace-scoped spend cap. Crossing it disables every AI feature for that workspace, mid-flight |
| The outbox relay and `JobQueue` | `packages/adapters` | P5-T01a | Every side effect. A write path may not enqueue; it inserts an outbox row and the relay enqueues after the commit |
| The §13.1 budgets and their harness | `pnpm perf:budgets`, `pnpm perf:load` | P7-T01b, P7-T02 | Nine measured rows, and a load run with seven weighted scenarios judged against their own ceilings |
| Metrics, traces and the operator dashboards | `packages/adapters/src/drivers/telemetry` | P7-T06a to c | Per-action duration and outcome, queue depth and relay liveness |

**What does not exist.** No per-tenant limit of any kind. No fair sharing
of the connection pool, the queue or the processor. `apps/web/lib/pool.ts`
sets no `max`, so every web process runs on `pg`'s default of ten
connections shared by whoever asks first.

**The measured baseline, from P7-T02 on 10 September 2026.** Twenty
concurrent members on the full §13.1 dataset held every scenario inside
its ceiling, at 43.7 calls a second, with a pool of twenty. Twenty-five
put the drag on the line. Fifty saturated the processor rather than any
one query. Those are the numbers a limit has to keep true when one tenant
is the one asking.

## 1. The decision this document exists to make

Two things get called a limit and they are not the same thing.

| | Protects | Fails towards | Lives |
|---|---|---|---|
| A **resource limit** | The instance, from one tenant | Slowing that tenant down | Everywhere, including self-host, where it is unlimited |
| A **plan limit** | The price | Refusing to add a seat | Cloud only, behind the flag, and it is P8-T05's |

This document is entirely about the first. The second is named here only
so nobody builds one mechanism for both and discovers later that turning
off billing turned off the protection.

**The decision: a resource limit is not a product feature, so it is not
gated, not priced, and not visible on a pricing page.** It has one job,
and P8-T06's acceptance criterion states it exactly:

> Given one tenant generating heavy load, when limits engage, then other
> tenants stay inside their performance budgets.

Every design choice below follows from reading that sentence literally.
The subject is the *other* tenants. The heavy tenant being slowed is the
cost, not the goal. A design that protected the instance by refusing the
heavy tenant's writes would meet the letter and break the product.

## 2. What is actually contended

A limit on the wrong resource is decoration. These are the four that one
tenant can take from another, in the order P7-T02 found them mattering.

| # | Resource | How one tenant takes it | What it costs everyone else |
|---|---|---|---|
| 1 | **Database connections** | A burst of list reads, each holding a pool slot for the length of its query | Every other tenant's request queues behind it. This is the one that turns a 164ms feed into a timeout |
| 2 | **Processor** | Alignment recompute, the cascade, a large export build | Latency across every scenario at once, which is what fifty concurrent members looked like |
| 3 | **Queue capacity** | Thousands of outbox rows from one import or one cascade | Another tenant's nudge, digest or channel message waits behind them in a FIFO queue |
| 4 | **AI spend** | Agent runs and copilot threads | Money, and the provider's own rate limit, which is shared across tenants |

Bytes are a fifth and they are deliberately not in this list. Storage
grows, it does not contend: one tenant's blobs do not slow another
tenant's read. A storage quota is a plan limit, so it is P8-T05's.

## 3. Where the limit goes, and why there is only one place

`callAction` is the one door. The registry's own comment says why it is
instrumented there rather than per action:

> This is the one door every surface comes through: the web app, the REST
> projection, the command line, the agent tool catalogue and the chat
> commands. An action instrumented at its own definition would be measured
> once per definition and missed entirely by whichever one forgot.

The identical argument applies to a per-tenant limit, with one addition
that makes it stronger. The existing edge limits live in HTTP route
handlers, so an agent calling a tool over the agent protocol, a member
typing a slash command in Slack and a scheduled job are all unlimited
today. A limit at the edge protects the edge. A limit at `callAction`
protects the database.

**The shape.**

```
callAction(context, name, input)
  -> 0. tenant admission   (added at P8-T06, unlimited until a limit is set)
     1. metrics span       (exists, P7-T06a)
     2. the action handler (exists)
        -> runOperation    (exists: freeze, authorise, one transaction)
```

Admission runs before the span opens, so a refused call costs one cache
round trip and none of the action's own work. With the in-process cache
driver that is no database connection at all; with the Postgres driver,
which `apps/web/lib/cache.ts` builds on the application's own pool, it is
one short indexed upsert. That ordering is the point: a limiter that takes a
pool slot for the whole of an action to decide it should not have run has
not limited anything.

**Given** a tenant over its admission limit,
**when** any of its members calls any action from any surface,
**then** the call is refused before a connection is taken, the refusal
names the reset time, and no other tenant's latency moves.

## 4. The four limits, as settings with working defaults

Every one of these is a §4.14 settings-map entry at instance scope,
because it describes the deployment rather than the customer. Every one
defaults to unlimited, and setting a number is what turns it on. The limits
are resolved once at boot, so a change takes effect on the next restart.

| Setting | Default | Resolves to in the cloud | Guards |
|---|---|---|---|
| `cloud.limits.actionsPerMinute` | 0 (unlimited) | A number the operator sets | Connections and processor, resource 1 and 2 |
| `cloud.limits.concurrentActions` | 0 (unlimited) | A small integer per tenant | Connections, the burst case a per-minute window cannot see |
| `cloud.limits.outboxRowsPerMinute` | 0 (unlimited) | A number the operator sets | Queue capacity, resource 3 |
| AI spend | Already `ai_budgets`, workspace scope | The plan's cap, written to the existing row | Resource 4 |

**AI spend gets no new mechanism at all.** `ai_budgets` already holds a
workspace-scoped cap whose breach disables AI for that workspace
mid-flight. The cloud writes the plan's number into that row at
provisioning. TECHNICAL-PLAN §4.14 already says this is the arrangement:
"No workspace cap on self-host; the tenant's plan cap in the cloud."

**`concurrentActions` exists because a per-minute window cannot see a
burst.** Sixty calls spread over sixty seconds and sixty calls in one
second both pass a per-minute limit, and only the second one empties the
pool. The counter is a cache increment taken on entry and released in a
`finally`, so a crashed process leaks at most its own in-flight count and
the key's own time to live cleans it up.

**Zero means unlimited, and that is on purpose.** It matches
`messageLogRetentionDays` and it means a self-hosted instance that never
reads this document is never limited by a number nobody chose. The floor
validation refuses a value between 1 and a floor (60 actions a minute, 2
concurrent actions), so an operator cannot set 1 and wonder why the product
stopped.

## 5. Noisy-neighbour protection, which is a different problem

A limit stops one tenant from exceeding a ceiling. It does not make the
sharing fair below that ceiling, and two of the four resources need
fairness rather than a ceiling.

**The queue is FIFO and that is the unfair part.** One import writing
forty thousand outbox rows puts every other tenant's nudge behind forty
thousand jobs, and not one of those jobs exceeded any limit. The fix is in
the relay, not in a limit: the relay reads outbox rows **round-robin by
workspace** rather than by insertion order. A tenant with forty thousand
rows still gets through them; it just stops being first forty thousand
times running.

This changes the relay's read, so it is the one part of this design that
touches shipped code on the self-hosted path. It is a fairness
improvement there too, between a workspace that just ran an import and the
other workspaces on the same self-hosted instance, so it is not flagged by
the cloud flag and runs everywhere.

**Built at P8-T06b, and two lines of this section were wrong.** Recorded
here rather than left for a reader to find by diffing the code:

| What this section said | What was built, and why |
|---|---|
| "round-robin by workspace", with no partition key named | `outbox` had ten columns and none of them was a workspace. Migration 0090 adds `workspace_id`, defaulted from the transaction's own `app.workspace_id` setting, so `enqueueOutbox` and its call sites do not change and no write path can forget it. Agung chose that on 15 September 2026 over partitioning on `payload->>'workspaceId'`, which no index can serve cheaply and which is absent on the rows an action spec supplies through `outcome.outbox`. The column is nullable, is never backfilled, and **authorises nothing**: the table stays `openokr:not-tenant-scoped`, because only the relay reads it and it must drain every workspace in one pass |
| "taking a bounded slice per workspace per pass" | No cap was built, and the cap is what criterion 7 forbids. Each workspace's pending rows are ranked by age and the batch is ordered by rank, so it takes rank one of every workspace, then rank two. With one workspace holding rows every rank is distinct and ascending, which is the old order exactly and the old throughput exactly. A slice of, say, five per workspace would have capped that instance at five rows a pass for nothing |
| Nothing said about the tenant floor | Two test files defined "tenant-scoped" as "has a `workspace_id` column", which stopped being true the moment `outbox` gained one. The marker in migration 0001 is now the single authority, read by `db:lint` and by both tests through `notTenantScopedTables`. **The gap this does not close**: `outbox` has no row-level policy and its payloads carry workspace and entity identifiers, so an operator connection can read them, as it could before this column existed. That is P8-T01b's question |

**The pool needs a ceiling that is not a limit.** `apps/web/lib/pool.ts`
set no `max`. It should, on every deployment, cloud or not, because the
default of ten is an accident rather than a decision and P7-T02 measured
twenty as the working number on one machine. The pool size becomes an
environment setting with a documented default, and the per-tenant
`concurrentActions` sits below it so no single tenant can hold every slot.

**The processor gets no mechanism here.** Nothing in this design can stop
a tenant's alignment recompute from being expensive. What it can do is
stop the recompute from being run a thousand times a minute, which
`actionsPerMinute` does, and P7-T02a already took the audit chain off the
write path for the same reason. If a single call is too expensive, that is
a §13.1 budget failure and it belongs to whichever task owns the query.

## 6. What a member sees when a limit engages

The rule is that no work is lost and nothing is silently dropped.

| Surface | What happens |
|---|---|
| The browser | The action returns the existing `rate_limited` refusal, the interface shows the reset time in seconds, and an optimistic update rolls back rather than appearing to have saved |
| REST and the command line | 429 with `Retry-After`, which the two edge limiters already emit, so the shape is not new |
| The agent protocol and chat | The same refusal, carried as the tool's error, with the reset time in it. An agent that retries after the window succeeds |
| A queued job | **Never refused.** A job that would breach the outbox rate is delayed by the relay, not dropped. Losing a nudge to a rate limit would break the rule that every proactive message is a recorded nudge row |
| An outbox row | **Never refused.** It is written inside the caller's transaction and the transaction has already been authorised. Refusing it would mean a committed change with its side effect thrown away |

**Given** a tenant whose outbox rate is over the limit,
**when** the relay runs,
**then** it delivers its bounded slice, leaves the rest, and the next pass
takes the next slice. Queue depth rises and falls and nothing is lost.

## 7. Self-host is unlimited, through the same code

There is no second code path. Every limit above resolves through the same
settings read, and every default is unlimited. Admission is installed on
every instance, and with both limits at zero, which is every self-hosted
instance, it returns on two comparisons against zero.

**Given** a self-hosted instance,
**when** any action is called,
**then** admission reads the resolved limits, finds them unlimited,
returns, and the call proceeds exactly as it did in Phase 7.

This is the same arrangement the lifecycle document uses for
`seedTenantInTx`, and for the same reason: a branch that is present and
cheap is safer than a branch that is absent, because the absent one is the
one nobody tests.

## 8. Acceptance criteria

Written as the test plan P8-T06 inherits.

1. **Given** two tenants on one instance and one of them driven by
   `pnpm perf:load` at a rate above its limit, **when** the second tenant's
   seven §13.1 scenarios are measured, **then** every one is inside its own
   ceiling. This is P8-T06's acceptance criterion and it is the only test
   that actually proves the design.
2. **Given** a tenant at its concurrency limit, **when** another of its
   members calls an action, **then** the refusal happens before a pool
   connection is taken, proved by the query-count budget from P7-T01a
   reporting zero statements for that call.
3. **Given** a self-hosted instance, **when** the whole §13.1 sweep runs,
   **then** all nine measured rows are unchanged from their Phase 7 figures.
4. **Given** an import writing forty thousand outbox rows in one workspace,
   **when** a second workspace's nudge is enqueued behind it, **then** the
   nudge is delivered within its own window rather than after the import.
5. **Given** any limit set to zero, **when** a tenant makes any number of
   calls, **then** none is refused.
6. **Given** a limit breach on the agent protocol and on a chat command,
   **when** each is refused, **then** both carry the reset time, because a
   surface that refuses without saying when is a surface that gets retried
   in a loop.
7. **Given** the relay's round-robin read, **when** one workspace has rows
   and the others do not, **then** it delivers that workspace's rows at full
   speed, because fairness must not cost throughput when there is nobody to
   be fair to.

## 9. Open, and not decided here

| # | Question | Why it is not answered here |
|---|---|---|
| 1 | The actual numbers for each limit | They depend on the instance size a real cloud runs, which nobody has measured because no cloud exists. P7-T02's twenty concurrent members is a per-machine figure, not a per-tenant one. The settings exist so the numbers are operations rather than design |
| 2 | Whether limits vary by plan | That is PLAN.md §10 #1 territory and it is a human's call. The design holds the limits at instance scope, so making them per-plan later means reading the tenant's plan in one function rather than reshaping anything |
| 3 | ~~The pool `max` default~~ **Answered at P8-T06b** | `OPENOKR_DB_POOL_MAX`, default twenty, which is P7-T02's measured figure rather than a round number: twenty concurrent members held every §13.1 budget and twenty-five put the drag on the line. It does change behaviour on every existing deployment, upward, from the ten `pg` picks by itself |
| 4 | ~~Whether the relay's round-robin read should ship before Phase 8~~ **Answered by events** | It did not ship in Phase 7's tail. It shipped at P8-T06b with the partition key decided there, and it runs on every deployment rather than behind the cloud flag |
| 5 | A public status surface and per-tenant backup verification | Both are in P8-T06's deliverables and neither is a limit. They need their own design, and it is not written here because this document is about contention |

## 10. The outbox rate (release 0.7.0, P6 and P7)

Status: proposed 9 November 2026 for release 0.7.0 (plans P6 and P7), waiting for "design approved". Shared infrastructure on every deployment, so it is designed first. P6 is the setting and P7 is the relay; one cannot be built without the other, so they are one change.

### 10.1 What exists

| Piece | Where | Today |
|---|---|---|
| The fair read | `packages/adapters/src/relay.ts:474-491` | Ranks every due row by age within its workspace and takes rank one of every workspace, then rank two. No cap of any kind |
| The claim | `packages/adapters/src/relay.ts:497-517` | Locks the first `batchSize` candidates nothing else holds, counts an attempt and leases them |
| The relay's options | `packages/adapters/src/relay.ts:76-120`; built in `apps/web/lib/relay.ts:468` | No limit. The package cannot read settings: the host passes what it resolved |
| The lag | `OutboxRelay.oldestPendingSeconds`, `packages/adapters/src/relay.ts:275`; read by `apps/web/app/api/status/route.ts:75` against `status.relayDegradedSeconds` (300) and `status.relayUnavailableSeconds` (1800) | The oldest undelivered row of any workspace |
| Admission | `packages/core/src/tenancy/admission.ts`; resolved once at boot by `resolveAdmissionLimits` (`packages/core/src/tenancy/settings.ts:116`), installed by `apps/web/lib/admission.ts:36` | Two limits, 0 meaning unlimited, refused between 1 and a floor (60 actions, 2 concurrent). Counted through the cache port's fixed window, keyed by workspace |
| The two limit settings | `packages/core/src/secrets/instance-registry.ts:197-212` | `cloud.limits.actionsPerMinute`, `cloud.limits.concurrentActions`. No outbox setting |
| `outbox.workspace_id` | Migration 0090 | Taken from the transaction's tenant setting. Null for rows written outside one. The table is not tenant-scoped (marker in migration 0001) and has no row policy |

### 10.2 Decisions

| # | Decision | Why |
|---|---|---|
| R1 | **P6: `cloud.limits.outboxRowsPerMinute`**, instance scope, environment `OPENOKR_CLOUD_OUTBOX_ROWS_PER_MINUTE`, **default 0, meaning unlimited.** Refused between 1 and 59. Resolved at boot with the other two and validated by the same function | §4's arrangement: zero is unlimited, a number nobody chose never limits anybody, and a tiny number is an outage, not a limit. Sixty is one row a second, the same floor as actions |
| R2 | **What counts is a claim, not an insert.** A row counts against its workspace each time the relay claims it, retries included, over a sliding sixty seconds | Inserting is never refused (§6). What contends is delivery capacity, resource 3, and a retry uses it as much as a first attempt |
| R3 | **Counted in Postgres, on the outbox itself.** A new column, `outbox.claimed_at`, written by the claim. One grouped count over the last minute, run only when the limit is set | The outbox already holds every claim, so a second counter would be a second record that can drift. Admission uses the cache port because it runs before an action has a connection; the relay already holds one. Every relay process reads the same rows, so they agree |
| R4 | **Migration**, the next free number: `outbox.claimed_at timestamptz`, and an index on it `where claimed_at is not null`. No row policy, as for the rest of the table | Without the index the count scans every row kept for `outbox.retentionDays` |
| R5 | **Unlimited is today's path.** With the limit at 0 the claim writes no `claimed_at`, no count runs and the ranking is today's statement. The index stays empty | Every self-hosted instance. §8 criterion 7 and the rule that fairness must not tax an instance with nobody to be fair to |
| R6 | **What "delay" means.** With the limit set, the ranking admits from each workspace only `limit` minus its claims in the last minute, by rank. A workspace with nothing left offers no candidates this pass. Its rows are not touched: no attempt counted, `available_at` unchanged | Nothing is lost and nothing is reordered. A held row cannot reach `maxAttempts` by waiting, so waiting never dead-letters it |
| R7 | **Order and fairness.** Within a workspace, age order, as today. Between workspaces, the round robin, as today, among those with budget. When a held workspace has budget again, its oldest row is rank one | The limit only removes candidates. Everything §5 settled about order stays true |
| R8 | **Rows with no workspace are never held** | They belong to no tenant, so no tenant's rate applies |
| R9 | **Two relays can overshoot, by a bounded amount.** Two that rank in the same instant see the same remaining budget, so a workspace can get up to one extra batch per extra relay in that pass. The next pass counts it | The limit protects other tenants' latency; nobody is billed by it. Serialising relays to make it exact would cost every tenant throughput |
| R10 | **The lag ignores rows held by the rate.** With the limit set, `oldestPendingSeconds` (the gauge and `/api/status`) leaves out workspaces at their rate now. With 0 the query is today's | Otherwise the limit doing its job reads as an outage: forty thousand rows at 600 a minute is 67 minutes, well past the 1800-second line. The relay is keeping up with everything it is allowed to deliver |
| R11 | **The metric.** Two gauges read at scrape time, like the existing two, with no workspace label: `openokr_outbox_rate_held_workspaces` and `openokr_outbox_rate_held_rows` (due rows waiting only because of the rate). Each answers 0 without a query when the limit is 0. A panel on the capacity dashboard | What an operator needs is whether the limit is engaging now and how much it holds. A workspace label is unbounded (P7-T06b) |
| R12 | **Self-hosted is unaffected**, and not because of the cloud flag: the default is 0. An operator of any instance may set it, as with the other two limits (§7) | One code path |

### 10.3 Open questions

None new. §9's first two stay open: the numbers a real cloud runs, and whether a limit varies by plan.

### 10.4 Acceptance criteria

- Given the limit at 600, workspace A with 5,000 due rows and workspace B with 10, when the relay runs for one minute, then B's ten rows go in the first pass and A has no more than 600 claims plus the R9 bound.
- Given A at its rate, when a pass runs, then A's waiting rows keep their `attempts` and `available_at`.
- Given A held for two hours, when the relay runs, then none of A's rows is dead-lettered by waiting, and all are delivered.
- Given the limit at 0, when the relay claims, then `claimed_at` stays null, no count query runs, and the claim order matches today's for the same rows.
- Given the limit at 0 and one workspace with rows, when the relay runs, then its throughput is today's (§8 criterion 7).
- Given rows with no workspace, when every workspace is at its rate, then those rows are still claimed.
- Given `OPENOKR_CLOUD_OUTBOX_ROWS_PER_MINUTE=30`, when the server boots, then it refuses, naming the key and the floor.
- Given A held for forty minutes and nothing else pending, when `/api/status` is read, then the relay is operational and `openokr_outbox_rate_held_rows` is above zero.
- Given two relays draining at once with the limit at 600, when one minute passes, then A has at most 600 plus one batch of claims.

### 10.5 Tests

| Kind | File | Covers |
|---|---|---|
| Integration | `packages/adapters/test/relay.test.ts` (existing) | The budget, the held rows untouched, null workspace, unlimited unchanged, two relays |
| Unit | `packages/core/test/admission.test.ts` (existing) | The third limit's floor and zero |
| Unit | `apps/web/test/status-endpoint.test.ts` (existing) | The lag ignores held rows with the limit set |
| Unit | `packages/adapters/test/telemetry.test.ts` (existing) | The two gauge names agree between the relay and `METRIC` |
| Load | `pnpm perf:load` | §8 criterion 4 with the limit set: a second workspace's nudge inside its window |

### 10.6 Documents changed in the same change

- This document: §4's table (the default and floor), §6's queued-job row cites R6, §8 gains the criteria above.
- TECHNICAL-PLAN §4.14: the setting beside the other two limits. §5: the outbox contract gains the rate.
- DATABASE.md: `outbox.claimed_at`.
- `docs/runbooks/observability.md` and the capacity dashboard: the two gauges and what they mean.
- `docs/install/cloud.md`: the variable.
- `docs/runbooks/upgrade.md`, "0.6 to 0.7": one additive migration on `outbox`, nothing to choose.

### 10.7 What this does not do

- No refusal of any insert, and no row dropped.
- No per-plan or per-workspace number. One instance-wide number, as §9 #2 leaves it.
- No change to the order on an instance with the limit at 0.
- No new service: Postgres only, no cache key.
