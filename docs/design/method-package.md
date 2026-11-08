# Method package design

Part one of the Phase 4 design gate. Authority: METHOD.md SS3, SS4, SS6, SS7.3,
SS8.4 to SS8.6, SS11, and AI-NATIVE-PLAN.md SS6.4. Implemented at P4-T01 as
pure functions and data in `packages/method`.

This document specifies what P4-T01 builds. It does not repeat the code P3-T05
already shipped in `scoring.ts`, `thresholds.ts`, `kpi.ts`, `workflow.ts` and
`alignment.ts`. It specifies what those files do not yet contain.

## 0. What already exists in `packages/method`

| File | SS | Ships at | What it holds |
|---|---|---|---|
| `scoring.ts` | SS3 | P3-T05 | Progress formula, weighted cascade, health, confidence bands, draft verdict, score bands, score annotations, portfolio verdict, progress signal, trend forecast |
| `thresholds.ts` | SS11 | P3-T02 | Every SS11 parameter as data with canon defaults, validation, resolution |
| `kpi.ts` | SS6.1 to SS6.4 | P3-T12 | Period normalisation, achievement, corridor state |
| `kpi-formula.ts` | SS6.7 | P3-T13 | Formula tree, evaluator, cascade, validation |
| `kpi-aggregate.ts` | SS6.7 | P3-T13 | Cross-frequency aggregation |
| `workflow.ts` | SS2.3, SS4.5 | P3-T03 | Phase predicates, publish gates, phase work allowed |
| `alignment.ts` | SS5.2 | P3-T09 | Alignment share and bands (penalties until P9-T16a), finding types |
| `escalation.ts` | SS11 | P3-T06 | Escalation ladder data |
| `guidance.ts` | SS9 | P3-T03 | Facilitator guidance per phase, horizons, timeline |
| `terminology.ts` | SS2 | P3-T02 | Customisable term labels |

P4-T01 adds to this package. It does not rewrite what is there.

## 1. The quality catalogue

Twenty-six checks across four groups. METHOD.md SS4 is the single source.
Exported as data so the same array drives the client-side Draft Coach, the
server-side evaluation on every write, and the conformance suite.

### 1.1 Data shape

```typescript
interface QualityCheck {
  readonly id: string;           // OBJ-1, KR-2, AL-3, CY-5, etc.
  readonly group: "objective" | "key_result" | "alignment" | "cycle";
  readonly title: string;        // "Outcome, not output"
  readonly feedsStrengthScore: boolean; // cycle checks do not
  readonly conditions: readonly ConditionRow[];
}

interface ConditionRow {
  readonly condition: string;    // human-readable predicate description
  readonly status: "pass" | "info" | "warn" | "fail" | "todo";
  readonly prompt: string;       // the coaching message, verbatim from METHOD.md
}
```

Every check carries enough data to render the rule card (S-09, screen
`03b-rule-card`) without a second lookup.

### 1.2 The twenty-six checks

Transcribed from METHOD.md SS4.1 through SS4.4. Each row is a separate entry.
Condition tables use first-match-wins evaluation.

#### Objective checks (5)

| ID | Title | Conditions | Word lists used |
|---|---|---|---|
| OBJ-1 | Outcome, not output | 7 rows (SS4.1) | Output verbs, Movement verbs, State words, Why markers |
| OBJ-2 | Qualitative and memorable | 3 rows (SS4.1) | None (digit and length checks) |
| OBJ-3 | Timebound | 1 row: fail without cycle or explicit timeframe | None |
| OBJ-4 | Owned | 2 rows: fail without champion, fail without reviewer where reviewers are required | None |
| OBJ-5 | Counted | 2 rows: warn > 3 per unit, warn > 5 at company level | None |

#### Key result checks (7)

| ID | Title | Conditions | Word lists used |
|---|---|---|---|
| KR-1 | Count | 4 rows: pass 2-5, warn 1, warn >5, fail 0 | None |
| KR-2 | Verifiable | 6 rows, by key result kind: a metric passes on "from X to Y" or 2 numbers, warns on 1 number or none; maintain, milestone and baseline pass | None |
| KR-3 | Complete | 2 rows: fail if target, date or owner missing, warn if a metric has no baseline | None |
| KR-4 | Leading and lagging | 4 rows: pass untagged, pass mixed, warn all lagging, warn all leading | None |
| KR-5 | Impact, not effort | 4 rows (SS4.2) | Activity nouns, Impact words |
| KR-6 | Ambitious but honest | Delegates to SS3.2 draft verdict on the average confidence of the aspirational key results | None |
| KR-7 | Direction set | Fail when a metric key result has no direction and none can be derived from baseline and target; warn when baseline equals target | None |

#### Alignment checks (6)

| ID | Title | Conditions |
|---|---|---|
| AL-1 | Supports a bigger priority | 3 rows: warn with no parent, no contribution and no standalone reason; warn with a contribution under "Contribution minimum"; pass. The first row failed, and the second read "< 3 words", until P9-T16b-a |
| AL-2 | One parent only | 1 row: pass, because a database check constraint refuses a goal with both a parent goal and a parent key result |
| AL-3 | No level skip | 1 row: flag a skip over the levels the cycle uses. Off by default since METHOD v2 (P9-T03a set the level, P9-T16b-a made the engine honour it) |
| AL-4 | Company anchor | 1 row: warn if no company-level objective anchors the tree (fail until P9-T16b-a) |
| AL-5 | Dependencies declared | 1 row: warn if any cross-team dependency is neither confirmed, escalated nor risk-owned |
| AL-6 | Not siloed | 1 row: flag a department whose subtree has no horizontal dependency. Off by default since METHOD v2 |

#### Cycle checks (8)

These feed phase completion and publish gates, not the strength score.

| ID | Title | Condition |
|---|---|---|
| CY-1 | Input pack complete | Complete and distributed >= 3 working days before session one |
| CY-2 | Prior cycle scored | Prior cycle scored, or first cycle explicitly declared |
| CY-3 | Strategic issues | At least 3 listed and ranked by impact |
| CY-4 | Priorities set | 3 to 5, each with a 12-month success statement |
| CY-5 | Not-doing list | Written |
| CY-6 | Capacity checked | Checked, and no committed OKR left at "exceeds" |
| CY-7 | Dependencies confirmed | Every dependency confirmed, escalated or risk-owned |
| CY-8 | Sessions booked | Every check-in and review booked for the whole cycle |

### 1.3 Word lists

Exported as named arrays of lowercase strings. The canon terms are immutable.
A workspace may add terms through the §11 parameter `quality.wordLists`; the
canon terms remain. See the registry note below.

| List name | Used by | Words |
|---|---|---|
| `outputVerbs` | OBJ-1 | launch, build, ship, implement, create, deliver, release, complete, develop, deploy, write, publish, migrate, install, conduct, hold, organise, organize, set up, roll out, rollout, hire, redesign, finish, produce, run |
| `movementVerbs` | OBJ-1 | increase, grow, improve, reduce, boost, raise, cut, double, triple, maximise, maximize, minimise, minimize, decrease, accelerate, expand, drive, bring |
| `stateWords` | OBJ-1 | become, be the, delight, delighted, loved, trusted, leading, best, strongest, profitable, sustainable, engaged, thriving, world-class, prefer, preferred, go-to, healthiest, excellence, dominant, known for, famous for, proud |
| `whyMarkers` | OBJ-1 | so that, in order to, because |
| `activityNouns` | KR-5 | call, meeting, interview, demo, email, workshop, session, training, webinar, post, visit, proposal, campaign, feature, report, presentation, event, ticket, article, sprint, task, activity, outreach, touchpoint (and plurals) |
| `impactWords` | KR-5 | revenue, pipeline, conversion, retention, churn, nps, csat, satisfaction, margin, profit, growth, adoption, activation, engagement, win rate, quality, insight, market share, loyalty, renewal, upsell, arr, mrr, ltv, cac, accuracy, uptime, productivity, time-to-value, referrals, deal size |

### 1.4 Weak and strong examples

From METHOD.md SS4.6. Each pair is attached to the check that would fire on the
weak version.

| Weak | Strong | Fires check | Why |
|---|---|---|---|
| Launch the new mobile app by end of Q3 | Make mobile the way our customers prefer to reach us | OBJ-1 | Launch is output. The strong version names the change in behaviour |
| Improve customer satisfaction | Increase NPS from 32 to 50 (lagging). Cut first-response time from 9h to 2h (leading) | KR-2, KR-4 | No baseline, no target, no direction tag |
| Hold 12 customer interviews | Raise activation rate of new sign-ups from 41% to 60% (lagging). Interview 12 churned customers by week 6 (leading) | KR-5 | Interviews are activity, not impact |
| Increase sales calls from 40 to 120 per week | Grow qualified pipeline from $1.2M to $3.0M (lagging). Lift call-to-meeting conversion from 8% to 15% (leading) | KR-5 | Measurable output, not impact |

## 2. The strength score

From METHOD.md SS4.

```
strength = (passes + 0.5 * warns) / evaluatedChecks * 100
```

Computed over objective, key result and alignment checks of the set being
drafted. Cycle checks do not contribute. A `todo` check counts in the
denominator and adds zero.

| Score | Band | Colour |
|---|---|---|
| 75% and above | Strong | Green |
| 45% to below 75% | Needs work | Amber |
| Below 45% | Weak | Red |

Boundaries are SS11 `quality.strengthScoreBands` (already in `thresholds.ts`).

**Strictness** (SS11 `quality.coachStrictness`, already in `thresholds.ts`):

| Level | Effect |
|---|---|
| `advisory` | Accepted, and since P9-T05 means the same as `warn` (adaptable-practice.md §2.1). |
| `warn` (canon default) | Each check runs at its practice level (METHOD.md §4, §12). Publication is held only by the publish gates set to block, gates 1 and 2 by default. |
| `strict` | Every check that is not off is raised to block, so every `warn` becomes a `fail`. Publish gates are still the hard stop. |

## 3. Band tables

Already implemented in `packages/method/src/scoring.ts`. Listed here for the
design gate's completeness. P4-T01 does not re-implement these; it re-exports
them from the quality catalogue's perspective.

### 3.1 Score bands (SS3.3)

| Score | Band | Meaning (aspirational) |
|---|---|---|
| 1.0 | Fully achieved | Achieved |
| 0.6 to below 1.0 | Strong | On target. The expected range for a stretch |
| 0.3 to below 0.6 | Partial | Examine what limited it |
| Below 0.3 | Little | Examine the target, the capacity, the cadence or the tracking |

A committed key result reads "Met" at 1.0 and "Missed. Explain the miss" below
it. A workspace may choose Doerr's colours instead, 0.7 and 0.4 (`scoreBandsIn`).

### 3.2 Score annotations (SS3.3)

First match wins. Nothing else gets a note.

| Score | Note |
|---|---|
| A pattern of 1.0 | Across a closed cycle, three quarters or more of the aspirational key results at 1.0: the targets were too safe (`tooSafePattern`) |
| Committed, below 1.0 | Write the short explanation of the miss |
| Below 0.3 | Little progress. Pick its root cause |

### 3.3 Confidence bands (SS3.2)

| Confidence | Band | Action |
|---|---|---|
| 0.7 and above | High | Nothing to do |
| 0.4 to below 0.7 | Medium | When it has dropped since last week, name what changes this week |
| Below 0.4 | Low | A next action due by the next check-in, with an owner |
| 0.3 and below (within low) | Critical | Escalates to the sponsor the same day only where the workspace turns it on |

### 3.4 Draft verdict (SS3.2)

Judged on the average confidence of the aspirational key results only.

| Average confidence at draft | Verdict |
|---|---|
| Above 0.90 | Near certain |
| Above 0.70, up to 0.90 | Comfortable |
| 0.30 to 0.70 | Sweet spot |
| Below 0.30 | Moonshot |

### 3.5 Portfolio verdict (SS3.4)

Over the scored aspirational key results. Committed key results are judged by
the share met (`committedShareMet`).

| Average score | Verdict |
|---|---|
| Above 0.85 | Targets too safe |
| 0.60 to 0.85 | Healthy |
| 0.40 to below 0.60 | Partial |
| Below 0.40 | Outran capacity |

### 3.6 Health precedence (SS3.5)

1. Closed outcome (achieved, missed or abandoned)
2. Outdated (past grace window)
3. Latest published check-in status
4. Pending (no check-in yet)

### 3.7 Progress signal (SS3.7)

Pace-aware by default (practice `progress.signal`): progress against the
progress expected for the date, amber when behind by more than 10 points and
red when behind by more than 25 (`scoring.progressSignalPaceGaps`). The
absolute signal below applies where the workspace chooses it, or when no cycle
dates are known.

| Progress | Signal |
|---|---|
| >= pass threshold (75%) | Green |
| < fail threshold (50%) | Red |
| Between | Amber |

## 4. KPI corridors (SS6.4)

Already implemented in `packages/method/src/kpi.ts`. Listed for completeness.

| Achievement | State |
|---|---|
| 90% and above | Healthy |
| 70% to below 90% | Watch |
| Below 70% | Unhealthy |
| Any, with active recovery OKR | Recovering |
| No data | No data |

### 4.1 Recovery corridor behaviour

> **Built at P3-T14 in `packages/method/src/kpi-recovery.ts`.**
>
> `draftRecovery` drafts the recovery objective, `kpiEffectiveHealth` projects
> health during recovery as the higher of real achievement and
> `start + progress * (healthy - start)`, and `shouldProposeRecoveryClose`
> proposes the close once real achievement, never the effective figure, is
> healthy again. `kpi-engine.md` holds the full behaviour.

## 5. Blocker taxonomy (SS7.3)

Seven types. Exported as a typed union and a data array.

| Type | Definition | SS reference |
|---|---|---|
| `resource` | No capacity, budget or tools to progress the key result | SS7.3 |
| `dependency` | Progress waits on another team's output or decision | SS7.3 |
| `clarity` | The key result is ambiguous. Nobody agrees what done means | SS7.3 |
| `priority_conflict` | Business as usual keeps displacing OKR work | SS7.3 |
| `external` | Market, regulation or partner factors beyond your control | SS7.3 |
| `approach_not_working` | The work is happening and the number is not moving | SS7.3, P9-T19a-a |
| `other` | Anything else, described in a line | SS7.3, P9-T19a-a |

Every blocker carries: opened time, owner, next action, due by the next
check-in of the goal it blocks (P9-T19a-a; it was a 24-hour clock).

## 6. Root-cause taxonomy (SS8.4)

Nine causes for every key result scoring below its root-cause threshold.

| # | Cause | SS reference |
|---|---|---|
| 1 | Ambition set too high | SS8.4 |
| 2 | Wrong key result: measured the wrong thing | SS8.4 |
| 3 | Blocked by a dependency | SS8.4 |
| 4 | Capacity or resourcing | SS8.4 |
| 5 | Priority shifted mid-cycle | SS8.4 |
| 6 | External or market change | SS8.4 |
| 7 | Lack of focus: too many OKRs | SS8.4 |
| 8 | No clear owner or cadence | SS8.4 |
| 9 | Other, described in a line | SS8.4, P9-T20c |

The threshold below which a cause is required: SS11
`scoring.rootCauseThreshold` (0.6 for aspirational, 1.0 for committed, already
in `thresholds.ts`).

## 7. Process-health statements (SS8.5)

Five statements, anonymous, 1 (not true) to 5 (consistently true).

| # | Statement |
|---|---|
| 1 | Our OKRs stayed visible and were genuinely used to make decisions this cycle |
| 2 | We held a real check-in cadence, not a status report |
| 3 | Our key results measured outcomes, not activity we were going to do anyway |
| 4 | We had few enough OKRs that focus was possible |
| 5 | When something went off track, we said so early rather than at the end |

The lowest-scoring statement becomes next cycle's process OKR (SS8.5, SS8.9
feed-forward).

The rhythm for the diagnostic (SS8.6) is measured: the share of due check-ins
published within tolerance (`onTimeShare`, P9-T20d). The average of statements
2 and 5 (`rhythmScore`) is shown beside it as a cross-check.

## 8. Management-retro questions (SS8.7)

Four questions leadership answers out loud.

| # | Question |
|---|---|
| 1 | Were we focused on the right priorities? |
| 2 | Did our OKRs bridge strategy and execution? |
| 3 | Did we change how we work, or reinforce old habits? |
| 4 | Where did alignment break down? |

## 9. The rhythm diagnostic (SS8.6)

The diagnostic combines the cycle score (SS3.4 average over the scored
aspirational key results) with the measured rhythm (the share of due check-ins
published within tolerance).

| Condition | Diagnosis | Prescription |
|---|---|---|
| Cycle score >= 0.6 | Results delivered | The question is not effort. It is whether the ambition was set high enough to be worth the quarter |
| Cycle score < 0.6, rhythm >= 0.75 | Likely a strategy or OKR-quality problem | The team ran the rhythm and still missed. Look first at the OKRs themselves, or the strategy behind them, before you push the team |
| Cycle score < 0.6, rhythm < 0.75 | Likely a rhythm problem | This looks like a cadence problem, not an ambition problem. Restore the weekly check-in before you rewrite a single objective |

Thresholds: SS11 `sessions.diagnosticCycleScore` (0.6) and
`sessions.diagnosticRhythm` (0.75), both already in `thresholds.ts`.

## 10. Facilitator guidance (SS9)

Already implemented in `packages/method/src/guidance.ts`. Eight phase entries.
P4-T01 does not change these.

## 11. The coach watch list (SS10)

Twenty situations from METHOD.md SS10. Each maps to a check in SS4 or SS5, or a
trigger in AI-NATIVE-PLAN.md SS6.4. The package exports them as `COACH_LINES`
in `packages/method/src/coach.ts`, each with the line the coach says, and the
conformance suite compares both columns with SS10 word for word (P9-T21).

**Rewritten at P9-T21 from the revised SS10.** Three rows changed what they
cite: a near-certain aspirational set is KR-6, a committed key result below
0.7 confidence is `quality.committed_floor`, and a fall into the low band is
`confidence.critical`. Level skips (AL-3) and silos (AL-6) left the list,
because both are off by default and join it only under a stricter profile.
"Check-in overdue past grace" cites `checkin.stale`, the trigger that fires
when the grace runs out, rather than `checkin.overdue`, which fires the day
after the due date.

| # | Situation | Fires on | Rule key |
|---|---|---|---|
| 1 | Objective starts with an output verb | OBJ-1 | `OBJ-1` |
| 2 | Objective contains numbers | OBJ-2 | `OBJ-2` |
| 3 | Metric key result has no baseline | KR-2 | `KR-2` |
| 4 | Key result measures activity volume | KR-5 | `KR-5` |
| 5 | Tagged key results are all lagging | KR-4 | `KR-4` |
| 6 | Aspirational set near certain at draft | KR-6 | `KR-6` |
| 7 | Committed key result below 0.7 confidence, at drafting or at a check-in | Scoring engine | `quality.committed_floor` |
| 8 | More than five company objectives | OBJ-5 | `OBJ-5` |
| 9 | Not-doing list empty at the end of an annual Phase 3 | CY-5 | `CY-5` |
| 10 | Goal with no parent and no stated reason | AL-1 | `AL-1` |
| 11 | Two goals may double-count a metric | Semantic (Coach) | `quality.conflict` |
| 12 | Dependency unconfirmed | AL-5 | `AL-5` |
| 13 | Capacity check with nothing cut | CY-6 | `CY-6` |
| 14 | Check-in overdue past grace | Cadence engine | `checkin.stale` |
| 15 | Blocker action past the next check-in | Cadence engine | `blocker.overdue` |
| 16 | Confidence fell into the low band | Scoring engine | `confidence.critical` |
| 17 | Reported health disagrees with the data | Scoring engine | `quality.divergence` |
| 18 | Trend forecast misses the target | Scoring engine | `quality.trending_off` |
| 19 | KPI turns unhealthy | KPI engine | `kpi.unhealthy` |
| 20 | Pattern of 1.0s on aspirational key results at the close | Scoring engine | `quality.sandbagging_close` |

Items 7, 11 and 14 to 20 are triggers from AI-NATIVE-PLAN.md SS6.4 rather than
quality checks. They fire at runtime, not at drafting time. Their rule keys
must resolve inside the package (CLAUDE.md hard rule: "A message citing a
rule the package does not define fails the build").

**Corrected on 2026-08-18.** This table originally gave those seven its own key
names, `COACH-CONFLICT` and `RHYTHM-CHECKIN-OVERDUE` among them, for rules that
already had keys in AI-NATIVE-PLAN.md SS6.4. Two names for one rule is the exact
drift the package exists to prevent, and the plan outranks a design document, so
the SS6.4 keys stand and these are them. `pnpm method:check` now refuses any key
in this table that the trigger catalogue or the quality catalogue does not
define, so the mistake cannot come back.

## 12. Publish gates (SS4.5)

Already implemented in `packages/method/src/workflow.ts`. Six gates, each a
predicate over the cycle's set, each with an enforcement level from the
practice (`gates.1` to `gates.6`).

| Gate | Condition | Default level |
|---|---|---|
| 1 | Every objective has a title and an owner, and a reviewer where required | Block |
| 2 | Every objective has key results, and nothing fails a check set to block | Block |
| 3 | Alignment mapped: each objective states contribution, or why it stands alone | Warn |
| 4 | Every dependency confirmed, escalated or risk-owned | Warn |
| 5 | Capacity checked: no committed OKR at "exceeds" | Warn |
| 6 | Publication date set before day one of the cycle | Off |

P4-T01 does not re-implement these. P4-T03 enforces them server-side with the
override path.

## 13. Phase completion conditions (SS2.3)

Already implemented in `packages/method/src/workflow.ts`. P4-T01 adds nothing
here. Phases 6 and 7 returned `todo` until P4-T07 and P4-T09 built the session
tables; they now read the booked cadence, the decision log, the key result
scores and the retrospective.

## 14. Threshold registry (SS11)

Already implemented in `packages/method/src/thresholds.ts` with 50 parameters
at the time (67 today). P4-T01 adds:

| New key | Group | Default | Reason |
|---|---|---|---|
| None | | | See below |

**No new §11 parameter.** This table proposed `quality.wordLists`, and it was
withdrawn on review because §11 already answers it the other way.
`packages/method/src/thresholds.ts` records the rule in its own header: the §4
word lists are "data but not numeric", excluded from the registry deliberately
at P3-T02, alongside §2.4's planning timelines and the formula evaluator's
safety bounds. §11's own sentence is that a value not in the registry is not a
setting; admitting a non-numeric map would change what the registry is, and that
is a METHOD decision rather than a design one.

Workspace additions to the word lists therefore belong in the TECHNICAL-PLAN
§4.14 settings map, with a default that a fresh workspace resolves without
configuration, which is where every other non-numeric preference already lives.

**Since reversed.** METHOD.md §11 now carries the lists as the "Quality word
lists" parameter, and `thresholds.ts` registers it as `quality.wordLists`, with
`QUALITY_WORD_LISTS` from `word-lists.ts` as its default. A workspace's
additions are unioned onto the canon terms by `resolveThresholds`, so the canon
terms always remain.

No other SS11 parameters are needed: every band, corridor, cap and boundary the
quality engine fires on is already registered.

## 15. The OKR corpus

The design gate's acceptance criterion requires a corpus of real OKR drafts with
expected verdicts. This section is the corpus. Each entry lists an objective, its
key results, and the expected check verdict for every applicable check.

### Corpus entry 1: output-shaped objective

**Objective:** "Launch the new mobile app by end of Q3"

| Check | Verdict | Reason |
|---|---|---|
| OBJ-1 | warn | Starts with output verb "Launch". A fail until P9-T03a (2 October 2026), when METHOD.md §4.1 made every OBJ-1 row a warning |
| OBJ-2 | pass | 9 words, no digits (Q3 is not a digit) |
| OBJ-3 | pass | Cycle is set (Q3) |
| OBJ-4 | pass | Champion and reviewer named |
| OBJ-5 | pass | Within unit cap |

### Corpus entry 2: metric-as-objective

**Objective:** "Increase revenue by 30%"

| Check | Verdict | Reason |
|---|---|---|
| OBJ-1 | warn | Bare metric movement with no why (starts with movement verb, contains a number, no why marker). A fail until P9-T03a |
| OBJ-2 | warn | Contains digits ("30") |
| OBJ-3 | pass | Cycle set |
| OBJ-4 | pass | Owned |
| OBJ-5 | pass | Within cap |

### Corpus entry 3: strong outcome objective

**Objective:** "Become the preferred platform for mid-market teams"

| Check | Verdict | Reason |
|---|---|---|
| OBJ-1 | pass | Names a change in state ("Become the preferred") |
| OBJ-2 | pass | 8 words, no digits |
| OBJ-3 | pass | Cycle set |
| OBJ-4 | pass | Owned |
| OBJ-5 | pass | Within cap |

**Key results:**

1. "Increase NPS from 32 to 50" (lagging, increase, baseline 32, target 50)
2. "Cut onboarding time from 14 days to 3 days" (leading, reduce, baseline 14, target 3)
3. "Grow active mid-market accounts from 120 to 300" (lagging, increase, baseline 120, target 300)

| Check | Verdict | Reason |
|---|---|---|
| KR-1 | pass | 3 key results |
| KR-2 | pass (all) | Each carries "from X to Y" |
| KR-3 | pass | Baseline, target, date and owner present on all |
| KR-4 | pass | Mix of lagging and leading |
| KR-5 | pass | All measure impact words (NPS, time, accounts) |
| KR-6 | depends on confidence | Delegates to draft verdict |
| KR-7 | pass | All carry direction |

### Corpus entry 4: activity-shaped key results

**Objective:** "Delight our enterprise customers"

**Key results:**

1. "Hold 12 customer interviews per month" (leading, increase, baseline 0, target 12)
2. "Send 50 personalised outreach emails" (leading, increase, baseline 0, target 50)
3. "Complete the onboarding redesign" (leading, move, baseline 0, target 1)

| Check | Verdict | Reason |
|---|---|---|
| KR-1 | pass | 3 key results |
| KR-2 | warn (all three) | KR-2 reads the text, not the fields: KR1 and KR2 carry one number each, KR3 none |
| KR-3 | pass | All have baseline and target |
| KR-4 | warn | All leading, no lagging |
| KR-5 | pass | Every key result here is tagged leading, and since P9-T03a a leading key result is exempt from KR-5 (METHOD.md §4.2). Untagged, the same texts warn on all three: KR1 and KR2 are activity nouns with no impact, KR3 is an output verb with fewer than two numbers. Until P9-T03a this row read fail (KR1), warn (KR2), warn (KR3) |
| KR-6 | depends on confidence | |
| KR-7 | pass | All carry direction |

### Corpus entry 5: alignment gaps

**Setup:** Two department objectives, no company anchor, one team goal skipping
to company level, one department with no horizontal dependencies.

| Check | Verdict | Reason |
|---|---|---|
| AL-1 | warn (for orphaned goal) | No parent, no stated contribution and no standalone reason. Read fail until P9-T16b-a |
| AL-2 | pass | Single parent on all |
| AL-3 | warn (for team goal) | Team goal aligned straight to company. Only where the workspace turns AL-3 on; it is off by default |
| AL-4 | warn | No company-level objective anchors the tree. Read fail until P9-T16b-a, when METHOD v2's "Warn" moved in |
| AL-5 | pass | All dependencies confirmed |
| AL-6 | warn (for isolated dept) | Department subtree has no horizontal dependency. Only where the workspace turns AL-6 on; it is off by default |

### Corpus entry 6: cycle readiness

**Setup:** Input pack with 4 items of 7, no prior cycle score, 3 strategic
issues, 4 priorities, not-doing list empty, capacity unchecked, one
unconfirmed dependency, no sessions booked.

| Check | Verdict | Reason |
|---|---|---|
| CY-1 | fail | Input pack incomplete (4 of 7) |
| CY-2 | fail | No prior cycle score and not declared as first cycle |
| CY-3 | pass | 3 issues, at the minimum of 3 (the floor moved from 5 on 2026-08-17) |
| CY-4 | pass | 4 priorities, within 3-5 |
| CY-5 | fail | Not-doing list empty |
| CY-6 | fail | Capacity not checked |
| CY-7 | fail | Unconfirmed dependency without risk owner |
| CY-8 | fail | Sessions not booked |

### Corpus entry 7: perfect set at strict mode

**Setup:** A strong objective with 3 strong key results, all checks passing.
Coach strictness set to `strict`.

Expected strength score: 100% (all pass, no warns). No change from warn mode
because there are no warns to promote.

### Corpus entry 8: borderline set

**Setup:** An objective with one output verb inside the text (not at the start),
4 key results where one has only one number, all lagging, company level at 5
objectives.

| Check | Verdict at warn | Verdict at strict |
|---|---|---|
| OBJ-1 | warn (output verb inside, not at start) | fail |
| OBJ-2 | pass | pass |
| OBJ-5 | pass (at cap, not over) | pass |
| KR-1 | pass (4) | pass |
| KR-2 | warn (1 KR with single number) | fail |
| KR-4 | info (all lagging; KR-4's default level is info, which counts as a pass) | fail |

Strength at warn: (4 passes + 0.5 * 2 warns) / 6 evaluated = 83% (green).
Strength at strict: (3 passes + 0 warns) / 6 evaluated = 50% (amber).

## 16. Conformance suite specification

P4-T01 builds `pnpm method:check`, the conformance suite. It does three things:

1. **Rule-key coverage.** Every rule key referenced in SS10 and SS6.4 resolves
   to an entry the package exports. A message citing a rule the package does not
   define is a build failure.

2. **Threshold drift.** The SS11 defaults in `thresholds.ts` match the values
   in METHOD.md SS11. A changed default without a changed document fails the
   build.

3. **Corpus coverage.** Every SS15 corpus entry above is named by a test in
   `packages/method/test/quality.test.ts`, which asserts its verdicts.

The suite has grown since: it also compares the word lists, the practice
settings and profiles, the section links and METHOD.md's enumerations with the
package (`scripts/method-check.ts`).

## 17. Acceptance criteria

Given the corpus of real OKR drafts (SS15 above), when the package evaluates
them, then every verdict matches the reviewed expectation.

Given a threshold default in `thresholds.ts` that differs from METHOD.md SS11,
when `pnpm method:check` runs, then the build fails naming the parameter.

Given a message citing a rule key the package does not define, when the build
runs, then it fails naming the key.

Given an objective beginning with an output verb, when the quality engine
evaluates it, then OBJ-1 returns `warn` with its coaching prompt.

Given strict mode enabled, when the quality engine evaluates a set with three
warnings, then all three become failures and the strength score drops
accordingly.
