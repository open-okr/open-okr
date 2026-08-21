# The work split: Agung and Obed

Who takes which task, what can run at the same time, and what has to wait.
Rewritten 2026-08-19, after thirteen Phase 4 tasks landed and the tasks were cut
into lettered parts. Updated 2026-08-20 to reflect P4-T05a and P4-T07a through P4-T07c landing.

`IMPLEMENTATION-PLAN.md` is the authority. This file only reads its dependency
lines and turns them into two lanes. If the two ever disagree, the plan wins and
this file gets fixed. `STATUS.md` is the live state; the counts below are a
reading of it on the date above.

This file replaces `docs/design/p4-parallel-readiness.md`, which asked whether
the P4-T00 design gate could be drafted before Phase 3 finished. That question
closed when the gate was approved on 2026-08-17.

## Where things stand

Phase 4 is thirty-eight rows, because P4-T01 to P4-T14 were cut into lettered
parts once P4-T02 and P4-T04 each proved too large for one session.

| Status | Rows | Which |
|---|---|---|
| done | 2 | P4-T00, P4-T01a |
| in_review | 22 | P4-T01b to P4-T06c, P4-T07a to P4-T09 |
| in_progress | 1 | P4-T13a |
| todo | 11 | P4-T10a to P4-T12, P4-T13b, P4-T14a, P4-T14b, P4-T15 |

The agents lane is finished. Every row from P4-T05a to P4-T06c is written and
waiting on a read, which leaves the sessions lane (P4-T09 to P4-T12) and the
retrieval lane (P4-T13a, b then P4-T14a, b) between here and P4-T15.

**The twelve rows from P4-T01b to P4-T04c are all in pull request #40 and have not merged.**
P4-T05a and P4-T07a landed on `obed` and are waiting on a read. Nothing in
Phase 4 is on `main` except P4-T00 and P4-T01a, so anybody branching from
`main` today gets a tree with no quality catalogue, no publish gates and no
nudge engine.

What those fifteen rows delivered, in one line each: the twenty-six quality
checks and their conformance suite (`pnpm method:check`), quality evaluation on
the write path with the Draft Coach and the quality panel, the six publish
gates, the nudge engine with deduplication, quiet hours, suppression reasons,
three escalation ladders and a volume dashboard, the Champion agent and its
hourly run, and the session record with live stage sync.

## The four chains

| Chain | Tasks | Serial? | State |
|---|---|---|---|
| A: method and quality | P4-T01a to P4-T03 | yes | Written, waiting on the merge |
| B1: the agents | P4-T05a, b, c then P4-T06a, b, c | yes | **Complete.** All eight rows in_review. The provider key that blocked P4-T05c-b is installed, and both drafting paths are verified against the live model |
| B2: the sessions | P4-T07a to P4-T12, thirteen rows | yes | P4-T07a to P4-T09 in_review; P4-T10a next |
| C: embeddings and copilot | P4-T13a, b then P4-T14a, b | yes | P4-T13a in_progress |
| D: the convergence | P4-T15 | needs B1 and C | Not startable |

B2 is the critical path. Thirteen rows that cannot be split. P4-T07a landed
and the chain is now moving. Whoever finishes it decides when Phase 4 ends.

## The split

**Agung takes the agents. Agung has taken the sessions too, from 21 August 2026.**

The two-lane plan below is kept as the record of how the phase was scheduled.
It stopped describing the present on 21 August, when the takeover made every
remaining row one person's. What is still true in it is the shape: B2 is the
longest serial run left and it sets the end date, which is why P4-T09 is the
next row rather than P4-T13b.

| Stage | Agung | Obed | At the same time? |
|---|---|---|---|
| now | P4-T05b daily sweep and cycle countdown | P4-T09 monthly review | Yes |
| next | P4-T05c | P4-T10a quarterly session shell | Yes |
| then | P4-T06a, P4-T06b, P4-T06c | P4-T08, P4-T09 | Yes |
| after | P4-T14a, P4-T14b copilot | P4-T10a to P4-T12 | Yes |
| last | P4-T15 assists, which needs both lanes finished | | No |

Ten rows for Agung, fourteen for Obed, and the wall clock is Obed's chain
because B2 cannot be worked by two people at once.

**Why Obed got the sessions rather than the copilot.** The sessions are the
longest serial run left, so they had to start immediately or they set the end
date. The copilot waits behind retrieval anyway.

**The order after the takeover**, one row at a time: P4-T09, P4-T10a to c,
P4-T11a to c, P4-T12, then P4-T13a and P4-T13b, then P4-T14a and P4-T14b, and
P4-T15 last because it needs all of them.

### Agung takes over the sessions lane, 21 August 2026

Agung has taken over every remaining Phase 4 row of Obed's. The rows already
`in_review` keep Obed's name below, because that is who wrote them and the table
is a record rather than a roster. Everything still `todo` is Agung's.

**What this changes in practice.** The file-ownership table below no longer
splits the tree between two people, so the collision rules it lists stop being
about coordination and start being about memory: they are the reasons a
particular shape was chosen, and they still hold. The migration-numbering rule
in particular is now about not colliding with your own earlier branch state
rather than with somebody else's.

The first thing the takeover found was `e2e/sessions.spec.ts` failing in
continuous integration from the day it landed, for two reasons that only a
second environment could expose: it signed in as an account that exists on its
author's machine, and it connected to `openokr_dev` because `DATABASE_URL` is
set for the servers under test and not for the test process. Both are fixed.

### Who owns which row

Every Phase 4 row, with the person planned to take it. This is the planning
statement; `STATUS.md`'s own owner column is the live record and is filled when
a row is actually started. Where the two disagree, STATUS.md is what happened
and this table is what was agreed.

| Task | Title | PIC | Status |
|---|---|---|---|
| P4-T00 | Coaching design gate | Obed | done |
| P4-T01a | The quality catalogue: objective checks | Agung | done |
| P4-T01b | Key result checks and strictness | Agung | in_review |
| P4-T01c | Alignment checks | Agung | in_review |
| P4-T01d | Cycle checks | Agung | in_review |
| P4-T01e | Example pairs and the nudge trigger catalogue | Agung | in_review |
| P4-T01f | Session stages, process health, rhythm diagnostic | Agung | in_review |
| P4-T01g | The conformance suite, `pnpm method:check` | Agung | in_review |
| P4-T02a | Server-side quality evaluation and stored flags | Agung | in_review |
| P4-T02b | The rule verdict component and the strength meter | Agung | in_review |
| P4-T02c | The quality panel across a set | Agung | in_review |
| P4-T03 | Publish gates | Agung | in_review |
| P4-T04a | The nudge table and the due engine | Agung | in_review |
| P4-T04b | Deduplication, quiet hours and suppression | Agung | in_review |
| P4-T04c | Escalation ladders, provenance, volume dashboard | Agung | in_review |
| P4-T05a | The Champion agent and its nudge run | Agung | in_review |
| P4-T05b | The daily sweep and the cycle countdown | Agung | in_review |
| P4-T05c-a | The proposal path, and the recovery proposal | Agung | in_review |
| P4-T05c-b | AI drafting inside the proposal | Agung | in_review |
| P4-T06a | The Coach agent and write-triggered evaluation | Agung | in_review |
| P4-T06b-a | Divergence findings, and the shared reconciler | Agung | in_review |
| P4-T06b-b | The nightly semantic sweep | Agung | in_review |
| P4-T06c | The rewrite assist and the coach surfaces | Agung | in_review |
| P4-T07a | The session record and live stage sync | Obed | in_review |
| P4-T07b | The confidence round | Obed | in_review |
| P4-T07c | Blockers, the board and aging | Obed | in_review |
| P4-T08 | Weekly session: commitments, digest, streaks | Obed | in_review |
| P4-T09 | Monthly review and decision log | Agung | in_review |
| P4-T10a | Quarterly review: the session shell | Agung | todo |
| P4-T10b | Quarterly review: scoring and the reveal | Agung | todo |
| P4-T10c | Quarterly review: narratives and recognition | Agung | todo |
| P4-T11a | Quarterly review: the retros | Agung | todo |
| P4-T11b | Root cause and the process-health survey | Agung | todo |
| P4-T11c | The diagnostic, the reset and next-cycle drafts | Agung | todo |
| P4-T12 | Minutes, exports and review feed-forward | Agung | todo |
| P4-T13a | The embedding table and the outbox worker | Agung | in_progress (blocked behind B2) |
| P4-T13b | Access-filtered retrieval | Agung | todo |
| P4-T14a | Copilot threads and grounded answers | Agung | todo |
| P4-T14b | Copilot proposals and background runs | Agung | todo |
| P4-T15 | Coaching and rhythm assists | Agung | todo, needs both lanes |

**"ready" means the row's dependencies exist in code today.** P4-T05c and
P4-T06a need nothing from the sessions lane. P4-T07a needs nothing from the
agents lane: its dependencies, P4-T04c and P3-T07, are both written. Neither
lane is technically waiting on the other; what a lane waits on is the agreement
in this table.

**If a PIC goes quiet, the rows do not move themselves.** Reassigning is a
decision for the human, recorded here in the same change that starts the work,
so the other lane does not write the same task twice.

### Handoffs

| Handoff | What has to be true |
|---|---|
| Pull request #40 to everything | It merges. Until then both lanes are building on an unmerged branch, and anyone who branches from `main` is missing thirteen tasks |
| P4-T04c to P4-T07c | The three escalation ladders exist as pure functions in `packages/method/src/escalation.ts`. The blocker one has no table under it; P4-T07c is the task that creates it |
| P4-T05b to P4-T07c | **Settled 2026-08-20.** P4-T07c landed `blockers` (migration 0038) hours before P4-T05b needed it, so the daily sweep reads that table and defines nothing. `blockerEscalation` was already the only thing deciding which step fires |

### Three triggers now have their tables and still nothing fires them

Found while merging P4-T08, and recorded here because it is exactly the kind of
gap that falls between two lanes and belongs to neither by default.

| Trigger | Table exists since | What is missing |
|---|---|---|
| `digest.weekly` | P4-T08 (`digests`) | §6.4 addresses it to "Space + leadership" after a session closes. `sessions.close` writes the digest and sends no nudge |
| `commitment.due` | P4-T08 (`commitments`) | Fires at the end of a commitment week, to the owner. Nothing reads the table for it |
| `streak.at_risk` | P4-T08 (`streaks`) | Fires when a week would break the streak, to the coordinator. Nothing reads the table for it |

P4-T05b recorded all three as waiting on P4-T08's tables, and P4-T08 built the
tables without the nudges, each lane correctly staying out of the other's files.
The nudge engine is the agents lane's (`packages/core/src/nudges`), the three
tables are the sessions lane's, and the reader that joins them is one small file
neither task claimed.

**Whoever takes it adds a reader beside `dueSessionNudges` in
`packages/core/src/nudges/rituals.ts` and fires it from the weekly cadence.** It
is not a new decision path: the rule stays "add rules to `triggers.ts`, read
them through `runDueNudgesInTx`, never a second `decideSuppression`". All three
keys are already in the catalogue, so nothing about the method changes.

## Where the two lanes collide

| Collision | Between | The rule |
|---|---|---|
| Blockers | Resolved. P4-T07c created the table, P4-T05b reads it, the ladder was already there | Held: the ladder was read, not rewritten, and no second table was defined. P4-T05b also leaves `escalated_at` and `escalated_to_id` alone, because a nudge reader writing them would record an escalation as though somebody had acted on it |
| The nudge engine | Every rhythm trigger and every session trigger records a nudge through `packages/core/src/nudges/run.ts` | Add rules to `packages/method/src/triggers.ts`. Do not add a second decision path beside `decideSuppression` |
| `packages/method` | Both lanes add rules | Any change is a message to the other lane. It is the one shared package with real risk |
| Migration numbers | Both lanes add tables | The tree is at **0042**; the next free number is **0043**. 0029 is a permanent gap from an earlier collision. **This has now collided twice.** P4-T05b was renumbered 0037 to 0039 after the sessions lane took 0037 and 0038 the same day, and P4-T08 was renumbered 0039 to 0041 during its merge because it was cut from a base that predated 0039 and 0040. Neither author could have seen the other's number, which is why "check before you start" does not work: **the rule is that whoever merges renumbers, and the merge is where the collision is resolved.** Check `ls packages/db/migrations` immediately before you commit as well as when you start |

## File ownership

| Area | Owner |
|---|---|
| `packages/agents`, `packages/core/src/agents` | Agung |
| `packages/core/src/nudges`, the review inbox, the S-36 nudge and volume cards | Agung |
| `packages/method` | Shared. Any change is a message to the other lane |
| Session tables, `packages/core/src/sessions`, screens S-22 to S-25 | Obed until 21 August 2026, Agung after |
| `packages/core/src/embeddings`, the embedding schema and drivers | Obed until 21 August 2026, Agung after |
| Copilot panel S-39 | Agung, once the agents are done |

## Known gaps that outlast this phase

**There is no relay host and no worker process.** Every write path inserts its
outbox rows correctly and nothing drains them.
`packages/core/src/scoring/recompute.ts`, `packages/core/src/kpis/formula.ts`
and two other files already say so in comments.

### The weekly session reads its dates in UTC

Found on 21 August 2026 while building P4-T09, in code P4-T07b and P4-T08
already shipped. Three places compute a calendar date with
`toISOString().slice(0, 10)`:

| Line | Column it feeds |
|---|---|
| `packages/core/src/actions/sessions.ts:738` | `digests.period_start` |
| `packages/core/src/actions/sessions.ts:760` | `streaks.last_session_week` |
| `packages/core/src/actions/sessions.ts:1774` | `commitments.week_start` |

`toISOString` answers in UTC. A session held at six in the morning in Jakarta
is recorded on the previous day, and a session held on a Monday morning there
lands in the previous week. The streak reads a week boundary, so the visible
symptom is a streak that breaks for a team that met on time.

`localDateIn(instant, timeZone)` in `packages/core/src/cycles/generation.ts` is
the shared answer, paired with `workspaceTimeZone`. It is what the cycle engine
uses and what P4-T09 uses for the trend month and the decision date.

Not fixed inside P4-T09: it changes how a streak is counted, which is P4-T08's
behaviour and not this task's to move. It needs a row, and it wants a test that
pins a workspace to a non-UTC zone and holds a session near midnight, because
the bug is invisible in any test that runs in the afternoon.

### The test harness drops a database another worker is still using

Found on 21 August 2026 while verifying P4-T06c. Two consecutive full runs of
`packages/core` failed, 111 tests and then 123, with **no assertion failures at
all**: every failure was Postgres `57P01`, "terminating connection due to
administrator command". A different set of files failed each time.

The cause is in `packages/test-support/src/db-harness.ts`. `workerDb()` names
its database `openokr_test_${project}_w${VITEST_POOL_ID}` and opens with

```sql
drop database if exists <name> with (force)
```

`with (force)` calls `pg_terminate_backend` on every connection to that
database. Vitest reuses pool slot numbers, so when it starts a replacement fork
for slot N while the outgoing fork is still closing its pools, the new fork
deletes the database the old one is still reading. The old fork's connections
die with `57P01` and its file is reported as failed, which is why the failing
file is always one that had just finished rather than one doing anything
unusual.

Caught live in `pg_stat_activity` during a run. One of these drops held for
**18 seconds** on the development machine, which is how wide the window is.

It shows up in two forms and both are the same bug. `57P01` is the outgoing
fork being cut off mid-query. `database "openokr_test_core_wN" does not exist`
is the same fork arriving a moment later, after the drop finished and before
the replacement recreated it. Neither is an assertion, and neither means
anything about the code under test.

**The workaround, until this is fixed.** Cap the workers:

```
TEST_DB_PORT=5432 pnpm --filter @openokr/core exec vitest run --maxWorkers=4
```

Fewer forks means fewer recycles, and it is a workaround rather than a fix: a
run at four workers passed whole once and then failed 17 tests on a later run
with the "does not exist" form. Drop to two when a run comes back red for these
reasons. The suite is slower and it finishes.

**The fix, when somebody takes it.** Put the process id in the database name so
no two forks can ever share one, and sweep orphans scoped to
`openokr_test_${project}_%` in the global setup, before any worker starts. It
was not done inside P4-T06c because it changes the harness every package's
tests run through, and that needs its own row and its own verification across
all of them. Do not read a red `packages/core` run as a real failure until this
is done: check for `57P01` first.

As of P4-T05b there are now **four** declared crons nothing executes: the
Champion's hourly, daily, weekly and per-cycle runs. All four are reachable
through `agents.runChampion` with a `cadence`, which is what the tests drive and
what an administrator can call.

What this means for a Phase 4 task: register scheduled work through the jobs
port, and expect nothing to execute it. Do not build a private scheduler around
it, and do not report a scheduled feature as running. `pnpm cadence:sweep` is
the shape the repository uses meanwhile: a command a human or a cron calls.

## Branch policy

Settled: **everything is committed on `agung`.** No `task/<id>-<slug>` branches,
whatever the loop in CLAUDE.md says. A branch cut from `agung` would stack a
second pull request on an unmerged one, which is not how this repository is
reviewed.

## Open decisions, for the human

1. **METHOD.md §3.6, the forecast on sparse data.** Three values inside two
   days, projected six weeks out, reads 672 for a key result whose target is 60.
   Whether the section should require a minimum span before a forecast is shown
   is a practice decision, not a developer's.
2. **The write-access floor.** The floor is `edit` everywhere except the
   `comments` and `reactions` domains, plus an assertion that no write anywhere
   is reachable at `view`. Recorded on the P3-T16 row and reversible.
3. **A worker host.** Nothing runs scheduled work. Building one touches
   `deploy/docker` and `deploy/helm` and is nobody's task today.

## Rules the merge taught us, which both lanes follow

The first merge of the two lanes brought in six defects. Every one passed
`pnpm typecheck` and `pnpm lint`, because neither can see any of this.

| Command | What only it catches |
|---|---|
| `pnpm db:lint` | A table shipped without `force row level security`, a policy with no `with check`, a query with no soft-delete scope |
| `pnpm check:boundaries` | A write outside the Operation pipeline, a vendor SDK outside `packages/adapters` |
| `pnpm dead-code` | A server action written and never wired to a component |
| `pnpm check:signoff` | A commit without `-s`. It runs on pull requests only, so a branch looks green for days and fails the moment one opens |
| The real-database suite | A write that refuses at run time |

**`enable row level security` is not the tenant floor.** Without `force`, the
table owner bypasses the policy, and the owner is the role migrations run as.
Every policy needs `with check` as well as `using`. Use the missing_ok form,
`nullif(current_setting('app.workspace_id', true), '')::uuid`, so an unscoped
request returns nothing instead of raising.

**A read never has `context.actor.memberId`.** Only `runOperation` resolves an
actor, against rows loaded inside the writing transaction. A read action
resolves the member itself from the user id.

**`set_config(..., true)` is transaction-local.** Outside a transaction it is
discarded the instant the statement that set it commits. Use `withWorkspace`.

**Running the suite on a machine with no Docker.** The harness defaults to the
compose ports, 55432 for Postgres and 56432 for PgBouncer. A native Postgres on
5432 runs everything except the pooling spike:

```
TEST_DB_PORT=5432 pnpm --filter @openokr/core exec vitest run
```

**A design document that gains a `<!-- golden: ... -->` anchor** must also be
registered in the manifest in `packages/test-support/test/golden-table.test.ts`,
with its columns and a row floor. The guard asserts a document holds exactly the
matrices the manifest names, so an unregistered matrix turns CI red.

## AI credentials: what needs them and when

Every deterministic path works with the provider off, and continuous integration
proves it. Credentials verify the AI half; they do not build the product.

| Task | What it needs |
|---|---|
| P4-T13a, P4-T13b | An embedding provider, or a local embedding model |
| P4-T14a, P4-T14b | A chat provider, for streaming answers |
| P4-T05c, P4-T06a to P4-T06c, P4-T15 | A chat provider, to verify drafting and rewriting |
| Everything else | Nothing. Deterministic by design |

Before storing a key: set `OPENOKR_ENCRYPTION_KEY` in `apps/web/.env`. Without
it a fresh root key is generated on every process start, so anything sealed
locally stops opening after a restart.

## The working rules stay the same

Both lanes follow the task loop in `EXECUTION-GUIDE.md` and `CLAUDE.md`.

- A human names the task. Nobody starts the next one on their own.
- Restate the task and confirm the Definition of Ready before writing code.
- Tests first, failing for the right reason.
- One task is one working session and one commit. A task that will not fit gets
  split into lettered parts before more code is written, and
  `IMPLEMENTATION-PLAN.md` is corrected in the same change.
- Update the `STATUS.md` row, including what is **not** done. Only a human sets
  `done`.
- Commit signed off with `-s`. Nobody merges their own work.
