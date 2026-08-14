# The work split: Agung and Obed

Who takes which task, what can run at the same time, and what has to wait.
Covers the rest of Phase 3 and all of Phase 4. Written 2026-08-14.

`IMPLEMENTATION-PLAN.md` is the authority. This file only reads its dependency
lines and turns them into two lanes. If the two ever disagree, the plan wins and
this file gets fixed.

## Phase 3: the last four tasks

| Task | Size | Owner | Depends on | Can start |
|---|---|---|---|---|
| P3-T14 KPI trees, corridors, recovery OKRs | L | **Agung** | P3-T13, P3-T05 | Now |
| P3-T15 Scorecard, cycle archive and feed-forward | M | **Agung** | P3-T05, P3-T12 | Now |
| P3-T16 Comments, reactions and discussion wiring | M | **Obed** | P3-T01, P2-T07 | Now |
| P3-T17 Demo workspace builder and seed | M | **Obed** | P3-T15 | After Agung's P3-T15 |

Three of the four can start today. Only P3-T17 waits, and it waits on the other
lane.

### Two things about P3-T17 worth settling before it starts

**Its declared dependency understates what it needs.** The plan lists P3-T15
only, but its own deliverables name "KPI trees with one unhealthy KPI and an
active recovery OKR", which is P3-T14's work. In practice P3-T17 needs both of
Agung's tasks finished, not one.

**It also inherits a Phase 1 follow-up.** The first-run wizard is specified to
offer demo data and does not. That offer lands with the seed, per the note on
the P3-T17 row in `STATUS.md`.

### Migration numbers, agreed up front

The last migration in the tree is 0027. Both lanes add one, and two people
picking a number independently will collide.

| Task | Migration | Holds |
|---|---|---|
| P3-T14 | 0028 | KPI trees, recovery columns |
| P3-T16 | 0029 | Comments and reactions |

Whoever lands second checks the number is still free before writing the file.

### The leftovers on the `in_review` rows

Four Phase 3 rows are `in_review` with named work still outstanding. They follow
the subject, not the row number.

| Leftover | Sits on row | Owner | Why |
|---|---|---|---|
| The formula builder screen | P3-T13 | Agung | P3-T14's own card already lists it under the KPI detail |
| Row sparklines, category subtotals, per-frequency columns, filters, `kpi_shares` | P3-T12 | Agung | Same KPI surfaces P3-T14 rebuilds |
| Sparkline overlapping its row, the sparse-data forecast question | P3-T10 | Obed | Goal-page layout, next to the comment wiring |
| Work Map virtualisation, scope tabs, KPI tiles | P3-T11 | Obed | Same tree P3-T16 hangs comments off. KPI tiles wait for P3-T14 |

### One open question for the human

The forecast is faithful arithmetic and poor advice on sparse data: three values
inside two days, projected six weeks out, reads 672 for a key result whose
target is 60. Whether METHOD.md §3.6 should require a minimum span before a
forecast is shown at all is a practice decision, not a developer's.

## Phase 4: read this first

Phase 4 cannot start yet. Two things gate it.

| Gate | State on 2026-08-14 |
|---|---|
| Phase 3 complete | The four tasks above |
| P4-T00 design gate approved | Not written. It needs an explicit "design approved" from the human, with the rule corpus and trigger catalogue reviewed line by line |

One task is exempt. **P4-T13 depends on P2-T15 only**, which shipped in Phase 2,
so it can start today without touching anything Phase 3 still owes. That makes
it the natural landing place for whoever finishes their Phase 3 lane first.

## The Phase 4 dependency map

| Task | Size | Depends on | Unblocks |
|---|---|---|---|
| P4-T00 Coaching design gate | M | Phase 3 complete | T01 |
| P4-T01 The method package | L | T00 | T02, T04 |
| P4-T02 Quality engine and Draft Coach | L | T01, P3-T04 | T03 |
| P4-T03 Publish gates | M | T02, P3-T03 | end of branch |
| P4-T04 Nudge engine and escalation | L | T01, P3-T08 | T05, T07 |
| P4-T05 The OKR Champion agent | L | T04, P2-T17 | T06 |
| P4-T06 The OKR Coach agent | L | T05 | T15 |
| P4-T07 Weekly session: confidence, voting, blockers | L | T04, P3-T07 | T08 |
| P4-T08 Weekly session: commitments, digest, streaks | M | T07 | T09 |
| P4-T09 Monthly review and decision log | M | T08 | T10 |
| P4-T10 Quarterly review: shell, scoring, narratives | L | T09 | T11 |
| P4-T11 Quarterly review: retro, diagnostic, reset | L | T10 | T12 |
| P4-T12 Minutes, exports and review feed-forward | M | T11, P3-T15 | end of branch |
| P4-T13 Embeddings and retrieval | L | **P2-T15 only** | T14 |
| P4-T14 Copilot | L | T13, P1-T07 | T15 |
| P4-T15 Coaching and rhythm assists | M | T14, T06 | end of phase |

Two lanes are genuinely independent. The retrieval lane (T13, then T14) shares
nothing with the coaching lane (T01 through T12). They meet once, at T15.

## The Phase 4 split

**Agung takes the method core and the sessions. Obed takes retrieval, the coach
surfaces and the agents.**

The reasoning: the session chain is six tasks that cannot be split, so it belongs
to one person from the start. The retrieval lane needs the least knowledge of
existing Phase 3 code. Obed then keeps everything that builds on the AI plumbing
he wrote.

| Stage | Agung | Obed | Runs at the same time? |
|---|---|---|---|
| 0 | P3-T14, then P3-T15 | P3-T16, then P3-T17 once P3-T15 lands | Yes, except P3-T17 |
| 1 | P4-T00 design gate, then wait for approval | **P4-T13 embeddings and retrieval** | Yes |
| 2 | P4-T01 method package | P4-T14 copilot | Yes |
| 3 | P4-T04 nudge engine | P4-T02 Draft Coach, then P4-T03 publish gates | Yes |
| 4 | P4-T07, T08, T09, T10, T11, T12 in that order | P4-T05 Champion, then P4-T06 Coach, then P4-T15 assists | Yes |

Across both phases: eleven tasks for Agung, nine for Obed, and five of Obed's
are size L, so the load is closer than the count suggests.

If Obed finishes P3-T16 before Agung finishes P3-T15, he starts P4-T13 rather
than waiting. It is the one Phase 4 task with no Phase 3 dependency at all.

### Handoffs

Three moments where one lane waits on the other.

| Handoff | From | To | What has to be true |
|---|---|---|---|
| P3-T15 to P3-T17 | Agung | Obed | The archive writes performance snapshots and the feed-forward opens the next cycle. In practice P3-T14 also has to be in, because the demo seeds a KPI tree with a live recovery OKR |
| P4-T01 to P4-T02 | Agung | Obed | The method package exports the twenty-six-check catalogue and the threshold registry, and its conformance suite passes |
| P4-T04 to P4-T05 | Agung | Obed | The nudge table, the rule registry and the escalation ladders are in, with the trigger catalogue resolving rule keys |

Everything else inside a lane is that lane's own business.

## File ownership, so two people do not fight over one file

| Area | Owner | Note |
|---|---|---|
| `packages/method` KPI rules | Agung | P3-T14 |
| `packages/method` everything else | Agung during P4-T01, shared after | Nobody else edits it while T01 is open. After that, any change is a message to the other lane, because both read it |
| KPI screens S-18, S-19, S-20, S-21 | Agung | P3-T14 |
| Cycle archive, scorecard, feed-forward | Agung | P3-T15 |
| Comment and reaction tables and every surface that renders them | Obed | P3-T16 |
| The demo builder and `pnpm db:seed` | Obed | P3-T17. It reads everything and owns nothing, so it lands last |
| `packages/agents` | Obed | P4-T05, P4-T06 |
| `packages/adapters` ai and embedding drivers | Obed | P4-T13 |
| Session tables and screens S-22 to S-25 | Agung | P4-T07 to T12 |
| Nudge tables, review-inbox surfaces, admin S-36 nudge card | Agung | P4-T04 |
| Goal page coach strip, drafting surface S-09, alignment studio review tab | Obed | P4-T02 and P4-T06 both write here, and both are his |
| Copilot panel S-39 | Obed | P4-T14 |

Two shared files carry a real collision risk: `packages/method`, and the goal
page, where P3-T16 hangs comments on a page P3-T14 does not touch but P4-T02
later rewrites. Everything else lands in one lane or the other.

## Two decisions the human has to make

**1. Branch policy.** Everything currently sits on one branch, `agung`, one
commit per task, and `main` still ends at Phase 1. Two people cannot both commit
to one branch without stepping on each other. The options:

| Option | What it costs |
|---|---|
| One branch per person, both cut from today's `agung` | Each handoff needs a rebase or a merge, and neither person sees the other's work until then |
| A shared `phase4` integration branch both merge into | One more branch to keep green, and a defined delivery point for each handoff |
| Two git worktrees over the same clone | No extra branches, but two working directories and two node module trees on one machine |

This one is now urgent rather than theoretical: both lanes start work in Phase 3,
today.

**2. Who takes the long chain.** P4-T01 to P4-T12 is eight tasks deep and mostly
size L. It sets the floor for how long Phase 4 takes no matter how many people
work on it. The split above gives it to Agung. Swap the lanes if Obed has more
time.

## AI credentials: what needs them and when

Every deterministic path has to work with the AI provider switched off, and
continuous integration proves it. Credentials are for verifying the AI half, not
for building the product.

| Task | What it needs | When |
|---|---|---|
| P4-T13 | An embedding provider, or a local embedding model | First. This is the earliest task that cannot be finished without one |
| P4-T14 | A chat provider, for streaming answers | After T13 |
| P4-T05, P4-T06, P4-T15 | A chat provider, to verify drafting and rewriting | Stage 4 |
| Everything in Phase 3, and P4-T01 to P4-T04, P4-T07 to P4-T12 | Nothing | These are deterministic by design |

Before storing a key: set `OPENOKR_ENCRYPTION_KEY` in `apps/web/.env`. Without
it a fresh root key is generated on every process start, so anything sealed
locally stops opening after a restart.

## The working rules stay the same

Both lanes still follow the task loop in `EXECUTION-GUIDE.md` and `CLAUDE.md`.
Nothing here changes it.

- A human names the task. Nobody starts the next one on their own.
- Restate the task and confirm the Definition of Ready before writing code.
- Tests first, failing for the right reason.
- Update the `STATUS.md` row. Only a human sets `done`.
- One commit per task, titled `<TASK-ID>: <title>`, signed off with `-s`.
- Nobody merges their own work.
