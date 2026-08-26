# The work split: Agung and Obed

Who takes which task, what can run at the same time, and what has to wait.
Rewritten 2026-08-19, after thirteen Phase 4 tasks landed and the tasks were cut
into lettered parts. Counts and chain states refreshed 2026-08-26, when Agung
accepted the twenty-nine rows that were sitting in review.

`IMPLEMENTATION-PLAN.md` is the authority. This file only reads its dependency
lines and turns them into two lanes. If the two ever disagree, the plan wins and
this file gets fixed. `STATUS.md` is the live state; the counts below are a
reading of it on the date above.

This file replaces `docs/design/p4-parallel-readiness.md`, which asked whether
the P4-T00 design gate could be drafted before Phase 3 finished. That question
closed when the gate was approved on 2026-08-17.

## Where things stand

Phase 4 is forty-eight rows, because P4-T01 to P4-T15 were cut into lettered
parts once P4-T02 and P4-T04 each proved too large for one session. The latest
is P4-T14a, cut in two on 26 August 2026 when its single [M] turned out to carry
a contract, a citation guarantee and a streaming panel. Counts read on
26 August 2026.

| Status | Rows | Which |
|---|---|---|
| done | 31 | P4-T00, P4-T01a to P4-T06c, P4-T07a to P4-T10b-a |
| in_review | 12 | P4-T10b-b to P4-T12-b, P4-T13a to P4-T14a-b |
| todo | 5 | P4-T14b, P4-T15a to P4-T15d |

The agents lane is finished and read, and **the sessions lane is finished and**
**waiting on a read**: the quarterly review runs all eleven stages, produces its
minutes and hands §8.9's five rows to the next cycle. What is left is the
retrieval lane (P4-T14b) and P4-T15, which needs both.

**`done` here means the row was read and accepted, not that it reached `main`.**
Branch `agung` is fifty-nine commits ahead of `origin/main`, and the only Phase 4
work on `main` is P4-T00 and P4-T01a. Anybody branching from `main` today still
gets a tree with no quality catalogue, no publish gates and no nudge engine. The
twelve rows from P4-T01b to P4-T04c went out as pull request #40 and it has not
merged.

What the twenty-nine rows accepted since P4-T01a delivered, in one line each:
the twenty-six quality checks and their conformance suite (`pnpm method:check`),
quality evaluation on the write path with the Draft Coach and the quality panel,
the six publish gates, the nudge engine with deduplication, quiet hours,
suppression reasons, three escalation ladders and a volume dashboard, the
Champion agent with its four cadences and the proposal path, the Coach agent with
the divergence reconciler and the nightly semantic sweep, and the session record
through the weekly session, the monthly review and the first two stages of the
quarterly review.

## The four chains

| Chain | Tasks | Serial? | State |
|---|---|---|---|
| A: method and quality | P4-T01a to P4-T03 | yes | **Complete.** Accepted, still unmerged |
| B1: the agents | P4-T05a, b, c then P4-T06a, b, c | yes | **Complete.** All eight rows accepted. The provider key that blocked P4-T05c-b is installed, and both drafting paths are verified against the live model |
| B2: the sessions | P4-T07a to P4-T12, seventeen rows | yes | **Complete.** P4-T07a to P4-T10b-a accepted, P4-T10b-b to P4-T12-b written and waiting on a read |
| C: embeddings and copilot | P4-T13a, b then P4-T14a, b | yes | P4-T13a to P4-T14a-b written and waiting on a read; **P4-T14b next** |
| D: the convergence | P4-T15 | needs B1 and C | Not startable |

B2 is the critical path. Nine of its fifteen rows are accepted, three are in
review, three remain, and they cannot be worked in parallel. Whoever finishes
it decides when Phase 4 ends.

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

Agung has taken over every remaining Phase 4 row of Obed's. The rows Obed had
already written keep his name below, because that is who wrote them and the table
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
| P4-T01b | Key result checks and strictness | Agung | done |
| P4-T01c | Alignment checks | Agung | done |
| P4-T01d | Cycle checks | Agung | done |
| P4-T01e | Example pairs and the nudge trigger catalogue | Agung | done |
| P4-T01f | Session stages, process health, rhythm diagnostic | Agung | done |
| P4-T01g | The conformance suite, `pnpm method:check` | Agung | done |
| P4-T02a | Server-side quality evaluation and stored flags | Agung | done |
| P4-T02b | The rule verdict component and the strength meter | Agung | done |
| P4-T02c | The quality panel across a set | Agung | done |
| P4-T03 | Publish gates | Agung | done |
| P4-T04a | The nudge table and the due engine | Agung | done |
| P4-T04b | Deduplication, quiet hours and suppression | Agung | done |
| P4-T04c | Escalation ladders, provenance, volume dashboard | Agung | done |
| P4-T05a | The Champion agent and its nudge run | Agung | done |
| P4-T05b | The daily sweep and the cycle countdown | Agung | done |
| P4-T05c-a | The proposal path, and the recovery proposal | Agung | done |
| P4-T05c-b | AI drafting inside the proposal | Agung | done |
| P4-T06a | The Coach agent and write-triggered evaluation | Agung | done |
| P4-T06b-a | Divergence findings, and the shared reconciler | Agung | done |
| P4-T06b-b | The nightly semantic sweep | Agung | done |
| P4-T06c | The rewrite assist and the coach surfaces | Agung | done |
| P4-T07a | The session record and live stage sync | Obed | done |
| P4-T07b | The confidence round | Obed | done |
| P4-T07c | Blockers, the board and aging | Obed | done |
| P4-T08 | Weekly session: commitments, digest, streaks | Obed | done |
| P4-T09 | Monthly review and decision log | Agung | done |
| P4-T10a-a | Quarterly review: the eleven-stage shell | Agung | done |
| P4-T10a-b | Quarterly review: the room pulse | Agung | done |
| P4-T10b-a | Quarterly review: scoring the key results | Agung | done |
| P4-T10b-b | Quarterly review: the reveal | Agung | done |
| P4-T10c | Quarterly review: narratives and recognition | Agung | done |
| P4-T11a | Quarterly review: the retros | Agung | done |
| P4-T11b | Root cause and the process-health survey | Agung | done |
| P4-T11c-a | The diagnostic and the reset decisions | Agung | done |
| P4-T11c-b | Learnings, next-cycle drafts, decisions and actions | Agung | done |
| P4-T12-a | The minutes and their exports | Agung | done |
| P4-T12-b | Review feed-forward into the next cycle | Agung | done |
| P4-T13a | The embedding table and the outbox worker | Agung | done |
| P4-T13b | Access-filtered retrieval | Agung | done |
| P4-T14a-a | Copilot threads and grounded answers | Agung | in_review |
| P4-T14a-b | The copilot panel | Agung | in_review |
| P4-T14b | Copilot proposals and background runs | Agung | todo |
| P4-T15a | Planning and drafting assists | Agung | todo, needs both lanes |
| P4-T15b | Rhythm assists | Agung | todo |
| P4-T15c | Review assists | Agung | todo |
| P4-T15d | The list filter assist | Agung | todo |

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

### Live stage synchronisation has never worked, and its test could not fail

Found on 21 August 2026 while building P4-T10a-a, in code P4-T07a shipped.

**Nothing published `session.stageChanged`.** The event was declared in
`packages/core/src/sessions/live.ts`, listened for by
`apps/web/hooks/use-session-live.ts`, forwarded by the SSE route at
`/api/session/[id]/live`, and emitted by no code at all.
`sessions.advanceStage` returned the channel name in its result and enqueued
nothing. Every connected client sat on a stale rail until somebody reloaded.

**The test that proved it asserted something always true.** It waited for the
second client to show "Diagnose what is low", which is a weekly step title, and
the rail renders all four titles at every stage. It held before the advance as
well as after it. So P4-T07a's acceptance criterion, "when the facilitator
advances a stage, then both see the new stage without a reload", was never
demonstrated.

**What P4-T10a-a fixed, and what it could not.** `sessions.open` and
`sessions.advanceStage` now insert the outbox row they should always have
written, in the same transaction as the stage change, which is the only way a
side effect may leave a write path. The write path is complete and correct. No
event reaches a browser, because nothing drains the outbox, which is the gap
above.

The test is `test.fixme` rather than deleted or left green, so the claim stays
visible and unmistakably unproven. The quarterly spec reloads the second client
and says why: what it proves today is that the stage change reached the server
and that both clients read the same rail from it.

**Remove the `fixme` when the relay exists.** That is the whole remaining work
for this criterion.

### P4-T07a's closing test is flaky, and the page is why

Found across 21 to 24 August 2026 while verifying P4-T10a and P4-T10b-a.

`facilitator advances through remaining stages and closes` fails roughly one run
in five. The cause is the screen, not the test: a running session calls
`router.refresh()` on every SSE event, so any node can be replaced between being
found and being clicked. It surfaced four different ways, which is why it read as
four problems.

| Symptom | Same cause |
|---|---|
| `net::ERR_ABORTED` on a navigation | A refresh superseded a navigation still in flight |
| The advance loop stopped mid-rail | The button was not rendered yet when asked |
| `count()` returned zero | An instant snapshot taken before the next stage rendered |
| "element was detached from the DOM" | The node was replaced as the click landed |

`networkidle` helps with none of them, because an open event stream never goes
idle. Six attempts got it to four runs in five: each click retried against the
current node, the exit condition split into three states rather than two, and the
close retried on the outcome rather than on the click.

**The monthly and quarterly tests were moved out to `e2e/reviews.spec.ts`**
rather than left behind this. `sessions.spec.ts` is `mode: "serial"`, so while
this test flaked the review tests never ran and P4-T09, P4-T10a and P4-T10b-a had
no end-to-end evidence at all. The weekly test still runs and still fails
sometimes; what changed is that it no longer takes three tasks' verification with
it.

### Two tests asserted the day of the week

Found on 23 August 2026, in code P3-T07 and P3-T08 shipped. Both in
`registration-to-dashboard.spec.ts`:

| Test | Asserted | True until |
|---|---|---|
| `the check-in walker lists only what is actually due` | "Nothing of yours is due." | Friday |
| `a goal reached directly shows its history and refuses a draft` | "This goal is not due" | Friday |

The goal is created during the run with the Monday anchor, and the two-day window
opens on the Saturday. Both tests were green from Tuesday to Friday and red from
Saturday, and they turned red mid-session for no reason but the clock. This is
the third time this class has cost a run in this phase: the quiet-hours nudge
tests failed at 01:39 UTC for the same reason.

Both now assert the promise rather than the branch. The walker's own count has to
match the rows it offers; the composer has to agree with whether the page says the
goal is due. Either branch is correct behaviour, and asserting one of them was
what made the calendar a dependency.

### Three tests in the session spec passed without proving anything

Worth recording as a class, because all three were found in one afternoon and
none of them failed until somebody looked:

| The assertion | Why it could not fail |
|---|---|
| `getByText("Move two engineers…")` after recording a decision | The sentence was in the textarea it had just been typed into, so the assertion went green on the click rather than on the write. The navigation that followed then raced a write that had not landed, which is the whole of the flake that cost five runs to chase |
| `getByText("Diagnose what is low")` on the second client | A weekly step title the rail renders at every stage |
| `for (let i = 0; i < 2; i++)` advancing to the end | Correct only because the test before it advanced once. Marking that test `fixme` left this one a stage short |

A test that cannot fail is worse than one that fails, because a failing test
tells you something.

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

### The test harness dropped a database another worker was still using

**Fixed on 21 August 2026.** Kept here because the shape of the fix only makes
sense with the failure beside it.

Two full runs of `packages/core` failed, 111 tests and then 123, with no
assertion failures at all. `workerDb()` named its database
`openokr_test_${project}_w${VITEST_POOL_ID}` and opened with `drop database
... with (force)`, which terminates every connection to it. Vitest reuses pool
slot numbers, so the replacement fork for slot N deleted the database the
outgoing fork was still reading. It showed up two ways, both meaningless:
Postgres `57P01` when the fork was cut off mid-query, and `database
"openokr_test_core_wN" does not exist` when it arrived a moment later. Caught
live in `pg_stat_activity`; one of those drops held for 18 seconds.

The fix is in `packages/test-support/src/db-harness.ts`:

| Change | Why |
|---|---|
| The database name carries `process.pid` | Nothing can drop a database another process is using |
| No `drop` on the create path; created only when absent | Dropping was the defect. Present means this same process built it for an earlier file, since `close()` clears the cached handle per file |
| `sweepOrphans` in the global setup, keyed on the pid in the name | A run leaks one database per fork; the next run's setup clears them before any worker starts |

**Two things went wrong in the fix itself, and both failed silently.** The
sweep first scoped its pattern with `OPENOKR_DB_PROJECT`, which each Vitest
config sets through `test.env`: that reaches the workers and not the global
setup, so the prefix resolved to `default` and exactly one database was swept
per run while sixty accumulated. Then `escape ''` inside a `String.raw`
template was written as `escape ''`, and an empty escape character makes `\_`
match nothing. Both returned zero rows without raising. The database count
before and against after is the only thing that proved either of them; a green
suite proved nothing.

Result: 62 orphans swept on the next run, two databases left. `packages/core`
passes 61/61 files and 1201/1201 tests at the default twelve workers in **249
seconds**, against 518 at the two workers the workaround needed.

### `pnpm test` at the root ignored `TEST_DB_PORT`

Fixed in the same change. `turbo.json` declared no `passThroughEnv`, so Turbo
filtered the variable out and the harness looked for the Docker stack on port
55432. On a machine without Docker the root command failed with
`ECONNREFUSED 127.0.0.1:55432`, which explains nothing, after running two of
its ten tasks. `TEST_DB_PORT`, `TEST_DB_HOST` and `DATABASE_URL` now pass
through to `test` and `build`.

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
