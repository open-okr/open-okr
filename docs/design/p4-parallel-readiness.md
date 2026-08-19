# Phase 4 work allocation

Rewritten 2026-08-19. It answers one question: who can pick up what, right now,
without two people editing the same files.

The previous version of this document (2026-08-14) asked a different question:
how much of the P4-T00 design gate could be drafted before Phase 3 finished. That
question is closed. P4-T00 was approved on 2026-08-17 and all three design
documents exist. The old per-item readiness tables are gone with it. What
replaced them is the chain map below, which is the part people kept coming back
for.

Authority for task cards and dependencies: IMPLEMENTATION-PLAN.md. Live status:
STATUS.md. This document is a reading of both, not a third source. When it
disagrees with either, they win and this gets fixed.

## Where Phase 4 stands

Thirty-eight rows. Counted from STATUS.md on 2026-08-19.

| Status | Rows | Which |
|---|---|---|
| done | 2 | P4-T00, P4-T01a |
| in_review | 12 | P4-T01b to P4-T04c, all in pull request #40, not yet merged |
| in_progress | 1 | P4-T13a |
| todo | 23 | P4-T05a to P4-T15, plus P4-T13b |

Nothing in Phase 4 has reached `main` except P4-T00 and P4-T01a. Everything
marked `in_review` is real, tested and green, and it is one merge away from
being real for everybody else.

## The four chains

Phase 4's tasks form four chains. Within a chain the order is forced. Between
chains there is almost no overlap, which is what makes two people possible.

### Chain A: method and quality

Finished apart from the merge. P4-T01a to P4-T03, thirteen rows, all written.
Nothing here is available to pick up.

Files: `packages/method`, `packages/core/src/quality`, the goal and cycle
surfaces in `apps/web`.

### Chain B1: the agents

| Task | Depends on | Status |
|---|---|---|
| P4-T05a | P4-T04c, P2-T17 | todo, being worked on |
| P4-T05b | P4-T05a | todo |
| P4-T05c | P4-T05b | todo |
| P4-T06a | P4-T05c | todo |
| P4-T06b | P4-T06a | todo |
| P4-T06c | P4-T06b | todo |

Strictly serial: the Champion has to exist before it can sweep, and the Coach
inherits the run machinery the Champion establishes. One person at a time.

Files: `packages/agents`, `packages/core/src/agents`, `packages/core/src/nudges`,
`packages/core/src/workspaces/provisioning.ts`, the admin agent surfaces.

### Chain B2: the sessions

| Task | Depends on | Status |
|---|---|---|
| P4-T07a | P4-T04c, P3-T07 | todo, **available now** |
| P4-T07b | P4-T07a | todo |
| P4-T07c | P4-T07b | todo |
| P4-T08 | P4-T07c | todo |
| P4-T09 | P4-T08 | todo |
| P4-T10a, b, c | the one before it | todo |
| P4-T11a, b, c | the one before it | todo |
| P4-T12 | P4-T11c, P3-T15 | todo |

Thirteen rows, the longest run of work left in the phase, and its head is
unblocked: P4-T04c is written and P3-T07 is done. Chain B2 shares a dependency
with B1 and nothing else. Whoever starts P4-T07a opens the largest remaining
part of Phase 4.

Design source: `docs/design/p4-t00-session-design.md`.

Files: new session tables in `packages/db`, `packages/core/src/sessions`, the
session screens in `apps/web`.

### Chain C: embeddings and copilot

| Task | Depends on | Status |
|---|---|---|
| P4-T13a | P2-T15 | in_progress |
| P4-T13b | P4-T13a | todo |
| P4-T14a | P4-T13b, P1-T07 | todo |
| P4-T14b | P4-T14a | todo |

Independent of A and B entirely. It was independent before Phase 4 began, which
is why it started first.

Files: `packages/core/src/embeddings`, `packages/db/src/schema/embeddings.ts`,
the copilot surfaces in `apps/web`.

### Chain D: the convergence

P4-T15 depends on P4-T14b and P4-T06c. It cannot start until both B1 and C
finish. Nobody should be looking at it yet.

## What to pick up

| Priority | Task | Why |
|---|---|---|
| 1 | Finish P4-T13a | Already `in_progress`, already half written, and every other Chain C task waits behind it |
| 2 | P4-T13b, then P4-T14a and P4-T14b | The rest of Chain C. Touches no file Chain B touches |
| 3 | P4-T07a, then P4-T07b and P4-T07c | Opens thirteen rows. The single highest-leverage start left in the phase |

Also outstanding outside Phase 4: P3-T16 is `in_progress` and P3-T17 is
`in_review`.

## Where two people will collide

Three places, all in Chain B. Agree on them before the second person starts,
not after the merge conflict.

| Collision | Between | What to do |
|---|---|---|
| Blockers | P4-T07c creates the blocker table. P4-T05b reads blocker aging for the daily sweep. The blocker escalation ladder already exists as a pure function in `packages/method/src/escalation.ts`, written at P4-T04c with no table under it | Whoever reaches it second reads the ladder, never rewrites it. The table is P4-T07c's to define |
| The nudge engine | Every rhythm trigger in Chain B1 and every session trigger in Chain B2 records a nudge row through `packages/core/src/nudges/service.ts` | Add rules to the catalogue in `packages/method/src/triggers.ts`. Do not add a second decision path beside `decideSuppression` |
| Migration numbers | Both chains add tables | Take the next free number when you write the migration, not when you plan it, and rebase rather than renumber somebody else's |

## Known gap that outlasts this phase

There is no relay host and no worker process. The outbox is written correctly by
every write path and nothing drains it. `packages/core/src/scoring/recompute.ts`,
`packages/core/src/kpis/formula.ts` and two other files already record this. Any
Phase 4 task that wants scheduled or background work registers it through the
jobs port and gets no execution today. Do not build a private scheduler to work
around it, and do not report a scheduled feature as running.
