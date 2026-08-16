# Phase 4 parallel readiness

Written 2026-08-14. Based on the commit history on `agung` and the declared
dependency graph in IMPLEMENTATION-PLAN.md.

## Phase 4 sub-phases

Phase 4 has 16 tasks that form four independent chains. Only Chain C has no
Phase 3 or design gate dependency.

### Chain A: Method + Quality

| Task | Title | Depends on | Status | Can start before P3 done? |
|---|---|---|---|---|
| P4-T00 | Coaching design gate | Phase 3 complete | todo | **Partially** (see breakdown below) |
| P4-T01 | The method package | P4-T00 | todo | No |
| P4-T02 | Quality engine + Draft Coach | P4-T01, P3-T04 (done) | todo | No |
| P4-T03 | Publish gates | P4-T02, P3-T03 (done) | todo | No |

### Chain B: Nudges + Agents + Sessions

Forks at P4-T04 into two arms that reconverge at P4-T15 (Chain D).

| Task | Title | Depends on | Status | Can start before P3 done? |
|---|---|---|---|---|
| P4-T04 | Nudge engine, triggers, escalation | P4-T01, P3-T08 (done) | todo | No |
| P4-T05 | OKR Champion agent | P4-T04, P2-T17 (done) | todo | No |
| P4-T06 | OKR Coach agent | P4-T05 | todo | No |
| P4-T07 | Weekly session: confidence, voting, blockers | P4-T04, P3-T07 (done) | todo | No |
| P4-T08 | Weekly session: commitments, digest, streaks | P4-T07 | todo | No |
| P4-T09 | Monthly review and decision log | P4-T08 | todo | No |
| P4-T10 | Quarterly review: scoring, narratives | P4-T09 | todo | No |
| P4-T11 | Quarterly review: retro, diagnostic, reset | P4-T10 | todo | No |
| P4-T12 | Minutes, exports, feed-forward | P4-T11, P3-T15 (**todo**) | todo | No |

### Chain C: Embeddings + Copilot

| Task | Title | Depends on | Status | Can start before P3 done? |
|---|---|---|---|---|
| P4-T13 | Embeddings and retrieval | P2-T15 (done) | todo | **Yes** (technical), blocked by gate rule |
| P4-T14 | Copilot | P4-T13, P1-T07 (done) | todo | After P4-T13 only |

### Chain D: Assists (convergence point)

| Task | Title | Depends on | Status | Can start before P3 done? |
|---|---|---|---|---|
| P4-T15 | Coaching and rhythm assists | P4-T14, P4-T06 | todo | No (needs both Chain B and C) |

---

## P4-T00 detailed breakdown

P4-T00 produces three design documents. This table maps every deliverable
item to its source and the P3 task it depends on.

### Deliverable 1: Method package design

Source: METHOD.md, AI-NATIVE-PLAN.md SS6.4.

| Work item | Source | Depends on P3 task | P3 status | Can write now? |
|---|---|---|---|---|
| 26 quality checks: conditions, statuses, prompts | METHOD.md SS3 | None | n/a | **Yes** |
| Word lists per check (activity nouns, vague terms, etc.) | METHOD.md SS3.1 | None | n/a | **Yes** |
| Example pairs per check (weak input, strong rewrite) | METHOD.md SS3.1 | None | n/a | **Yes** |
| Score bands (exceed, hit, miss, fail) | METHOD.md SS3.2 | P3-T05 (scoring engine) | done | **Yes** |
| Confidence bands and draft verdict | METHOD.md SS3.2 | P3-T05 | done | **Yes** |
| Portfolio verdict (on track / at risk / off track) | METHOD.md SS3.3 | P3-T05 | done | **Yes** |
| Progress signal (leading vs lagging) | METHOD.md SS3.4 | P3-T04 (goals) | done | **Yes** |
| KPI corridors (healthy, watch, unhealthy) | METHOD.md SS6 | P3-T12 (KPI engine) | in_review | **Yes** |
| KPI recovery corridor behaviour | METHOD.md SS6.5 | P3-T14 (recovery OKRs) | **todo** | **No** |
| Blocker taxonomy (5 types) | METHOD.md SS7.3 | None | n/a | **Yes** |
| Root-cause taxonomy (8 causes) | METHOD.md SS8.5 | None | n/a | **Yes** |
| Publish gates (6 gates) | METHOD.md SS4.5 | P3-T03 (cycle workflow) | done | **Yes** |
| Phase completion conditions | METHOD.md SS4 | P3-T03 | done | **Yes** |
| Threshold registry (SS11 keys, types, ranges, defaults) | METHOD.md SS11 | P3-T02 (thresholds) | done | **Yes** |
| Strength-score calculation with strictness | METHOD.md SS3 | None | n/a | **Yes** |
| Corpus of real OKR drafts with expected verdicts | Written from METHOD.md rules | None | n/a | **Yes** |

**Result: 15 of 16 items can start now.** One item (recovery corridor behaviour) needs P3-T14.

### Deliverable 2: Agent design

Source: AI-NATIVE-PLAN.md SS6.1 to SS6.4.

| Work item | Source | Depends on P3 task | P3 status | Can write now? |
|---|---|---|---|---|
| Champion persona, staged instructions, schedule | AI-NATIVE-PLAN SS6.2 | None | n/a | **Yes** |
| Coach persona, instructions, scope | AI-NATIVE-PLAN SS6.1 | None | n/a | **Yes** |
| Check-in overdue trigger | SS6.4 rhythm triggers | P3-T07 (check-ins) | done | **Yes** |
| Acknowledgement overdue trigger | SS6.4 rhythm triggers | P3-T08 (review inbox) | done | **Yes** |
| Staleness trigger | SS6.4 rhythm triggers | P3-T06 (cadence) | done | **Yes** |
| Blocker aging trigger | SS6.4 rhythm triggers | P3-T06 | done | **Yes** |
| Session lifecycle triggers (countdown, prep) | SS6.4 rhythm triggers | P3-T03 (workflow) | done | **Yes** |
| Morning summary trigger | SS6.4 rhythm triggers | P3-T06 | done | **Yes** |
| Quality check triggers (write-time evaluation) | SS6.4 quality triggers | P3-T04 (goals) | done | **Yes** |
| Alignment gap triggers | SS6.4 quality triggers | P3-T09 (alignment) | done | **Yes** |
| Divergence detection trigger (health vs data) | SS6.4 quality triggers | P3-T05 (scoring) | done | **Yes** |
| Escalation ladders (3 ladders, step definitions) | SS6.3 | P3-T06, P3-T08 | done | **Yes** |
| Deduplication rules (1 per subject per member per day) | SS6.3 | None | n/a | **Yes** |
| Quiet hours and workspace quiet mode | SS6.3 | None | n/a | **Yes** |
| Deterministic-with-AI-off specification | SS2 | None | n/a | **Yes** |
| Prompt design per cycle phase | AI-NATIVE-PLAN SS6.2 | P3-T03 | done | **Yes** |
| **KPI corridor trigger (unhealthy KPI fires recovery)** | SS6.4 quality triggers | **P3-T14 (KPI trees)** | **todo** | **No** |
| **Recovery OKR proposal trigger** | SS6.4 rhythm triggers | **P3-T14** | **todo** | **No** |
| **Coach findings posted as comments** | SS6.1 | **P3-T16 (comments)** | **todo** | **No** |
| **Agent acceptance against demo workspace** | IMPL-PLAN P4-T05/T06 | **P3-T17 (demo seed)** | **todo** | **No** |

**Result: 16 of 20 items can start now.** Four items need P3-T14, P3-T16, or P3-T17.

### Deliverable 3: Session design

Source: METHOD.md SS7.2, SS7.5, SS8, SS9.

| Work item | Source | Depends on P3 task | P3 status | Can write now? |
|---|---|---|---|---|
| Weekly session state machine (4 steps) | METHOD.md SS7.2 | P3-T07 (check-ins) | done | **Yes** |
| Confidence round: key result list, dial, vote reveal | SS7.2 step 1 | P3-T07 | done | **Yes** |
| Blocker step: 5-type picker, owner, next action, clock | SS7.2 step 2 | P3-T06 (cadence) | done | **Yes** |
| Commitment step: table, linked key result | SS7.2 step 3 | P3-T04 (goals) | done | **Yes** |
| Digest and streak engine | SS7.2 step 4 | P3-T06 | done | **Yes** |
| Monthly review state machine | SS7.5 | P3-T05 (scoring) | done | **Yes** |
| Objective trends, dependency and risk log | SS7.5 | P3-T09 (alignment) | done | **Yes** |
| Decision table design | SS7.5 | P3-T04 | done | **Yes** |
| Quarterly review: 11-stage rail, lap bar, stage timer | SS8.1 | None | n/a | **Yes** |
| Quarterly review: scoring stage (sliders, reasons, reveal) | SS8.2 | P3-T05 | done | **Yes** |
| Quarterly review: narratives and recognition | SS8.3 | None | n/a | **Yes** |
| Quarterly review: team retro (prompts, sticky notes, voting) | SS8.4 | None | n/a | **Yes** |
| Quarterly review: root-cause stage (8-cause picker) | SS8.5 | None | n/a | **Yes** |
| Quarterly review: process-health survey | SS8.6 | None | n/a | **Yes** |
| Quarterly review: rhythm diagnostic (verdict + narrative) | SS8.6 | P3-T06 | done | **Yes** |
| Quarterly review: keep/modify/abandon per objective | SS8.7 | P3-T04 | done | **Yes** |
| Quarterly review: learnings and carry-forward | SS8.8 | None | n/a | **Yes** |
| Quarterly review: next-cycle drafts | SS8.9 | P3-T03 (workflow) | done | **Yes** |
| Live synchronisation specification | Generic | None | n/a | **Yes** |
| **Quarterly close: writing scores to scorecard** | SS8.9 | **P3-T15 (scorecard)** | **todo** | **No** |
| **Feed-forward into next cycle** | SS8.9 | **P3-T15** | **todo** | **No** |
| **Minutes export referencing comments** | SS8.10 | **P3-T16 (comments)** | **todo** | **No** |

**Result: 19 of 22 items can start now.** Three items need P3-T15 or P3-T16.

---

## Summary

| Deliverable | Total items | Can start now | Blocked by | Blocked count |
|---|---|---|---|---|
| Method package design | 16 | 15 | P3-T14 | 1 |
| Agent design | 20 | 16 | P3-T14, P3-T16, P3-T17 | 4 |
| Session design | 22 | 19 | P3-T15, P3-T16 | 3 |
| **P4-T00 total** | **58** | **50** | | **8** |

**~86% of P4-T00 can be written now.** The remaining 14% is blocked by four
P3 tasks: P3-T14 (KPI recovery), P3-T15 (scorecard), P3-T16 (comments), and
P3-T17 (demo seed).

The P4-T00 acceptance criterion ("the human approves with an explicit statement,
and the rule corpus and the trigger catalogue receive a line-by-line review")
cannot be met until the eight blocked items are filled in. But the design
documents can be drafted to ~86% completion in parallel with the remaining
P3 work.

### P4-T13 (Embeddings): fully unblocked

P4-T13 depends only on P2-T15 (done). Its code lives in `packages/adapters`
and `packages/db` (new schema file + migration). The migration number will
conflict with whatever P3-T14 through P3-T16 produce, but that is a rebase,
not a design problem. The CLAUDE.md design gate rule is the only blocker, and
that is a process decision.

### Progress (updated 2026-08-14)

| Deliverable | Document | Status | Blocked items remaining |
|---|---|---|---|
| Method package design | `docs/design/p4-t00-method-package.md` | **drafted** | 1 (SS6.5 recovery corridors, P3-T14) |
| Agent design | `docs/design/p4-t00-agent-design.md` | **drafted** | 4 (2 triggers P3-T14, comments P3-T16, demo P3-T17) |
| Session design | `docs/design/p4-t00-session-design.md` | **drafted** | 3 (feed-forward P3-T15, minutes P3-T16) |

### P4-T13 (Embeddings): implementation started (updated 2026-08-14)

| Component | File | Status |
|---|---|---|
| Migration | `packages/db/migrations/0028_embeddings.sql` | done |
| Schema | `packages/db/src/schema/embeddings.ts` | done |
| Chunker | `packages/core/src/embeddings/chunker.ts` | done |
| Embedding service | `packages/core/src/embeddings/service.ts` | done |
| Chunker tests | `packages/core/test/embeddings-chunker.test.ts` | written, not yet run (DB harness OOM) |
| Integration tests | | not started |

### Recommended parallel plan

| When | Action |
|---|---|
| Now | Start writing P4-T00 design documents (the 50 unblocked items) |
| As P3-T14 merges | Fill in recovery corridor and KPI triggers (3 items) |
| As P3-T15 merges | Fill in scorecard close and feed-forward (2 items) |
| As P3-T16 merges | Fill in comment-based findings and minutes export (2 items) |
| As P3-T17 merges | Fill in demo workspace acceptance criteria (1 item) |
| After all 58 items filled | Submit P4-T00 for line-by-line review and approval |
| If gate rule is relaxed | Start P4-T13 (embeddings) immediately |

## Review of the three design documents, 2026-08-17

Read by the other lane against the sources, before the human's own pass. This
is the legwork, not the approval: P4-T00's acceptance criterion puts the
line-by-line read on the human, and nothing here substitutes for it.

### The quality-check catalogue is complete and exact

`p4-t00-method-package.md` carries all twenty-six keys METHOD.md §4.1 to §4.4
define: OBJ-1 to OBJ-5, KR-1 to KR-7, AL-1 to AL-6, CY-1 to CY-8. None missing,
none invented. This is the part of the gate most likely to drift from the canon
and it has not.

### Three triggers are in the plan and in no design table

AI-NATIVE-PLAN §6.4 defines **44** trigger keys. The agent design tabulates 42.
The three absent from every trigger table are:

| Trigger | Was blocked by | Now |
|---|---|---|
| `kpi.recovery_proposed` | P3-T14 | Done, so fillable |
| `kpi.recovered` | P3-T14 | Done, so fillable |
| `quality.conflict` | P3-T16, the Coach's findings as comments | Done, so fillable |

Each was recorded above as blocked while Phase 3 was still running, so none is
an oversight. All three are answerable now.

**The counts in the STATUS row are wrong, though.** It reads "26 rhythm + 16
quality triggers", which is 42, the number the design tabulates rather than the
number the plan defines. The gate is not complete at 42. It is complete at 44.

### The three escalation ladders agree with the shipped code

`p4-t00-agent-design.md` §4 tabulates the check-in ladder at steps 0 to 5 with
the same targets and the same §11 parameters as
`packages/method/src/escalation.ts`, which P3-T06 shipped and which reads its
numbers from the registry rather than holding them. The acknowledgement ladder
(1 day, 3 days) and the blocker ladder (20, 24, 48 hours) match AI-NATIVE-PLAN
§6.3. Every one of the six §11 keys the document cites by name exists in
`thresholds.ts`, which is the check the "Migration 0028" mistake on the P4-T13
row shows is worth making.

### One proposed §11 parameter contradicts what §11 is

`p4-t00-method-package.md` proposes `quality.wordLists` as a §11 parameter with
a default of `{}`, for workspace-specific additions to the §4 word lists.
`thresholds.ts` says the opposite in its own header, and says why: the §4 word
lists are "data but not numeric", and P3-T02 excluded them from the registry
deliberately, alongside §2.4's planning timelines and the formula evaluator's
safety bounds.

The registry's rule, from §11 itself, is that a value not in it is not a
setting. Admitting a non-numeric map changes what the registry is. That is a
METHOD decision rather than a developer's, and the two options are:

| Option | Consequence |
|---|---|
| Drop it from the §11 table | Workspace word-list additions need another home, most naturally a §4.14 setting |
| Widen §11 to admit non-numeric data | METHOD.md §11 changes, and so does the sentence `thresholds.ts` is built on |

**Nothing should be built on `quality.wordLists` until the human picks one.**

### Both session structures match the canon

`p4-t00-session-design.md` carries METHOD.md §8.1's eleven quarterly stages with
the same numbers, names, acts and minute budgets: open, score, narratives,
recognition, team retro, management retro, root cause, process health, keep or
modify or abandon, learnings, decisions. And §7.2's weekly ritual is the same
four steps in the same order, as an explicit state machine: confidence round,
diagnose what is low, commitments, digest.

Structure is the half a review can settle by reading. Whether each stage's
completion condition is the right one is a judgement, and it is the judgement
P4-T00's acceptance criterion asks the human to make.

### Where the review stands

| Reviewed | Result |
|---|---|
| The twenty-six quality checks | Exact against METHOD.md §4.1 to §4.4 |
| The trigger catalogue | 44 in the plan, 42 tabulated, three named above and now fillable |
| The three escalation ladders | Match `escalation.ts` and AI-NATIVE-PLAN §6.3 |
| Every §11 key cited by name | All present in `thresholds.ts` |
| The eleven quarterly stages | Exact against METHOD.md §8.1 |
| The four weekly steps | Exact against METHOD.md §7.2 |

### Both blockers are closed, in the direction the documentation already pointed

**The three triggers are tabulated.** Their rows are transcribed from
AI-NATIVE-PLAN §6.4 rather than invented, so the design now carries all 44 keys
the plan defines. `quality.conflict` is marked as the one trigger in its table
that is **not** deterministic: it is a judgement about meaning, so with the
provider off it does not fire and nothing is claimed.

**`quality.wordLists` is withdrawn.** Of the two options above, dropping it is
the one that matches the documentation as written: §11 already says a value not
in the registry is not a setting, and `thresholds.ts` already records the §4
word lists as excluded because they are data rather than numbers. Widening §11
would have meant changing METHOD.md, which is the further move, not the closer
one. Workspace additions go to the §4.14 settings map, where every other
non-numeric preference already lives. **METHOD.md is untouched.**

### What approval still needs

Every structural check a reader can make has been made, and the two open items
are closed. What remains is not legwork:

- The line-by-line read of the rule corpus and the trigger catalogue, which
  P4-T00's acceptance criterion puts on the human by name.
- The judgement calls a comparison cannot settle: whether each stage's
  completion condition is the right one, whether each check's coaching prompt
  says the useful thing, whether the corpus verdicts are the ones a facilitator
  would give.

**Still unreviewed here:** the agent design's deduplication rules, quiet hours
and the deterministic-with-AI-off matrix.
