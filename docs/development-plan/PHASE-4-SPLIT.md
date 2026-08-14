# Phase 4 split: Agung and Obed

Who takes which task in Phase 4, what can run at the same time, and what has to
wait. Written 2026-08-14.

`IMPLEMENTATION-PLAN.md` is the authority. This file only reads its dependency
lines and turns them into two lanes. If the two ever disagree, the plan wins and
this file gets fixed.

## Read this first

Phase 4 has not started and cannot start yet. Two things gate it.

| Gate | State on 2026-08-14 |
|---|---|
| Phase 3 complete | Not yet. P3-T14, P3-T15, P3-T16 and P3-T17 are `todo`, and P3-T10 to P3-T13 are `in_review` with named leftovers |
| P4-T00 design gate approved | Not written. It needs an explicit "design approved" from the human, with the rule corpus and trigger catalogue reviewed line by line |

One task is exempt. **P4-T13 depends on P2-T15 only**, which shipped in Phase 2,
so it can start today without touching anything Phase 3 still owes.

## The dependency map

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

## The split

**Agung takes the method core and the sessions. Obed takes retrieval, the
coach surfaces and the agents.**

The reasoning: the session chain is seven tasks that cannot be split, so it
belongs to one person from the start. The retrieval lane needs the least
knowledge of existing Phase 3 code, so it is the cleanest place for a second
person to begin. Obed then keeps everything that builds on the AI plumbing he
wrote.

| Stage | Agung | Obed | Runs at the same time? |
|---|---|---|---|
| 0 | Finish Phase 3: P3-T14, T15, T16, T17 and the leftovers | **P4-T13 embeddings and retrieval** | Yes, starting today |
| 1 | P4-T00 design gate, then wait for approval | P4-T13, then P4-T14 copilot | Yes |
| 2 | P4-T01 method package | P4-T14 copilot | Yes |
| 3 | P4-T04 nudge engine | P4-T02 Draft Coach, then P4-T03 publish gates | Yes |
| 4 | P4-T07, T08, T09, T10, T11, T12 in that order | P4-T05 Champion, then P4-T06 Coach, then P4-T15 assists | Yes |

Final tally: nine tasks for Agung, seven for Obed, and five of Obed's seven are
size L, so the load is closer than the count suggests.

### Handoffs

Only two moments where one lane waits on the other.

| Handoff | From | To | What has to be true |
|---|---|---|---|
| T01 to T02 | Agung | Obed | The method package exports the twenty-six-check catalogue and the threshold registry, and its conformance suite passes |
| T04 to T05 | Agung | Obed | The nudge table, the rule registry and the escalation ladders are in, with the trigger catalogue resolving rule keys |

Everything else inside a lane is that lane's own business.

## File ownership, so two people do not fight over one file

| Area | Owner | Note |
|---|---|---|
| `packages/method` | Agung during T01, shared after | Nobody else edits it while T01 is open. After that, any change is a message to the other lane, because both read it |
| `packages/agents` | Obed | T05 and T06 |
| `packages/adapters` ai and embedding drivers | Obed | T13 |
| Session tables and screens S-22 to S-25 | Agung | T07 to T12 |
| Nudge tables, review-inbox surfaces, admin S-36 nudge card | Agung | T04 |
| Goal page coach strip, drafting surface S-09, alignment studio review tab | Obed | T02 and T06 both write here, and both are Obed's |
| Copilot panel S-39 | Obed | T14 |

The one shared file with a real collision risk is `packages/method`. Everything
else lands in one lane or the other.

## Two decisions the human has to make

**1. Branch policy.** Everything currently sits on one branch, `agung`, one
commit per task, and `main` still ends at Phase 1. Two people cannot both commit
to one branch without stepping on each other. The options:

| Option | What it costs |
|---|---|
| One branch per person, both cut from today's `agung` | Each handoff needs a rebase or a merge, and neither person sees the other's work until then |
| A shared `phase4` integration branch both merge into | One more branch to keep green, and a defined delivery point for each handoff |
| Two git worktrees over the same clone | No extra branches, but two working directories and two node module trees on one machine |

**2. Who takes the long chain.** T01 to T12 is eight tasks deep and mostly size
L. It sets the floor for how long Phase 4 takes no matter how many people work
on it. The split above gives it to Agung. Swap the lanes if Obed has more time.

## What blocks what, outside Phase 4

| Blocker | Blocks | Why |
|---|---|---|
| P3-T15 scorecard and feed-forward | P4-T12 | The minutes task writes back through the feed-forward that P3-T15 builds |
| P3-T04 goals and key results | P4-T02 | Already done |
| P3-T03, P3-T07, P3-T08 | P4-T03, P4-T07, P4-T04 | Already done |
| P1-T07 | P4-T14 | Already done |

So the only outstanding cross-phase blocker for this split is P3-T15, and it
sits at the very end of Agung's lane.

## AI credentials: what needs them and when

Every deterministic path has to work with the AI provider switched off, and
continuous integration proves it. Credentials are for verifying the AI half, not
for building the product.

| Task | What it needs | When |
|---|---|---|
| P4-T13 | An embedding provider, or a local embedding model | First. This is the earliest task that cannot be finished without one |
| P4-T14 | A chat provider, for streaming answers | After T13 |
| P4-T05, P4-T06, P4-T15 | A chat provider, to verify drafting and rewriting | Stage 4 |
| P4-T01 to P4-T04, P4-T07 to P4-T12 | Nothing | These are deterministic by design |

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
