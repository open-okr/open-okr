# P8-T01a: per-tenant limits and noisy-neighbour protection

Part two of the Phase 8 design gate. Authority: REQUIREMENTS.md §5,
PLAN.md §2 and risk row R8, TECHNICAL-PLAN.md §5 (the ports), §13.1 (the
performance budgets). Implemented at P8-T06 (cloud operations) and read by
P8-T05 (plans and seats).

Part one is `p8-t01a-tenant-lifecycle.md`, which defines the `tenants` row
and the cloud flag this document assumes.

## 0. What already exists

| Component | Where | Ships at | What it already does |
|---|---|---|---|
| `Cache.rateLimit(key, limit, windowSeconds)` | `packages/adapters/src/ports/cache.ts` | P2-T06 | A fixed-window limiter on the cache port, with two drivers. Returns allowed, remaining and reset seconds |
| Edge rate limits | `apps/web/app/api/v1/[[...path]]`, the export download, the CLI device route, channel inbound | P5-T07, P5-T08a, P6-T05 | Per-route limits keyed on the caller, not on the tenant |
| `callAction` | `packages/core/src/actions/registry.ts` | P5-T07 | The one door every surface comes through: the web app, REST, the command line, the agent tool catalogue, the chat commands. Already instrumented there for exactly that reason (P7-T06a) |
| `ai_budgets` | `packages/db` | P2-T14 | A workspace-scoped spend cap. Crossing it disables every AI feature for that workspace, mid-flight |
| The outbox relay and `JobQueue` | `packages/adapters` | P5-T01a | Every side effect. A write path may not enqueue; it inserts an outbox row and the relay enqueues after the commit |
| The §13.1 budgets and their harness | `pnpm perf:budgets`, `pnpm perf:load` | P7-T01b, P7-T02 | Eight measured rows, and a load run with seven weighted scenarios judged against their own ceilings |
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
  -> 0. tenant admission   (added at P8-T06, cloud flag only)
     1. metrics span       (exists, P7-T06a)
     2. the action handler (exists)
        -> runOperation    (exists: freeze, authorise, one transaction)
```

Admission runs before the span opens, so a refused call costs one cache
round trip and no database connection at all. That ordering is the point:
a limiter that takes a pool slot to decide it should not have taken a pool
slot has not limited anything.

**Given** a tenant over its admission limit,
**when** any of its members calls any action from any surface,
**then** the call is refused before a connection is taken, the refusal
names the reset time, and no other tenant's latency moves.

## 4. The four limits, as settings with working defaults

Every one of these is a §4.14 settings-map entry at instance scope,
because it describes the deployment rather than the customer. Every one
defaults to unlimited, and the cloud flag is what turns them on.

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
validation refuses a value between 1 and some small minimum, so an
operator cannot set 1 and wonder why the product stopped.

## 5. Noisy-neighbour protection, which is a different problem

A limit stops one tenant from exceeding a ceiling. It does not make the
sharing fair below that ceiling, and two of the four resources need
fairness rather than a ceiling.

**The queue is FIFO and that is the unfair part.** One import writing
forty thousand outbox rows puts every other tenant's nudge behind forty
thousand jobs, and not one of those jobs exceeded any limit. The fix is in
the relay, not in a limit: the relay reads outbox rows **round-robin by
workspace** rather than by insertion order, taking a bounded slice per
workspace per pass. A tenant with forty thousand rows still gets through
them; it just stops being first forty thousand times running.

This changes the relay's read, so it is the one part of this design that
touches shipped code on the self-hosted path. It is a fairness
improvement there too, between a workspace that just ran an import and the
other workspaces on the same self-hosted instance, so it is not flagged by
the cloud flag and runs everywhere.

**The pool needs a ceiling that is not a limit.** `apps/web/lib/pool.ts`
sets no `max`. It should, on every deployment, cloud or not, because the
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
settings read, and every default is unlimited. With `cloud.enabled` false
the admission step is a single comparison against zero, which returns
immediately.

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
   **then** all eight measured rows are unchanged from their Phase 7 figures.
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
| 2 | Whether limits vary by plan | That is PLAN.md §13 #1 territory and it is a human's call. The design holds the limits at instance scope, so making them per-plan later means reading the tenant's plan in one function rather than reshaping anything |
| 3 | The pool `max` default | Named as a gap here and proposed as an environment setting. Changing it changes behaviour on every existing deployment, so it wants its own decision rather than riding in on a cloud task |
| 4 | Whether the relay's round-robin read should ship before Phase 8 | It is a fairness fix that helps self-host too, and it is the one part of this design that touches code on the shipped path. It could reasonably be its own task in Phase 7's tail rather than waiting for P8-T06 |
| 5 | A public status surface and per-tenant backup verification | Both are in P8-T06's deliverables and neither is a limit. They need their own design, and it is not written here because this document is about contention |
