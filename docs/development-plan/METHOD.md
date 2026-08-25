# METHOD.md

The OKR practice canon. Every rule, threshold, band, ritual and diagnostic that OpenOKR encodes lives here.

This document answers one question: **what does good OKR practice look like, precisely enough to build?** It is the authority for the Draft Coach rule engine, the OKR Coach and OKR Champion agents, the scoring and health engines, the session flows, and every nudge the product sends. Product scope lives in REQUIREMENTS.md. Schema and engines live in TECHNICAL-PLAN.md. When one of those needs to know *what the right practice is*, it cites this file.

Terms used throughout:

| Term | Meaning |
|---|---|
| Objective | A qualitative statement of a desired future state. No numbers in it. |
| Key result (KR) | A measurable outcome that proves the objective is being achieved. Written as "from X to Y by date". |
| Cycle | The time box the OKRs are set and scored against. Usually a quarter, sometimes a year. |
| Champion | The one person accountable for a goal. They post the check-in. |
| Reviewer | The one person who acknowledges each check-in. |
| Sponsor | The senior leader accountable for the whole cycle. |
| Facilitator | The person who runs the sessions and guards quality. |
| Check-in | A short written update on a goal, with a snapshot of every KR value at that moment. |
| Confidence | A 0.0 to 1.0 belief that a KR will land. Forward-looking. |
| Score | A 0.0 to 1.0 measure of what actually happened. Backward-looking. |
| Leading indicator | An early signal you can act on this week. |
| Lagging indicator | The result you ultimately want, visible late. |

---

## 1. The operating principles

These are not preferences. Every rule below serves one of them.

1. **Objectives are destinations, key results are the proof.** If the objective contains a number, it is a key result in disguise. If a key result has no baseline and target, it is an opinion.
2. **Measure impact, not effort.** "Hold 12 interviews" is an output. "Raise activation from 41% to 60%" is an outcome. The output may be how you get there. It is never the goal.
3. **Focus is a decision, not a wish.** A priority list that accommodates everything is a to-do list. The not-doing list is as valuable as the priority list, and it must be written down.
4. **Stretch honestly.** Around 0.6 to 0.7 confidence at drafting is the target. Certainty means the target was too safe. Fantasy means nobody believes it.
5. **The rhythm is the product.** OKRs reviewed only at quarter end are worse than no OKRs. Weekly check-ins, monthly reviews and a quarterly close are booked before the cycle starts.
6. **Scores are planning data, never appraisal.** The moment a score feels like a performance review, candour dies and the numbers stop being useful.
7. **Nothing carries over by default.** Every cycle starts with a blank sheet. An objective that survives should survive on purpose.
8. **Neglect must be visible.** A goal nobody has updated cannot quietly stay green.
9. **Alignment is contribution, not copying.** A team's OKR states its own distinct contribution to the level above. It does not restate the parent.
10. **Diagnose before you prescribe.** A missed cycle with a strong rhythm is a strategy problem. A missed cycle with a weak rhythm is a cadence problem. They need opposite fixes.

---

## 2. The cycle model

### 2.1 Two horizons

| Horizon | Runs | Sets | Revisited |
|---|---|---|---|
| Annual | Once a year, about 6 weeks before the year starts | The annual frame (mission, vision, mid-term strategy), 2 to 5 annual strategies, up to 5 annual OKRs, the year's not-doing list | Never rewritten mid-year. Revalidated each quarter in 30 to 60 minutes |
| Quarterly | Four times a year, about 3 weeks before the quarter starts | Quarterly OKRs inside the annual frame | Scored and closed at the end of the quarter |

The annual frame is read-only reference material during a quarterly cycle. Phase 3 of a quarterly cycle revalidates it. It does not rewrite it.

### 2.2 The eight phases

Every cycle runs the same eight phases. Phase 0 runs only in an annual cycle.

| # | Phase | Output |
|---|---|---|
| 0 | Annual strategy | The annual frame and the annual OKRs |
| 1 | Prepare | Planning brief and a complete input pack |
| 2 | Diagnose | Scored prior OKRs and a ranked issue list |
| 3 | Set direction | A priority list for the horizon |
| 4 | Draft OKRs | A draft OKR set with owners, passing every quality check |
| 5 | Align and commit | A published, aligned OKR set |
| 6 | Run the cadence | Check-ins, reviews and a decision log |
| 7 | Review and learn | Scores, learnings and the next cycle's inputs |

Phases 0 to 5 happen before the cycle starts. Phase 6 runs through it. Phase 7 closes it and feeds the next one.

### 2.3 Phase completion rules

A phase is complete when all of its conditions hold. The product computes this. It is not self-reported.

| Phase | Complete when |
|---|---|
| 0 | Mission and mid-term strategy written, 2 to 5 annual strategies set, at least one annual OKR with key results |
| 1 | Sponsor and facilitator named, all 7 input-pack items gathered, pack distributed at least 3 working days before session one |
| 2 | Prior cycle scored (or first cycle declared), baseline health recorded, at least 3 strategic issues ranked |
| 3 | Annual: 3 to 5 priorities each with a 12-month success statement, not-doing list written, leadership agreement on the frame recorded. Quarterly: frame revalidated (holds or documented change) and focus areas chosen |
| 4 | Every objective and key result passes the §4 quality checks |
| 5 | All six publish gates green and the set published |
| 6 | Cadence booked for the whole cycle and at least one decision recorded |
| 7 | Every key result scored and the retrospective written |

### 2.4 Timeline

**Annual cycle**, weeks before the year starts:

| Weeks before | Activity |
|---|---|
| 6 to 5 | Phase 1: scope, roles, input pack |
| 4 | Phase 2: diagnosis session |
| 4 to 3 | Phase 3: direction-setting session with leadership |
| 3 to 2 | Phase 4: drafting sessions per unit, then peer review between teams |
| 2 to 1 | Phase 5: alignment session, capacity check |
| 1 to 0 | Sign-off, publication, Phase 6 calendar booked |

**Quarterly cycle**, weeks before the quarter starts:

| Weeks before | Activity |
|---|---|
| 3 | Phase 1 (light refresh) and Phase 2: input refresh, scoring |
| 2 | Phase 3 (revalidation) and Phase 4: drafting |
| 1 | Phase 5: alignment, sign-off, publication |

### 2.5 Roles

| Role | Owns | Rule |
|---|---|---|
| Sponsor | The cycle. Accountable senior leader | One per cycle. Escalations land here |
| Facilitator | The sessions and the quality bar | One per cycle. Can refuse to run Phase 4 without a complete input pack |
| Champion | One goal. Posts its check-ins | Exactly one per goal. Never a team, never a committee |
| Reviewer | Acknowledging that goal's check-ins | Exactly one per goal. Different person from the champion where possible |
| Contributor | Work that moves a key result | Any number |
| Coordinator | The weekly session for a space | One per space. Runs the check-in, chases blockers |

### 2.6 The input pack

Phase 4 must not run without these seven items. This is the single most common failure point in an OKR programme.

1. Mission, vision and current strategy documents
2. Prior cycle OKRs with scores and retrospective notes
3. KPI dashboard or baseline health metrics
4. Customer feedback and market or competitor signals
5. Financial constraints: budget, headcount, committed spend
6. Committed projects and obligations that consume capacity
7. Open risks and dependencies carried over from the last cycle

Distribute at least three working days before the first session. An incomplete pack delivered on time beats a complete pack delivered late.

### 2.7 Levels and quantities

| Level | Objectives | Rule |
|---|---|---|
| Company | 1 to 5 | Hard cap at 5. If the annual set already contains everything, no quarter can choose |
| Department | 1 to 3 per department | |
| Team | 1 to 3 per team | |
| Individual | 0 to 3 | Optional. Many organisations stop at team level |

Every objective carries 2 to 5 key results. A unit may contribute to another unit's OKRs instead of setting its own. Record which units do this.

---

## 3. Scoring, confidence and health

Three different numbers. They are never mixed. Every numeric boundary in this section is a parameter in the §11 registry; the values shown are the canon defaults.

| Number | Range | Direction | Answers |
|---|---|---|---|
| Progress | 0 to 100% | Backward | How far has the value moved from baseline to target? |
| Confidence | 0.0 to 1.0 | Forward | Do we believe this will land? |
| Score | 0.0 to 1.0 | Backward, final | What did we actually achieve, judged at the close? |

### 3.1 Progress

Direction-aware linear interpolation, clamped to 0 to 100%.

| Direction | Formula |
|---|---|
| Increase | (current − baseline) / (target − baseline) |
| Reduce | (baseline − current) / (baseline − target) |
| Maintain | 100% while the value stays inside the stated band, otherwise the distance back to the band |
| Move | Treated as increase toward the target value |

Equal baseline and target scores 0. A goal's progress is the weighted average of its key results' progress, including the weighted contribution of goals aligned beneath it.

### 3.2 Confidence bands

| Confidence | Band | What happens |
|---|---|---|
| 0.7 and above | High | Move to the next key result |
| 0.4 to below 0.7 | Medium | Name what changes this week |
| Below 0.4 | Low | Capture a blocker, name an owner and a next action within 24 hours |

One further rule inside the low band: at 0.3 and below, the coordinator raises it with management the same day.

At drafting time, judge the *set*, not each key result:

| Average confidence at draft | Verdict |
|---|---|
| Above 0.90 | Sandbagging. If you are near certain, this is business as usual, not an OKR. Raise the targets |
| Above 0.75, up to 0.90 | Comfortable. Stretch until it feels like a 6 or 7 out of 10 |
| 0.40 to 0.75 | The sweet spot. A real stretch you still believe in |
| 0.25 to below 0.40 | Ambitious. Check that the team genuinely believes it is possible |
| Below 0.25 | A moonshot bordering on fantasy. Make sure there is a credible path |

### 3.3 Score bands

Scored at the close, against the key result as written. No partial credit for effort.

| Score | Meaning |
|---|---|
| 0.9 and above | Fully achieved. Check whether the target was ambitious enough |
| 0.7 to below 0.9 | Strong result. This is the intended level for a stretch target |
| 0.4 to below 0.7 | Partial progress. Examine what limited it |
| Below 0.4 | Little progress. Examine the target, the capacity, or the tracking |

Per key result, the coach annotates. First match wins; a score from 0.3 to below 0.6 gets no note:

| Score | Note |
|---|---|
| 1.0 | The target was too safe |
| 0.6 to below 1.0 | On the intended level |
| Below 0.3 | Disconnected from capacity |

### 3.4 Portfolio verdict

The average across a scored set.

| Average | Verdict |
|---|---|
| Above 0.85 | Targets were too safe |
| 0.60 to 0.85 | Healthy portfolio |
| 0.40 to below 0.60 | Partial. Examine what limited it |
| Below 0.40 | Targets outran capacity |

### 3.5 Health

Health is derived, never typed in. Precedence, first match wins:

1. **Closed outcome.** The goal is closed as achieved or missed.
2. **Outdated.** The check-in is overdue past the grace window. This overrides whatever the last check-in said.
3. **Latest published check-in status.** On track, caution, or off track.
4. **Pending.** No check-in yet.

A goal that has never been checked in is `pending`, not `on track`. Silence is never green.

### 3.6 Trend forecast

From the key result's value history, project the end-of-cycle value with a linear fit over the recent window. If the projection misses the target, flag `trending off track` before the human status changes. This is the coach's earliest honest signal.

### 3.7 The progress signal

Beside health, every goal and key result carries a red, amber or green signal computed from progress alone: green at or above the pass threshold, red below the fail threshold, amber between. The defaults are 75% and 50%, both workspace settings (§11). The signal is shown beside health, never instead of it. A green progress bar on an outdated goal still reads outdated.

---

## 4. The quality canon

Twenty-six checks across four groups: five objective checks, seven key result checks, six alignment checks and eight cycle checks. This is the Draft Coach engine's specification. Each check has a status, a coaching prompt, and a reason. In every condition table in this section, rows are evaluated top to bottom and the first matching row wins.

Statuses: **pass**, **warn** (worth another look), **fail** (fix before publishing), **todo** (waiting on input). In strict mode every warn becomes a fail.

**Strength score** = (passes + 0.5 × warns) / evaluated checks, as a percentage, computed over the objective, key result and alignment checks of the set being drafted. A todo check counts in the denominator and adds nothing. The cycle checks feed phase completion and the publish gates, not the strength score. Below 45% is red, 45% to below 75% is amber, 75% and above is green.

### 4.1 Objective checks

**OBJ-1 Outcome, not output.**

| Condition | Status | Coaching prompt |
|---|---|---|
| Starts with an output verb | fail | "Your objective starts with a deliverable, not a destination. If we do it and nothing changes, did we succeed? Rewrite around the change you want." |
| Contains an output verb anywhere | warn | "There is output language here. What would be true after this is done? Lead with that." |
| Bare metric movement, no why | fail | "Naming a metric to move is a key result in disguise. The outcome is the why behind the movement. Add the why, or lead with the end state." |
| Metric movement with a why | pass | "You have paired movement with a why. Stronger still: lead with the end state and let the key results carry the movement." |
| Names a change in state | pass | "This reads as a change in state, not a to-do. Keep the deliverables in your key results." |
| Cannot tell | warn | "Could you complete this without anything actually improving? If yes, rewrite around the improvement." |

Word lists:

| List | Words |
|---|---|
| Output verbs | launch, build, ship, implement, create, deliver, release, complete, develop, deploy, write, publish, migrate, install, conduct, hold, organise, organize, set up, roll out, rollout, hire, redesign, finish, produce, run |
| Movement verbs | increase, grow, improve, reduce, boost, raise, cut, double, triple, maximise, maximize, minimise, minimize, decrease, accelerate, expand, drive |
| State words | become, be the, delight, delighted, loved, trusted, leading, best, strongest, profitable, sustainable, engaged, thriving, world-class, prefer, preferred, go-to, healthiest, excellence, dominant, known for, famous for, proud |
| Why markers | to, so that, in order to, because |

**OBJ-2 Inspiring and directional.**

| Condition | Status | Prompt |
|---|---|---|
| Contains digits | warn | "Metrics belong in the key results. Keep the objective qualitative and memorable." |
| Fewer than 4 words | warn | "Very short. Would someone outside your team understand where you are headed and why it matters?" |
| More than 18 words | warn | "Trim it. If your team cannot recite it from memory, it will not steer their daily decisions." |
| 4 to 18 words, no digits | pass | "Good length and qualitative. Read it aloud. Would it make your team lean in?" |

**OBJ-3 Timebound.** Fail without a cycle or an explicit timeframe. An OKR without a deadline is a wish.

**OBJ-4 Owned.** Fail without a named champion. Fail without a named reviewer.

**OBJ-5 Counted.** Warn when a unit exceeds 3 objectives. Fail when the company level exceeds 5.

### 4.2 Key result checks

**KR-1 Count.** Pass at 2 to 5. Warn at 1 ("can a single measure prove this from every angle?"). Fail at 0, or above 5 ("which two would you drop if you had to? Drop them").

**KR-2 Measurable.** Pass when the text reads "from X to Y" or carries two numbers. Warn on a single number ("a target but no baseline. Without the from, you cannot prove movement"). Fail with no numbers ("what is the baseline today, and where must it land?").

**KR-3 Complete.** Fail if baseline, target, date or owner is missing. If a baseline is unknown, establishing it can be the first key result.

**KR-4 Leading and lagging mix.** Fail if any key result is untagged. Pass when the set holds at least one of each. Warn when all are lagging ("you will only find out at the end of the cycle whether it worked"). Warn when all are leading ("which key result proves the actual outcome landed?").

**KR-5 Impact, not effort.**

| Condition | Status | Prompt |
|---|---|---|
| Activity noun, no impact word, no purpose | fail | "This measures pure activity volume. That is an output however measurable it is. Ask why: more calls, to what end? Name that impact and make it the key result." |
| Output verb with fewer than two numbers | warn | "Reads like a milestone. What measurably changes because of it? Measure that instead." |
| Activity plus a why, but the target sits on the activity | warn | "Good instinct, but flip it. Measure the impact itself and keep the activity as a clearly tagged leading indicator at most." |
| Otherwise | pass | "These measure impact, not activity." |

| List | Words |
|---|---|
| Activity nouns | call, meeting, interview, demo, email, workshop, session, training, webinar, post, visit, proposal, campaign, feature, report, presentation, event, ticket, article, sprint, task, activity, outreach, touchpoint (and plurals) |
| Impact words | revenue, pipeline, conversion, retention, churn, nps, csat, satisfaction, margin, profit, growth, adoption, activation, engagement, win rate, quality, insight, market share, loyalty, renewal, upsell, arr, mrr, ltv, cac, accuracy, uptime, productivity, time-to-value, referrals, deal size |

**KR-6 Ambitious but honest.** Judged on the set's average confidence, per §3.2.

**KR-7 Direction set.** Fail unless the direction is one of increase, reduce, maintain, move.

### 4.3 Alignment checks

**AL-1 Supports a bigger priority.** Fail with no parent and no stated contribution ("if nothing comes to mind, that is the biggest red flag on this page"). Warn when the stated contribution is fewer than three words ("growth is not a priority, it is a word. Which growth goal, whose?"). Pass otherwise.

**AL-2 One parent only.** A goal aligns under exactly one parent goal or one parent key result, or neither. Never both.

**AL-3 No level skip.** A team goal aligns to a department goal, not straight to a company goal. Skips are recorded and flagged.

**AL-4 Company anchor.** At least one company-level objective anchors the tree.

**AL-5 Dependencies declared.** Every cross-team dependency is either confirmed by the providing team, or logged as a risk with a named risk owner.

**AL-6 Not siloed.** A department whose whole subtree has no horizontal dependency with any other department is flagged as a possible silo.

### 4.4 Cycle checks

| ID | Check |
|---|---|
| CY-1 | Input pack complete and distributed at least 3 working days before session one |
| CY-2 | Prior cycle scored, or first cycle explicitly declared |
| CY-3 | 3 to 10 strategic issues listed and ranked by impact |
| CY-4 | 3 to 5 priorities, each with a stated 12-month success |
| CY-5 | The not-doing list is written |
| CY-6 | Capacity checked, nothing left at "exceeds", and the cuts are recorded |
| CY-7 | Every dependency confirmed or risk-owned |
| CY-8 | Every check-in and review booked for the whole cycle |

### 4.5 Publish gates

The set cannot be published until all six are green.

1. Every objective has a title, a named champion and a named reviewer.
2. Every key result passes the §4.2 checks.
3. Alignment is mapped. Each objective states what it contributes to.
4. Every dependency is confirmed, or logged with a named risk owner.
5. Capacity is checked. Nothing is left marked as exceeding capacity.
6. A publication date is set before day one of the cycle.

### 4.6 Weak and strong examples

The coach shows these beside the check that fired.

| Weak | Strong | Why |
|---|---|---|
| Objective: Launch the new mobile app by end of Q3 | Objective: Make mobile the way our customers prefer to reach us | Launch is an output. You can launch and still fail. The strong version names the change in customer behaviour, and the launch becomes a means |
| KR: Improve customer satisfaction | KR: Increase NPS from 32 to 50 (lagging). KR: Cut first-response time from 9h to 2h (leading) | No baseline, no target, no way to score it. The strong pair sets from and to, and combines lagging proof with a leading signal you can steer weekly |
| KR: Hold 12 customer interviews | KR: Raise activation rate of new sign-ups from 41% to 60% | Interviews are activity. Ask what the interviews are for, and measure that outcome |
| KR: Increase sales calls from 40 to 120 per week | KR: Grow qualified pipeline from $1.2M to $3.0M (lagging). KR: Lift call-to-meeting conversion from 8% to 15% (leading) | Measurable, but still an output. If 120 calls create no pipeline, the key result was achieved and the quarter was wasted |

---

## 5. Alignment

### 5.1 Two directions

| Direction | Meaning | Recorded as |
|---|---|---|
| Vertical | This goal supports a goal one level up | A single parent pointer |
| Horizontal | This goal and another goal in a different team depend on each other | A two-way dependency link |

Vertical alignment is contribution, not copying. A team states its own distinct contribution to the level above.

### 5.2 Alignment health score

Starts at 100. Each finding subtracts. Floor 5, ceiling 100.

| Finding | Penalty |
|---|---|
| No company-level objective anchors the tree | 10 |
| A goal below company level has no parent | 12 each |
| An objective has no key results | 4 each |
| A goal skips a level | 3 each |
| A department and its whole subtree have no horizontal dependency | 8 each |

75 and above is healthy. Below 75 the coach lists the gaps, each linking straight to the goal that caused it.

### 5.3 Semantic review

Structure is not enough. Two goals can be perfectly wired and still pull against each other. The coach reads every objective and key result and returns typed findings:

| Type | Meaning |
|---|---|
| Relink | This goal's content actually supports a different parent better than its current one, or it is unaligned and this is the right parent |
| Dependency | These two goals share metrics or workstreams but no explicit horizontal link exists |
| Conflict | These two goals pull in opposite directions, or double-count the same metric |
| Gap | Something is missing or weak, with no second goal involved |

Each finding carries a severity of high, medium or low, one specific sentence of reasoning, and where the fix is mechanical (relink, dependency) a one-click apply. Findings are dismissible and stay dismissed.

### 5.4 Dependencies

Every dependency records: the key result that depends, the providing team, whether the providing team has confirmed it, and if not, a named risk owner. Anything unconfirmed and unowned blocks the publish gate.

### 5.5 Capacity

For every key result, record the main initiatives that will move it and one of three capacity verdicts: **fits**, **tight**, **exceeds**. Nothing may remain at "exceeds" when the set is published. The facilitator must record what was cut. If the answer is "nothing", capacity was not checked.

---

## 6. KPIs and recovery OKRs

### 6.1 What a KPI is here

A KPI is a number you watch every period whether or not it is an OKR. KPIs describe the health of the business. OKRs describe what you are changing about it. The two connect in three ways: a key result can be measured by a live KPI, an unhealthy KPI can trigger a recovery OKR, and the KPI baseline is a Phase 2 input.

### 6.2 KPI attributes

| Attribute | Values |
|---|---|
| Direction | Higher is better, lower is better |
| Type | Leading, lagging |
| Tier | Input, output, outcome, impact |
| Frequency | Daily, weekly, monthly, quarterly, yearly |
| Aggregate | Sum, average, max, min, count. Used when a finer period rolls into a coarser one |

### 6.3 The KPI tree

KPIs form a driver tree. Each child KPI drives its parent. A tree has one root, usually an impact-tier lagging KPI such as operating margin or revenue. Its children are outcome-tier, theirs are output-tier, and the leaves are input-tier leading indicators a team can act on this week.

Reading rule: to move the root, find the unhealthy branch, then find the leading drivers at its edge. Those drivers become key results.

### 6.4 Health corridors

Achievement is the direction-aware ratio of current to target.

| Achievement | State | Meaning |
|---|---|---|
| 90% and above | Healthy | At or above the healthy corridor |
| 70% to below 90% | Watch | Watch the leading drivers |
| Below 70% | Unhealthy | Launch a recovery OKR to focus the team |
| Any, with an active recovery OKR | Recovering | Health improves as the recovery key results progress |
| No data | No data | Enter a current value and a target |

State precedence, first match wins: no data, then recovering (an active recovery OKR), then the corridor band. Both thresholds are workspace settings (§11). The defaults are 90 and 70.

### 6.5 Recovery OKRs

When a KPI turns unhealthy, the product drafts a recovery OKR:

- **Objective**: "Bring *KPI name* back to *target*".
- **Key results**: up to four, one per leading driver at the edge of the unhealthy branch, each written "improve *driver* from *current* to *target*", inheriting the driver's owner. The drivers are found by walking the unhealthy KPI's subtree breadth-first: a leading child becomes a key result directly; a lagging child is descended through until its nearest leading descendants are found. The walk stops at four key results.
- If the subtree contains no leading KPI at all, one placeholder key result: "define the first leading driver to move".
- The KPI's achievement at launch is stored as the recovery starting point.

The draft is available for one-click launch the moment the KPI turns unhealthy. The proactive proposal from the coach fires only after two consecutive unhealthy periods, so a single bad period never triggers a drafted OKR.

While a recovery OKR is active the KPI reads **recovering**, and its displayed health is the higher of its real achievement and a projection: `start + progress × (healthy threshold − start)`. That makes the recovery visible before the lagging number catches up. When real achievement re-enters the healthy corridor, the coach proposes closing the recovery OKR.

### 6.6 Recovery board

One list across every KPI tree in the workspace: every KPI that is unhealthy or recovering, with its achievement, its recovery objective and progress, and a one-click launch for those that have none. This is the KPI equivalent of the review inbox.

### 6.7 Calculated KPIs

A KPI may be calculated from a formula over other KPIs rather than entered. Sources at a finer frequency roll up using their own aggregate function. Changing a source recomputes every dependent KPI. Self-reference and cycles are rejected.

---

## 7. The rhythm

### 7.1 The three rituals

| Ritual | Length | Frequency | Purpose |
|---|---|---|---|
| Weekly check-in | 15 to 30 minutes | Weekly | A decision loop. Score confidence, diagnose what is low, close and set commitments |
| Monthly review | 30 to 60 minutes | Monthly | Trend per objective, dependency and risk log, resource shifts, decisions recorded |
| Quarterly review | 60 minutes | At cycle close | Review the results, retro the way you worked, reset the next cycle |

Book all of them for the whole cycle before the cycle starts. Calendars fill fast, and "set and forget" is the main killer of OKR programmes.

Keep check-ins forward-looking. Status lives in the product. The meeting is for decisions.

### 7.2 The weekly check-in, in four steps

**Step 1. Confidence round.** Every key result gets a confidence from 0.0 to 1.0. Where the team votes, each member submits privately and the votes reveal together with a team average, so nobody anchors on the champion. The champion confirms the score and writes one or two lines: what changed this week. Facts, not feelings.

**Step 2. Diagnose what is low.** High and medium confidence moves on with no discussion. Every low score gets three things, without exception:

| Field | Rule |
|---|---|
| Blocker type | One of the five in §7.3 |
| Blocker owner | A named person, not a team |
| Next action | One concrete action within 24 hours, not a discussion |

Confidence at or below 0.3 escalates: the coordinator raises it with management the same day.

**Step 3. Commitments.** Close last week's out loud: delivered or not. No negotiation and no explanation needed. Then set this week's: two or three concrete actions, each with an owner and a linked key result. Not a to-do list. The few moves that shift a key result.

**Step 4. Digest.** The product assembles it: headline average and the change on last week, what is on track, what is at risk with owners, blockers on the 24-hour clock, and the commitment count. The coordinator adds a note for leadership. It posts to the team's channel.

### 7.3 Blocker taxonomy

| Type | Definition |
|---|---|
| Resource | No capacity, budget or tools to progress the key result |
| Dependency | Progress waits on another team's output or decision |
| Clarity | The key result is ambiguous. Nobody agrees what done means |
| Priority conflict | Business as usual keeps displacing OKR work |
| External | Market, regulation or partner factors beyond your control |

Every blocker carries an opened time, an owner, a next action, and a 24-hour clock. The clock is the point. A blocker that ages past it is escalated, not re-discussed.

### 7.4 The rhythm streak

Consecutive weeks in which a space held its check-in. A skipped week breaks it. Shown on the space home. It is a light touch that reliably keeps the heartbeat, and the OKRs stay alive with it.

### 7.5 Monthly review

| Item | Recorded as |
|---|---|
| Trend per objective | Improving, flat, declining |
| Dependency and risk log | Status per dependency |
| Resource or priority shifts | Free text |
| Decisions | A dated decision against the affected key result |

The decision log is the artifact that survives the meeting. Every decision names the key result it affects.

### 7.6 Mid-cycle calibration

Once per cycle, optional. A target may be adjusted only for a verifiable change in external reality, with a written reason. Not for difficulty, not for mood. Anything else is moving the goalposts and it destroys the score's meaning.

---

## 8. The quarterly review

Sixty minutes, three acts, eleven timed stages. Each act asks one question.

| Act | Question |
|---|---|
| Review | Did we achieve the results we set out to? |
| Retro | How did we work together to get there? |
| Reset | What do we decide for the next cycle? |

### 8.1 The stages

| # | Stage | Act | Minutes | Purpose |
|---|---|---|---|---|
| 1 | Open and check-in | Open | 5 | Before the numbers, the people. A pulse and one word for the cycle |
| 2 | Score the key results | Review | 12 | Grade every key result against the key result as written, then reveal the objective score together |
| 3 | Objective narratives | Review | 9 | Owner by owner, the story behind the score, and what the number does not show |
| 4 | Recognition and wins | Review | 3 | Name the effort that deserved to be seen. Specific beats generous |
| 5 | Team retro | Retro | 7 | What worked, what did not. Silent writing, then dot voting |
| 6 | Management retro | Retro | 3 | The four questions leadership owes the team |
| 7 | Root cause and diagnostic | Retro | 5 | Every key result under 0.7 gets one honest cause. Then read the diagnostic |
| 8 | OKR process health | Retro | 3 | Score the practice, not the results. Anonymous |
| 9 | Keep, modify or abandon | Reset | 5 | Close every objective deliberately |
| 10 | Learnings and next drafts | Reset | 4 | Turn what happened into what you now know |
| 11 | Decisions and actions | Reset | 4 | Every action has a name and a date, or it is a wish |

A stage timer runs with pacing cues. Going over is normal and visible. The facilitator lands it and moves.

### 8.2 Room pulse

Each participant gives a 1 to 5 pulse and one word. The average is read back:

| Average | Read |
|---|---|
| 4.0 and above | The room has energy. Use it. Be honest about ambition, not just relieved |
| 3.0 to 3.9 | Steady, not euphoric. Watch for polite scoring later. Steady rooms round their numbers up |
| Below 3.0 | The cycle cost something. Name it early or it leaks into every score in the next ten minutes |

### 8.3 Scoring reveal

Score each key result 0.0 to 1.0 against the key result as written, with baseline, target and actual on screen as evidence, plus a one-line reason. The objective score is hidden until the team reveals it together. Facts, not feelings. A row of 1.0s usually means the ambition was too safe, and that gets said out loud now, not next quarter.

An objective's score is the weighted average of its key results' scores, using the same weights §3.2 uses for progress. A team that said one key result matters three times as much should see that in the score, exactly as it sees it in the progress. An unscored key result is left out rather than counted as zero, so a half-graded objective does not read as a failing one.

The cycle score is a different question about a different set, and stays the plain §3.4 average over every scored key result in the cycle (§8.6). Averaging the objective scores instead would weight an objective with two key results the same as one with eight.

### 8.4 Root causes

Every key result under 0.7 gets exactly one primary cause:

1. Ambition set too high
2. Wrong key result. We measured the wrong thing
3. Blocked by a dependency
4. Capacity or resourcing
5. Priority shifted mid-cycle
6. External or market change
7. Lack of focus. Too many OKRs
8. No clear owner or cadence

Look for the system, not the person. Ask why until it stops being a symptom.

### 8.5 Process health

Five statements, anonymous, 1 (not true for us) to 5 (consistently true):

1. Our OKRs stayed visible and were genuinely used to make decisions this cycle.
2. We held a real check-in cadence, not a status report.
3. Our key results measured outcomes, not activity we were going to do anyway.
4. We had few enough OKRs that focus was possible.
5. When something went off track, we said so early rather than at the end.

The lowest-scoring statement becomes next cycle's process OKR.

### 8.6 The rhythm diagnostic

This is the most valuable output of the review. Combine the cycle score (the §3.4 portfolio average over every scored key result in the cycle) with the rhythm score (the average of process-health statements 2 and 5).

| Condition | Diagnosis | Prescription |
|---|---|---|
| Cycle score 0.7 or above | Results delivered | The question is not effort. It is whether the ambition was set high enough to be worth the quarter |
| Cycle score below 0.7, rhythm 3.5 or above | Strategy or OKR-quality problem | The team ran the rhythm and still missed. The OKRs themselves, or the strategy behind them, were wrong. Fix the key results before you push the team |
| Cycle score below 0.7, rhythm below 3.5 | Rhythm problem | This is a cadence problem, not an ambition problem. Restore the weekly check-in before you rewrite a single objective |

### 8.7 Management retro

The four questions leadership answers out loud, before anyone drafts a next cycle:

1. Were we focused on the right priorities?
2. Did our OKRs bridge strategy and execution?
3. Did we change how we work, or reinforce old habits?
4. Where did alignment break down?

### 8.8 Keep, modify, abandon

Every objective is closed deliberately with one decision and a one-line why:

| Decision | Meaning |
|---|---|
| Keep | Still relevant. Carry forward deliberately |
| Modify | Adjust the target or wording from what we learned |
| Abandon | Priority shifted. End it cleanly |

Nothing carries over by default.

### 8.9 Learnings and feed-forward

Capture learnings as "we learned that…". Promote the top dot-voted retro themes into learnings. Mark the ones to carry forward.

At close, the product feeds the next cycle automatically:

| From this cycle | Into the next cycle |
|---|---|
| Every key result and its score | Phase 2, the prior-cycle scoring list |
| Every carry-forward item | Phase 2, the strategic issue list at impact 4 |
| Learnings and the retrospective | Phase 1, the input pack |
| The lowest process-health statement | Phase 3, a process priority |
| The annual frame and annual OKRs | Phase 0 reference, focus flags cleared |

Carried work re-enters as an issue. It must survive the next prioritisation on its merits. It does not get a free pass.

### 8.10 Minutes

The review produces minutes with an executive summary (cycle score, objectives and key results reviewed, key results below 0.7, team pulse, learnings carried, actions agreed) and every stage's record. Exportable as a document and as a PDF.

Hold the review before drafting the next cycle's OKRs, never in the same session. Drafting pressure distorts honest scoring.

---

## 9. Facilitator guidance

What a good coach says at each phase. The product surfaces these as notes to the facilitator, and the coach agent uses them as its voice.

| Phase | Guidance |
|---|---|
| 0 Annual strategy | Run this once a year with the most senior group in the room, before any quarterly cycle starts. Keep it to five annual objectives at most. If the annual set already contains everything, no quarter can choose |
| 1 Prepare | Refuse to run Phase 4 without a complete input pack. This is the most common failure point. Timebox the gathering. An incomplete pack on time beats a complete pack late |
| 2 Diagnose | Keep scoring factual. Scores are planning data, not appraisal. The moment they feel like appraisal, candour dies. If prior OKRs were never tracked, record that as a process issue to fix in Phase 6 |
| 3 Set direction | Force trade-offs. A priority list that accommodates everything is a to-do list, not a strategy. Push until the not-doing list is written down. Quarterly revalidation takes 30 to 60 minutes, not a full strategy debate |
| 4 Draft OKRs | The most frequent defect is the task-shaped key result. The tell is a leading verb like launch, complete or deliver. Ask "what changes if this succeeds?" and measure that. Missing baselines are second. If a baseline is unknown, establishing it can be the first key result. Run peer review between teams before leadership sees the drafts |
| 5 Align and commit | Run alignment and dependencies as a joint session or a structured asynchronous review. Watch for silent overload. Teams rarely volunteer that the plan does not fit. Ask each team directly what they cut. If the answer is nothing, capacity was not checked |
| 6 Run the cadence | Book every check-in and review for the whole cycle before it starts. Keep check-ins forward-looking. Status lives in the product, the meeting is for decisions |
| 7 Review and learn | Hold the review before drafting the next cycle, never in the same session. Scores near 1.0 across the board indicate sandbagging. Name it and address stretch explicitly in the next Phase 4 |

---

## 10. What the coach watches for

The full trigger catalogue is in AI-NATIVE-PLAN.md §6. This is the practice behind it: the twenty situations a real OKR coach spots, and what they say.

| Situation | What the coach says |
|---|---|
| Objective starts with an output verb | If we launch it and nothing changes, did we succeed? |
| Objective contains numbers | Metrics belong in the key results |
| Key result has no baseline | Where are you today? If you do not know, establishing it can be the first key result |
| Key result measures activity volume | More calls, to what end? Name that impact and make it the key result |
| All key results are lagging | You will only find out at the end. Add a leading indicator you can act on weekly |
| Average confidence above 0.9 at draft | That is sandbagging. If you are near certain, this is business as usual |
| More than five company objectives | If everything is a priority, nothing can be chosen. Which two would you drop? |
| Not-doing list empty at Phase 3 exit | A list that accommodates everything is a to-do list, not a strategy |
| Goal with no parent | This OKR is an island. Name the priority it moves forward |
| Level skipped in the cascade | A team goal aligned straight to a company goal usually hides a missing department goal |
| Department with no horizontal dependencies | No cross-team dependency anywhere in this branch. Possible silo |
| Two goals double-counting a metric | These two claim the same movement. One of them is not real |
| Dependency unconfirmed and unowned | Unconfirmed is a risk. Name a risk owner or get the confirmation |
| Capacity check with nothing cut | If the answer is nothing, capacity was not checked |
| Check-in overdue past grace | This goal is stale. It cannot quietly stay green |
| Blocker past its 24-hour clock | This blocker is aging. Escalating to the coordinator |
| Reported health disagrees with the data | Reported on track, but this key result has not moved in four weeks |
| Trend forecast misses the target | On current trajectory this misses. Better to say it now than at the close |
| KPI drops out of its corridor | This KPI is unhealthy. Here is a recovery OKR drafted from its leading drivers |
| Scores near 1.0 across a closed cycle | Targets were too safe. Address stretch explicitly when drafting the next cycle |

The coach never guesses at the situation. Every one of the twenty maps to a rule in this document, and every message cites the rule so the recipient can argue with it.

---

## 11. The threshold registry

The structure of the practice is canon and cannot be changed: which checks exist and how they judge, the six publish gates and their conditions, the blocker and root-cause taxonomies, the session agendas and their stage order, the process-health statements, the management-retro questions, the health precedence, the diagnostic verdicts and the feed-forward mapping. A workspace that needs a different structure is practising a different method, not configuring this one.

Every numeric value the product enforces, computes with or fires on is a parameter in this registry; the §2.4 planning timelines are guidance for humans, not machine thresholds. Each parameter ships as data in `packages/method` with the canon default shown here, and may be overridden per workspace in the rhythm settings. Nothing numeric is hardcoded anywhere else, and a value not in this registry is not a setting.

**Cadence and escalation**

| Parameter | Canon default |
|---|---|
| Check-in frequency | Weekly |
| Check-in anchor day | Monday |
| Cadence tolerance | 1 day either side of the due date without double-advancing |
| Staleness grace | 3 days past the due date, after which the goal reads outdated |
| Check-in escalation ladder | Champion at due, champion again at 1 day overdue, reviewer when grace is exceeded, coordinator at 7 days, sponsor at 14 days |
| Acknowledgement ladder | Reviewer nudged 1 day after publication, escalated at 3 days |
| Blocker clock | 24 hours to the next action |
| Blocker ladder | Owner warned at 20 hours, coordinator at 24 hours, sponsor at 48 hours |
| Nudge deduplication window | 1 nudge per subject per member per day unless the escalation step increases |
| Nudge volume ceiling | 10 per member per week |
| Due-soon lead | 1 day before the anchor day |
| Planning-open lead | 6 weeks before an annual cycle starts, 3 weeks before a quarterly |
| Publication deadline countdown | 14, 7 and 1 days before the deadline |
| Review preparation lead | 2 weeks before the cycle ends |

**Confidence and scoring**

| Parameter | Canon default |
|---|---|
| Confidence high boundary | 0.7 |
| Confidence low boundary | 0.4 |
| Critical confidence | 0.3 and below escalates the same day |
| Draft sandbagging threshold | Average above 0.90 |
| Draft comfortable boundary | 0.75 |
| Draft ambitious boundary | 0.25 |
| Score band boundaries | 0.9, 0.7, 0.4 |
| Score annotation boundaries | 1.0 too safe, 0.6 and above intended, below 0.3 disconnected |
| Portfolio verdict boundaries | 0.85, 0.60, 0.40 |
| Close sandbagging threshold | Scores clustering above 0.85 |
| Root-cause threshold | Scores below 0.7 require a cause |
| Progress signal pass | 75% |
| Progress signal fail | 50% |

**Quality and planning**

| Parameter | Canon default |
|---|---|
| Coach strictness | Warn. The six publish gates are always hard |
| Strength score boundaries | Red below 45%, green at 75% and above |
| Key results per objective | 2 to 5 |
| Objective length bounds | 4 to 18 words |
| Company objective cap | 5 |
| Objectives per unit cap | 3 |
| Strategic issue bounds | 3 to 10, ranked |
| Priority bounds | 3 to 5, each with a 12-month success statement |
| Annual strategy bounds | 2 to 5 |
| Carry-forward issue impact | 4 |
| Input pack lead time | 3 working days before session one |
| Quality word lists | The §4 lists. A workspace may add terms; the canon terms remain |

**Alignment**

| Parameter | Canon default |
|---|---|
| Alignment healthy threshold | 75 |
| Alignment penalties | 10 no anchor, 12 per orphan, 4 per objective without key results, 3 per level skip, 8 per silo, floor 5 |

**KPIs and recovery**

| Parameter | Canon default |
|---|---|
| KPI healthy threshold | 90% of target |
| KPI watch threshold | 70% of target |
| Recovery key result cap | 4 |
| Recovery proposal delay | 2 consecutive unhealthy periods |

**Sessions**

| Parameter | Canon default |
|---|---|
| Weekly session length | 15 to 30 minutes |
| Monthly review length | 30 to 60 minutes |
| Quarterly review length | 60 minutes |
| Annual revalidation length | 30 to 60 minutes |
| Weekly commitment bounds | 2 to 3 per week |
| Quarterly stage minutes | The §8.1 durations |
| Retro dots per member | 3 |
| Room pulse read boundaries | 4.0 and 3.0 |
| Diagnostic cycle-score threshold | 0.7 |
| Diagnostic rhythm-score threshold | 3.5 |

The registry's keys, types, valid ranges and defaults are data in `packages/method`. The workspace rhythm settings store only deviations, validated against that schema; an unset key reads the canon default. The conformance suite compares the defaults against this document.

Every parameter has a default, so a workspace practises the full method correctly from the moment it is created. Tuning is an option, never a prerequisite.
