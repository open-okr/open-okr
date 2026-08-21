# P4-T00: the session design

Part three of the Phase 4 design gate. Authority: METHOD.md SS7.2, SS7.4,
SS7.5, SS8, SS9. Implemented at P4-T07 (weekly confidence and blockers),
P4-T08 (weekly commitments and digest), P4-T09 (monthly review), P4-T10
(quarterly scoring), P4-T11 (quarterly retro and diagnostic), P4-T12
(minutes and feed-forward).

Reference mockups: [07-weekly-session](../stakeholder/mockups/png/07-weekly-session.png),
[08-quarterly-review](../stakeholder/mockups/png/08-quarterly-review.png).
Reference, not authority: UIUX-PLAN.md SS10.

## 0. What already exists

| Component | Package | Ships at | What it holds |
|---|---|---|---|
| Check-in snapshots, voting, reveal | `packages/core` | P3-T07 | The immutable snapshot, draft/publish, vote lifecycle |
| Cadence engine | `packages/core` | P3-T06 | Next-check-in, staleness, escalation |
| Rhythm streak data | `packages/method` | P3-T06 | Streak break-on-skip rule |
| Scoring engine | `packages/method` | P3-T05 | Bands, verdicts, forecast, cascade |
| Workflow predicates | `packages/method` | P3-T03 | Phase completion (phases 6, 7 return `todo`) |
| Diagnostic thresholds | `packages/method` | P3-T02 | `sessions.*` parameters in the registry |
| Blocker taxonomy | METHOD.md SS7.3 | Specified | 5 types (in p4-t00-method-package.md SS5) |
| Root-cause taxonomy | METHOD.md SS8.4 | Specified | 8 causes (in p4-t00-method-package.md SS6) |

## 1. The session record

Shared schema across all three session kinds.

**Schema note (P4-T07a):** This table was corrected on 2026-08-19 to match
TECHNICAL-PLAN §4, which outranks this document per CLAUDE.md's authority
order. The original design carried `current_stage integer`, `status: open`,
`closed_at` and `scheduled_at`; the shipped table uses `stage_key text`,
`state: running`, `ended_at` and `scheduled_for` alongside additional columns
TECHNICAL-PLAN specifies. The database table is named `okr_sessions` because
the auth schema already owns `sessions`.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `workspace_id` | uuid | RLS (`okr_sessions` table, force row level security) |
| `space_id` | uuid, nullable | The space this session belongs to |
| `cycle_id` | uuid, nullable | |
| `kind` | `'planning'`, `'weekly'`, `'monthly'`, `'quarterly'` | |
| `title` | text | |
| `scheduled_for` | timestamptz | When it was supposed to start |
| `started_at` | timestamptz, nullable | Null until the facilitator opens |
| `ended_at` | timestamptz, nullable | |
| `facilitator_id` | uuid | The coordinator (weekly) or facilitator (quarterly) |
| `stage_key` | text, nullable | Current stage key (e.g. `confidence`, `diagnose`); null until opened |
| `stage_started_at` | timestamptz, nullable | When the current stage began |
| `elapsed` | jsonb | Elapsed seconds per stage, keyed by stage_key |
| `notes` | jsonb | Per-stage facilitator notes, keyed by stage_key |
| `state` | `'scheduled'`, `'running'`, `'closed'`, `'skipped'` | |
| `digest_id` | uuid, nullable | FK to digest once P4-T08 adds that table |

## 2. The weekly session (SS7.2)

Four stages. 15 to 30 minutes. One per space per week.

### 2.1 State machine

```
scheduled -> open -> stage_1 (confidence) -> stage_2 (diagnose) -> stage_3 (commitments) -> stage_4 (digest) -> closed
scheduled -> skipped (when the Champion marks it missed)
```

Transitions are facilitator-driven. The Champion opens and closes by default.
A coordinator can override.

### 2.2 Stage 1: Confidence round

Every key result in the space's active cycle gets a confidence from 0.0 to 1.0.

| Element | Behaviour |
|---|---|
| Key result list | All KRs grouped by objective, current value and progress shown |
| Confidence dial | 0.0 to 1.0 in 0.1 steps. SS3.2 band shortcuts at 0.3, 0.4, 0.7 |
| Vote mode | Each member submits privately. Votes reveal together with team average |
| Reveal | Atomic: one write, all clients see the result at the same time |
| Champion confirms | The champion sets the final confidence after seeing votes |
| What-changed note | 1-2 lines required. "What changed this week. Facts, not feelings" (SS7.2) |

**Completion condition:** Every key result has a confirmed confidence and a
what-changed note.

Given / When / Then:
- Given a session at stage 1 with one KR unscored, when the facilitator tries
  to advance, then it is refused naming the unscored KR.
- Given all KRs scored, when the facilitator advances, then stage 2 begins.

### 2.3 Stage 2: Diagnose what is low

Every key result with confidence below the low boundary (SS11
`scoring.confidenceLow`, default 0.4) requires three things.

| Field | Rule |
|---|---|
| Blocker type | One of the five in SS7.3 (resource, dependency, clarity, priority_conflict, external) |
| Blocker owner | A named person, not a team |
| Next action | One concrete action within 24 hours |

At or below the critical threshold (SS11 `scoring.confidenceCritical`, 0.3):
the coordinator raises it with management the same day, and the escalation
fires immediately (trigger `confidence.critical`).

**Completion condition:** Every low-confidence KR has a blocker type, a named
owner, and a next action.

Given / When / Then:
- Given a KR scored 0.3, when the coordinator tries to continue without a
  blocker type, owner and action, then it is refused.
- Given a KR scored 0.3 with all three fields set, when the step completes,
  then the blocker's 24-hour clock starts and the escalation fires.

### 2.4 Stage 3: Commitments

| Element | Behaviour |
|---|---|
| Last week | Close each commitment: delivered or not. No negotiation |
| This week | 2 to 3 concrete actions (SS11 `sessions.weeklyCommitmentBounds`), each with an owner and a linked key result |

Closing a session rolls this week's commitments into next week's list to close.

Given / When / Then:
- Given a completed session, when it closes, then last week's commitments are
  closed and this week's are open for next session.

### 2.5 Stage 4: Digest

The product assembles:

| Element | Source |
|---|---|
| Headline average | Average confidence, change from last week |
| On track | KRs with high confidence |
| At risk | KRs with low confidence, with owners |
| Blockers | On the 24-hour clock |
| Commitment count | This week's commitments |
| Coordinator note | Free text from the coordinator for leadership |

Posts to the team's channel (in-app and email now; chat channels in Phase 5).

### 2.6 The streak (SS7.4)

Consecutive weeks a space held its check-in. A skipped week breaks it.
Shown on the space home.

| Event | Effect |
|---|---|
| Session closed | Streak increments |
| Session skipped | Streak resets to 0 |
| No session by end of week | Streak resets to 0 |

### 2.7 Twelve-week confidence trend

A chart of the weekly average confidence over the last 12 weeks.

## 3. The monthly review (SS7.5)

30 to 60 minutes. One per space per month.

### 3.1 State machine

```
scheduled -> open -> closed
```

Simpler than weekly. No staged advancement. The facilitator records each item
as the meeting progresses.

### 3.2 Recorded data

| Item | Stored as | Notes |
|---|---|---|
| Trend per objective | `improving`, `flat`, `declining` | One per objective |
| Dependency and risk log | Status per dependency | From the alignment register |
| Resource or priority shifts | Free text | |
| Decisions | Decision record: text, affected KR/goal, date, author | The artifact that survives |

The decision table is surfaced on:
- The goal page (decisions affecting that goal)
- The cycle workspace (all decisions this cycle)

**Two things this table left implicit, settled at P4-T09 by TECHNICAL-PLAN
§4.7.** Both were the obvious reading of the rows above and both are wrong.

*A trend belongs to a month, not to a meeting.* `objective_trends` is keyed on
`(goal_id, month)`. A space that reschedules and ends up holding two reviews in
one March has one March opinion per objective, and the quarterly review reads
three months of trend without joining sessions. Keying on the session would
have produced two March opinions and no way to say which one the room meant.

*A decision carries its own `cycle_id`.* Deriving the cycle by joining through
the goal looks equivalent and is not: `goals.moveToCycle` is a real action, so
a goal moved into the next quarter would drag every past decision with it, and
a decision taken in Q1 would start reading as a Q2 decision. Both are driven by
tests, because the reason for a column is worth more than the column.

*The trend is never pre-filled.* §3.7's progress signal is shown beside each
objective as evidence and no button starts selected. §7.5 records the trend as
a judgement, and a judgement that arrives pre-answered is a judgement most
rooms stop making.

Given / When / Then:
- Given a monthly review recording a decision against a key result, when the
  goal page is opened, then the decision appears in its history.

## 4. The quarterly review (SS8)

60 minutes. Three acts, eleven stages. Each act asks one question.

| Act | Question | Stages |
|---|---|---|
| Review | Did we achieve the results we set out to? | 1-4 |
| Retro | How did we work together to get there? | 5-8 |
| Reset | What do we decide for the next cycle? | 9-11 |

### 4.1 The eleven-stage state machine

```
scheduled -> open -> stage_1 -> stage_2 -> ... -> stage_11 -> closed
```

Each stage has:
- A timer with pacing cues from the SS8.1 table
- An add-a-minute control for the facilitator
- Private facilitator notes (per stage, not shared with participants)
- Live synchronisation: stage changes reach every connected client within budget

**Three things P4-T10a-a settled that this list left implicit.**

*The stage keys are their own list, not slugs of the titles.* `REVIEW_STAGE_KEYS`
in `packages/method` is what `stage_key`, `elapsed`, `notes` and `added_minutes`
are keyed by. A slug generated from canon text would change the moment somebody
reworded a stage, and every stored note and every elapsed second would stop
resolving to the stage it belongs to.

*Added minutes are stored per stage, not folded into the agenda.* §11's
`sessions.quarterlyStageMinutes` is the workspace's standing agenda; one room
running long on one day must not retune every future review.

*Private means enforced by the read, not by the screen.* `sessions.read` hands
the notes map to the facilitator and an empty object to everybody else. It did
not, from P4-T07a until here: the whole map went to every caller. Nothing wrote
notes in between, so nothing leaked, and the shape was still wrong. The activity
payload names the stage and never the note, because an activity row is read by
everybody who can see the space.

*Live synchronisation is still blocked.* The outbox rows exist now; nothing
drains them. See PHASE-4-SPLIT.md.

| # | Stage | Act | Minutes | Completion condition |
|---|---|---|---|---|
| 1 | Open and check-in | Open | 5 | Every participant has a pulse score and one word |
| 2 | Score the key results | Review | 12 | Every KR has a score, evidence, and reason |
| 3 | Objective narratives | Review | 9 | Each objective's owner has spoken (facilitator marks) |
| 4 | Recognition and wins | Review | 3 | At least one recognition entered |
| 5 | Team retro | Retro | 7 | Writing phase complete, dot voting complete |
| 6 | Management retro | Retro | 3 | All four questions answered |
| 7 | Root cause and diagnostic | Retro | 5 | Every KR under 0.7 has a cause |
| 8 | OKR process health | Retro | 3 | All participants have submitted |
| 9 | Keep, modify or abandon | Reset | 5 | Every objective has a decision |
| 10 | Learnings and next drafts | Reset | 4 | At least one learning captured |
| 11 | Decisions and actions | Reset | 4 | Every action has a name and a date |

### 4.2 Stage 1: Open and check-in (SS8.2)

| Element | Behaviour |
|---|---|
| Room pulse | Each participant gives 1 to 5 + one word |
| Average read | Shown to facilitator with interpretation |

| Average | Read |
|---|---|
| 4.0 and above | The room has energy. Use it. Be honest about ambition |
| 3.0 to 3.9 | Steady. Watch for polite scoring later |
| Below 3.0 | The cycle cost something. Name it early |

Boundaries: SS11 `sessions.roomPulseBands` (already in `thresholds.ts`).

### 4.3 Stage 2: Score the key results (SS8.3)

| Element | Behaviour |
|---|---|
| Score | 0.0 to 1.0 per key result |
| Evidence | Baseline, target and actual on screen |
| Reason | One-line per KR (required) |
| Objective score | Hidden until the team reveals together |
| Reveal | Deterministic, instant under reduced motion |
| Running cycle score | Updates live as KRs are scored |

The reveal is one write. All connected clients see the same number at the
same time (same atomicity contract as the check-in vote reveal from P3-T07).

Given / When / Then:
- Given a running review at the scoring stage, when the facilitator reveals an
  objective's score, then every participant sees the same number at the same
  time, and the cycle score updates.

### 4.4 Stage 3: Objective narratives (SS8.3)

Pass-the-mic control. Each objective's owner tells the story behind the score.
Facilitator marks each as spoken.

### 4.5 Stage 4: Recognition and wins (SS8.3)

Specific recognition entries. "Name the effort that deserved to be seen.
Specific beats generous" (SS8.1).

### 4.6 Stage 5: Team retro (SS8.4)

| Element | Behaviour |
|---|---|
| Prompt chips | Configurable starting prompts |
| Two columns | What worked, what did not |
| Sticky notes | Silent writing phase, then display |
| Dot voting | Each participant gets a fixed number of dots |

### 4.7 Stage 6: Management retro (SS8.7)

The four questions from METHOD.md SS8.7 (specified in p4-t00-method-package.md
SS8). Leadership answers out loud. Facilitator records.

### 4.8 Stage 7: Root cause and diagnostic (SS8.4, SS8.6)

Every key result scoring below 0.7 (SS11 `scoring.rootCauseThreshold`) gets
one primary cause from the 8-cause taxonomy (p4-t00-method-package.md SS6).
Plus a detail field for context.

Then the rhythm diagnostic renders (p4-t00-method-package.md SS9):

| Condition | Diagnosis |
|---|---|
| Cycle score >= 0.7 | Results delivered |
| Cycle score < 0.7, rhythm >= 3.5 | Strategy or OKR-quality problem |
| Cycle score < 0.7, rhythm < 3.5 | Rhythm problem |

The diagnostic is deterministic. With AI on, a narrative adds specifics from
this cycle. With AI off, the verdict sentence is the same.

Given / When / Then:
- Given a cycle score below 0.7 and a rhythm score above 3.5, when the
  diagnostic renders, then it reads as a strategy or quality problem with
  the specific figures.

### 4.9 Stage 8: OKR process health (SS8.5)

Five statements, anonymous, 1 to 5 (p4-t00-method-package.md SS7).

| Rule | Detail |
|---|---|
| Anonymous | Responses cannot be attributed to a member |
| No double-submit | One submission per participant per review |
| Live averages | Running average and response count shown |
| Lowest statement | Becomes next cycle's process priority (SS8.9 feed-forward) |

The rhythm score (average of statements 2 and 5) feeds the SS8.6 diagnostic.

Given / When / Then:
- Given 5 participants, when 3 have submitted, then the live average updates
  and shows "3 of 5 submitted" without revealing who.

### 4.10 Stage 9: Keep, modify or abandon (SS8.8)

Every objective is closed deliberately.

| Decision | Meaning |
|---|---|
| Keep | Carry forward deliberately |
| Modify | Adjust target or wording from what we learned |
| Abandon | Priority shifted. End it cleanly |

Each requires a one-line why. Nothing carries over by default.

On session close, the decision writes back to the goal.

### 4.11 Stage 10: Learnings and next drafts (SS8.9)

- Capture learnings as "we learned that..."
- Promote the top dot-voted retro themes (from stage 5) into learnings
- Mark which ones to carry forward

### 4.12 Stage 11: Decisions and actions

Every action has a name and a date, or it is a wish (SS8.1). Each carries an
owner and a due date.

## 5. Live synchronisation specification

All three session kinds use the same synchronisation model.

| Requirement | Detail |
|---|---|
| Stage changes | Reach every connected client within the latency budget |
| Conflict resolution | Facilitator's action wins. A participant's stale advance is refused |
| Reconnection | A client that reconnects sees the current stage, not the one it left |
| Multiple facilitators | Not supported. One active facilitator per session |

Implementation uses the realtime port (TECHNICAL-PLAN.md SS5). The port has no
host in the current build. Until one exists, the session works via polling with
server-action revalidation (the same model P3-T07 uses for the vote reveal).

## 6. The digest engine (SS7.2 step 4)

Assembles after the weekly session closes.

| Field | Source |
|---|---|
| Headline | Average confidence this week |
| Change | Delta from last week's average |
| On track | KRs where confidence >= high boundary |
| At risk | KRs where confidence < low boundary, with owners |
| Blockers | Open blockers on the 24-hour clock |
| Commitments | Count and list for this week |
| Coordinator note | Free text |

### 6.1 Delivery

| Channel | When |
|---|---|
| In-app feed | Immediately on session close |
| Email | Immediately on session close |
| Chat channels | Phase 5 (Slack, Teams, WhatsApp, Telegram) |

## 7. The streak engine (SS7.4)

| Rule | Detail |
|---|---|
| Increment | Session closed for this week |
| Break | Session skipped, or no session by end of week |
| Display | Space home, as a ribbon |
| Trigger | `streak.at_risk` fires when the week would break the streak |

## 8. Feed-forward (SS8.9)

> **BLOCKED: awaits P3-T15 (scorecard, cycle archive and feed-forward).**
>
> P3-T15 implements the archive job, performance snapshots, and the
> feed-forward operation. This section will document the exact mapping from
> the quarterly review's close action to the next cycle's opening state.
>
> The mapping from METHOD.md SS8.9:
>
> | From this cycle | Into the next cycle |
> |---|---|
> | Every KR and its score | Phase 2, the prior-cycle scoring list |
> | Every carry-forward item | Phase 2, the strategic issue list at impact 4 |
> | Learnings and the retrospective | Phase 1, the input pack |
> | The lowest process-health statement | Phase 3, a process priority |
> | The annual frame and annual OKRs | Phase 0 reference, focus flags cleared |

## 9. Minutes (SS8.10)

> **BLOCKED: partially awaits P3-T16 (comments, reactions).**
>
> The minutes reference discussion threads from the review. P3-T16 builds the
> comment tables. The minutes structure itself can be designed now.

Minutes contain:

| Section | Content |
|---|---|
| Executive summary | Cycle score, objectives and KRs reviewed, KRs below 0.7, team pulse, learnings carried, actions agreed |
| Per-stage record | Every stage's data as captured during the session |

Exportable as document and PDF. A link from the closed cycle to its minutes.

## 10. Acceptance criteria

**Weekly session (P4-T07):**
Given a session where one key result scores below the threshold, when the
coordinator tries to continue, then it is refused until that key result has a
blocker type, a named owner and a next action, and the blocker's clock starts
on save.

**Weekly session (P4-T08):**
Given a completed session, when it closes, then the digest is generated with
correct figures, the streak advances, last week's commitments are closed and
this week's are open.

**Monthly review (P4-T09):**
Given a monthly review recording a decision against a key result, when the goal
page is opened, then the decision appears in its history with its date and
author.

**Quarterly scoring (P4-T10):**
Given a running review at the scoring stage, when the facilitator reveals an
objective's score, then every participant sees the same number at the same time,
and the cycle score updates.

**Quarterly retro (P4-T11):**
Given a cycle score below the threshold and a rhythm score above it, when the
diagnostic renders, then it reads as a strategy or quality problem with the
specific figures, and the prescription tells the facilitator to fix the key
results before pushing the team.

**Minutes (P4-T12):**
Given a completed review, when the facilitator closes it, then the minutes are
generated and exportable, every score and decision is written back, and the next
cycle's Phase 2 already holds the scores and carry-forward issues.
