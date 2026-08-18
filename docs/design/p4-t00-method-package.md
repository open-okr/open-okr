# P4-T00: the method package design

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
| `alignment.ts` | SS5.2 | P3-T09 | Alignment score, penalties, finding types |
| `escalation.ts` | SS6.3 | P3-T06 | Escalation ladder data |
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
  readonly status: "pass" | "warn" | "fail" | "todo";
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
| OBJ-1 | Outcome, not output | 6 rows (SS4.1) | Output verbs, Movement verbs, State words, Why markers |
| OBJ-2 | Inspiring and directional | 4 rows (SS4.1) | None (digit and length checks) |
| OBJ-3 | Timebound | 1 row: fail without cycle or explicit timeframe | None |
| OBJ-4 | Owned | 2 rows: fail without champion, fail without reviewer | None |
| OBJ-5 | Counted | 2 rows: warn > 3 per unit, fail > 5 at company level | None |

#### Key result checks (7)

| ID | Title | Conditions | Word lists used |
|---|---|---|---|
| KR-1 | Count | 3 rows: pass 2-5, warn 1, fail 0 or >5 | None |
| KR-2 | Measurable | 3 rows: pass "from X to Y" or 2 numbers, warn 1 number, fail 0 | None |
| KR-3 | Complete | 1 row: fail if baseline, target, date or owner missing | None |
| KR-4 | Leading and lagging mix | 4 rows: fail untagged, pass mixed, warn all lagging, warn all leading | None |
| KR-5 | Impact, not effort | 4 rows (SS4.2) | Activity nouns, Impact words |
| KR-6 | Ambitious but honest | Delegates to SS3.2 draft verdict on set average confidence | None |
| KR-7 | Direction set | 1 row: fail unless direction is increase, reduce, maintain or move | None |

#### Alignment checks (6)

| ID | Title | Conditions |
|---|---|---|
| AL-1 | Supports a bigger priority | 3 rows: fail no parent and no contribution, warn contribution < 3 words, pass |
| AL-2 | One parent only | 1 row: fail if both parent goal and parent key result set |
| AL-3 | No level skip | 1 row: flag when a team goal aligns straight to company |
| AL-4 | Company anchor | 1 row: fail if no company-level objective anchors the tree |
| AL-5 | Dependencies declared | 1 row: fail if any cross-team dependency is neither confirmed nor risk-owned |
| AL-6 | Not siloed | 1 row: flag a department whose subtree has no horizontal dependency |

#### Cycle checks (8)

These feed phase completion and publish gates, not the strength score.

| ID | Title | Condition |
|---|---|---|
| CY-1 | Input pack complete | Complete and distributed >= 3 working days before session one |
| CY-2 | Prior cycle scored | Prior cycle scored, or first cycle explicitly declared |
| CY-3 | Strategic issues | 5 to 10 listed and ranked by impact |
| CY-4 | Priorities set | 3 to 5, each with a 12-month success statement |
| CY-5 | Not-doing list | Written |
| CY-6 | Capacity checked | Nothing left at "exceeds", cuts recorded |
| CY-7 | Dependencies confirmed | Every dependency confirmed or risk-owned |
| CY-8 | Sessions booked | Every check-in and review booked for the whole cycle |

### 1.3 Word lists

Exported as named arrays of lowercase strings. The canon terms are immutable.
A workspace may add terms through a §4.14 setting; the canon terms remain. Not a
§11 parameter: see the registry note below.

| List name | Used by | Words |
|---|---|---|
| `outputVerbs` | OBJ-1 | launch, build, ship, implement, create, deliver, release, complete, develop, deploy, write, publish, migrate, install, conduct, hold, organise, organize, set up, roll out, rollout, hire, redesign, finish, produce, run |
| `movementVerbs` | OBJ-1 | increase, grow, improve, reduce, boost, raise, cut, double, triple, maximise, maximize, minimise, minimize, decrease, accelerate, expand, drive |
| `stateWords` | OBJ-1 | become, be the, delight, delighted, loved, trusted, leading, best, strongest, profitable, sustainable, engaged, thriving, world-class, preferred, go-to, healthiest, excellence, dominant, known for, famous for, proud |
| `whyMarkers` | OBJ-1 | to, so that, in order to, because |
| `activityNouns` | KR-5 | call, meeting, interview, demo, email, workshop, session, training, webinar, post, visit, proposal, campaign, feature, report, presentation, event, ticket, article, sprint, task, activity, outreach, touchpoint (and plurals) |
| `impactWords` | KR-5 | revenue, pipeline, conversion, retention, churn, nps, csat, satisfaction, margin, profit, growth, adoption, activation, engagement, win rate, quality, insight, market share, loyalty, renewal, upsell, arr, mrr, ltv, cac, accuracy, uptime, productivity, time-to-value, referrals, deal size |

### 1.4 Weak and strong examples

From METHOD.md SS4.6. Each pair is attached to the check that would fire on the
weak version.

| Weak | Strong | Fires check | Why |
|---|---|---|---|
| Launch the new mobile app by end of Q3 | Make mobile the way our customers prefer to reach us | OBJ-1 | Launch is output. The strong version names the change in behaviour |
| Improve customer satisfaction | Increase NPS from 32 to 50 (lagging). Cut first-response time from 9h to 2h (leading) | KR-2, KR-4 | No baseline, no target, no direction tag |
| Hold 12 customer interviews | Raise activation rate of new sign-ups from 41% to 60% | KR-5 | Interviews are activity, not impact |
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
| `advisory` | Verdicts are shown. Nothing blocks. |
| `warn` (canon default) | Warnings are shown. Only the six publish gates block. |
| `strict` | Every `warn` becomes a `fail`. Publish gates are still the hard stop. |

## 3. Band tables

Already implemented in `packages/method/src/scoring.ts`. Listed here for the
design gate's completeness. P4-T01 does not re-implement these; it re-exports
them from the quality catalogue's perspective.

### 3.1 Score bands (SS3.3)

| Score | Band | Meaning |
|---|---|---|
| 0.9 and above | Fully achieved | Check ambition |
| 0.7 to below 0.9 | Strong | Intended level for stretch |
| 0.4 to below 0.7 | Partial | Examine what limited it |
| Below 0.4 | Little | Examine target, capacity, or tracking |

### 3.2 Score annotations (SS3.3)

| Score | Note |
|---|---|
| 1.0 | The target was too safe |
| 0.6 to below 1.0 | On the intended level |
| 0.3 to below 0.6 | (none) |
| Below 0.3 | Disconnected from capacity |

### 3.3 Confidence bands (SS3.2)

| Confidence | Band | Action |
|---|---|---|
| 0.7 and above | High | Move to next key result |
| 0.4 to below 0.7 | Medium | Name what changes this week |
| Below 0.4 | Low | Capture blocker, name owner and next action in 24h |
| 0.3 and below (within low) | Critical | Coordinator raises with management same day |

### 3.4 Draft verdict (SS3.2)

| Average confidence at draft | Verdict |
|---|---|
| Above 0.90 | Sandbagging |
| Above 0.75, up to 0.90 | Comfortable |
| 0.40 to 0.75 | Sweet spot |
| 0.25 to below 0.40 | Ambitious |
| Below 0.25 | Moonshot |

### 3.5 Portfolio verdict (SS3.4)

| Average score | Verdict |
|---|---|
| Above 0.85 | Targets too safe |
| 0.60 to 0.85 | Healthy |
| 0.40 to below 0.60 | Partial |
| Below 0.40 | Outran capacity |

### 3.6 Health precedence (SS3.5)

1. Closed outcome (achieved or missed)
2. Outdated (past grace window)
3. Latest published check-in status
4. Pending (no check-in yet)

### 3.7 Progress signal (SS3.7)

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

> **BLOCKED: awaits P3-T14 (KPI trees, corridors, recovery OKRs).**
>
> P3-T14 implements the recovery drafter, the effective health projection
> during recovery, and the close proposal. This section will document the
> corridor behaviour during recovery: the effective health formula
> `start + progress * (healthy - start)`, the close condition, and the
> interaction between recovery status and real achievement.

## 5. Blocker taxonomy (SS7.3)

Five types. Exported as a typed union and a data array.

| Type | Definition | SS reference |
|---|---|---|
| `resource` | No capacity, budget or tools to progress the key result | SS7.3 |
| `dependency` | Progress waits on another team's output or decision | SS7.3 |
| `clarity` | The key result is ambiguous. Nobody agrees what done means | SS7.3 |
| `priority_conflict` | Business as usual keeps displacing OKR work | SS7.3 |
| `external` | Market, regulation or partner factors beyond your control | SS7.3 |

Every blocker carries: opened time, owner, next action, 24-hour clock.

## 6. Root-cause taxonomy (SS8.4)

Eight causes for every key result scoring below 0.7.

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

The threshold below which a cause is required: SS11
`scoring.rootCauseThreshold` (0.7, already in `thresholds.ts`).

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

The rhythm score for the diagnostic (SS8.6) is the average of statements 2
and 5.

## 8. Management-retro questions (SS8.7)

Four questions leadership answers out loud.

| # | Question |
|---|---|
| 1 | Were we focused on the right priorities? |
| 2 | Did our OKRs bridge strategy and execution? |
| 3 | Did we change how we work, or reinforce old habits? |
| 4 | Where did alignment break down? |

## 9. The rhythm diagnostic (SS8.6)

The diagnostic combines the cycle score (SS3.4 portfolio average) with the
rhythm score (average of process-health statements 2 and 5).

| Condition | Diagnosis | Prescription |
|---|---|---|
| Cycle score >= 0.7 | Results delivered | The question is whether the ambition was set high enough |
| Cycle score < 0.7, rhythm >= 3.5 | Strategy or OKR-quality problem | The team ran the rhythm and still missed. Fix the key results before you push the team |
| Cycle score < 0.7, rhythm < 3.5 | Rhythm problem | This is a cadence problem. Restore the weekly check-in before you rewrite a single objective |

Thresholds: SS11 `sessions.diagnosticCycleScore` (0.7) and
`sessions.diagnosticRhythmScore` (3.5), both already in `thresholds.ts`.

## 10. Facilitator guidance (SS9)

Already implemented in `packages/method/src/guidance.ts`. Eight phase entries.
P4-T01 does not change these.

## 11. The coach watch list (SS10)

Twenty situations from METHOD.md SS10. Each maps to a check in SS4 or a trigger
in AI-NATIVE-PLAN.md SS6.4. The package exports them as a data array keyed by
the rule they cite.

| # | Situation | Fires on | Rule key |
|---|---|---|---|
| 1 | Objective starts with output verb | OBJ-1 | `OBJ-1` |
| 2 | Objective contains numbers | OBJ-2 | `OBJ-2` |
| 3 | Key result has no baseline | KR-2 | `KR-2` |
| 4 | Key result measures activity volume | KR-5 | `KR-5` |
| 5 | All key results are lagging | KR-4 | `KR-4` |
| 6 | Average confidence above 0.9 at draft | KR-6 | `KR-6` |
| 7 | More than five company objectives | OBJ-5 | `OBJ-5` |
| 8 | Not-doing list empty at Phase 3 exit | CY-5 | `CY-5` |
| 9 | Goal with no parent | AL-1 | `AL-1` |
| 10 | Level skip in the cascade | AL-3 | `AL-3` |
| 11 | Department with no horizontal dependencies | AL-6 | `AL-6` |
| 12 | Two goals double-counting a metric | Semantic (Coach) | `quality.conflict` |
| 13 | Dependency unconfirmed and unowned | AL-5 | `AL-5` |
| 14 | Capacity check with nothing cut | CY-6 | `CY-6` |
| 15 | Check-in overdue past grace | Cadence engine | `checkin.overdue` |
| 16 | Blocker past 24h clock | Cadence engine | `blocker.overdue` |
| 17 | Reported health disagrees with data | Scoring engine | `quality.divergence` |
| 18 | Trend forecast misses target | Scoring engine | `quality.trending_off` |
| 19 | KPI drops out of corridor | KPI engine | `kpi.unhealthy` |
| 20 | Scores near 1.0 at close | Scoring engine | `quality.sandbagging_close` |

Items 12, 15-20 are triggers from AI-NATIVE-PLAN.md SS6.4 rather than SS4
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
predicate over the cycle's set.

| Gate | Condition |
|---|---|
| 1 | Every objective has title, champion and reviewer |
| 2 | Every key result passes SS4.2 checks |
| 3 | Alignment mapped: each objective states contribution |
| 4 | Every dependency confirmed or risk-owned |
| 5 | Capacity checked: nothing at "exceeds" |
| 6 | Publication date set before day one of the cycle |

P4-T01 does not re-implement these. P4-T03 enforces them server-side with the
override path.

## 13. Phase completion conditions (SS2.3)

Already implemented in `packages/method/src/workflow.ts`. P4-T01 adds nothing
here. Phases 6 and 7 return `todo` until P4-T07 and P4-T09 build the session
tables.

## 14. Threshold registry (SS11)

Already implemented in `packages/method/src/thresholds.ts` with 50 parameters.
P4-T01 adds:

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
| OBJ-1 | fail | Starts with output verb "Launch" |
| OBJ-2 | pass | 9 words, no digits (Q3 is not a digit) |
| OBJ-3 | pass | Cycle is set (Q3) |
| OBJ-4 | pass | Champion and reviewer named |
| OBJ-5 | pass | Within unit cap |

### Corpus entry 2: metric-as-objective

**Objective:** "Increase revenue by 30%"

| Check | Verdict | Reason |
|---|---|---|
| OBJ-1 | fail | Bare metric movement with no why (starts with movement verb, contains a number, no why marker) |
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
| KR-2 | warn (KR3) | KR3 has only 1 number |
| KR-3 | pass | All have baseline and target |
| KR-4 | warn | All leading, no lagging |
| KR-5 | fail (KR1), warn (KR2), warn (KR3) | KR1: "interviews" is activity noun, no impact. KR2: "outreach emails" is activity noun. KR3: "Complete" is output verb with < 2 numbers |
| KR-6 | depends on confidence | |
| KR-7 | pass | All carry direction |

### Corpus entry 5: alignment gaps

**Setup:** Two department objectives, no company anchor, one team goal skipping
to company level, one department with no horizontal dependencies.

| Check | Verdict | Reason |
|---|---|---|
| AL-1 | fail (for orphaned goal) | No parent and no stated contribution |
| AL-2 | pass | Single parent on all |
| AL-3 | fail (for team goal) | Team goal aligned straight to company |
| AL-4 | fail | No company-level objective anchors the tree |
| AL-5 | pass | All dependencies confirmed |
| AL-6 | fail (for isolated dept) | Department subtree has no horizontal dependency |

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
| KR-4 | warn (all lagging) | fail |

Strength at warn: (3 passes + 0.5 * 3 warns) / 6 evaluated = 75% (green, at boundary).
Strength at strict: (3 passes + 0 warns) / 6 evaluated = 50% (amber).

## 16. Conformance suite specification

P4-T01 builds `pnpm method:check`, the conformance suite. It does three things:

1. **Rule-key coverage.** Every rule key referenced in SS10 and SS6.4 resolves
   to an entry the package exports. A message citing a rule the package does not
   define is a build failure.

2. **Threshold drift.** The SS11 defaults in `thresholds.ts` match the values
   in METHOD.md SS11. A changed default without a changed document fails the
   build.

3. **Corpus verdicts.** The SS15 corpus entries above, evaluated by the quality
   engine, produce exactly the expected verdicts.

## 17. Acceptance criteria

Given the corpus of real OKR drafts (SS15 above), when the package evaluates
them, then every verdict matches the reviewed expectation.

Given a threshold default in `thresholds.ts` that differs from METHOD.md SS11,
when `pnpm method:check` runs, then the build fails naming the parameter.

Given a message citing a rule key the package does not define, when the build
runs, then it fails naming the key.

Given an objective beginning with an output verb, when the quality engine
evaluates it, then OBJ-1 returns `fail` with its coaching prompt.

Given strict mode enabled, when the quality engine evaluates a set with three
warnings, then all three become failures and the strength score drops
accordingly.
