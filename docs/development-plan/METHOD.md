# METHOD.md

> **Being revised in Phase 9.** On 1 October 2026 every rule here was reviewed against public OKR practice ([METHOD-REVIEW.md](../METHOD-REVIEW.md)), and Akmal decided that locks become practice settings with best-practice defaults. The revised text is [p9-t00-method-v2.md](../design/p9-t00-method-v2.md). Each Phase 9 task moves its sections into this file together with the code that implements them, so the conformance suite stays green. Until a section has moved, this file still describes what the product does.

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
11. **Anybody can write.** A member who can edit a space can add or change its OKRs at any time. Coaching happens while they type. It never refuses them, unless the workspace has chosen to (§2.9). *Source:* Doerr: "Start: Launch a new OKR mid-cycle, whenever the need arises"; decided by Akmal on 1 October 2026.

---

## 2. The cycle model

### 2.1 Two horizons

| Horizon | Runs | Sets | Revisited |
|---|---|---|---|
| Annual | Once a year, about 6 weeks before the year starts | The annual frame (mission, vision, mid-term strategy), 2 to 5 annual strategies, up to 5 annual OKRs, the year's not-doing list | Never rewritten mid-year. Revalidated each quarter in 30 to 60 minutes |
| Quarterly | Four times a year, about 3 weeks before the quarter starts | Quarterly OKRs inside the annual frame | Scored and closed at the end of the quarter |

The annual frame is read-only reference material during a quarterly cycle. Phase 3 of a quarterly cycle revalidates it. It does not rewrite it.

### 2.2 The eight phases

Every cycle offers the same phases. Phase 0 runs only in an annual cycle, so a quarterly cycle runs seven.

| # | Phase | Output |
|---|---|---|
| 0 | Annual strategy | The annual frame and the annual OKRs |
| 1 | Prepare | Planning brief and a complete input pack |
| 2 | Diagnose | Scored prior OKRs and a ranked issue list |
| 3 | Set direction | A priority list for the horizon |
| 4 | Draft OKRs | A draft OKR set with owners |
| 5 | Align and commit | A published, aligned OKR set |
| 6 | Run the cadence | Check-ins, reviews and a decision log |
| 7 | Review and learn | Scores, learnings and the next cycle's inputs |

The phases are the recommended path. They guide, and by default they never stop anybody writing (§2.9). Company OKRs are best set before the cycle starts. Team and individual OKRs are commonly drafted and shared in its first one to two weeks. Publishing follows the same two steps: the company set publishes before the cycle starts, and the department and team sets publish by the time the team publication window closes, each through the gates (§4.5). Phase 6 runs through the cycle. Phase 7 closes it and feeds the next one. *Source:* whatmatters' typical cycle: "Start of quarter: Communicate Team Q1 OKRs", "1 week after start of quarter: Share Employee Q1 OKRs".

### 2.3 Phase completion rules

A phase is complete when all of its conditions hold. The product computes this. It is not self-reported.

| Phase | Complete when |
|---|---|
| 0 | Mission and mid-term strategy written, 2 to 5 annual strategies set, at least one annual OKR with key results |
| 1 | Sponsor and facilitator named, the input pack gathered and distributed |
| 2 | Prior cycle scored (or this is the first cycle, which is inferred when no earlier cycle exists and may be declared), baseline health recorded, at least 3 strategic issues ranked |
| 3 | Annual: 3 to 5 priorities each with a 12-month success statement, not-doing list written, leadership agreement on the frame recorded. Quarterly: frame revalidated (holds or documented change) and focus areas chosen |
| 4 | No objective or key result fails a check set to block. Warnings do not count |
| 5 | Every publish gate set to block is green and the planned sets are published (§4.5) |
| 6 | Cadence booked for the whole cycle |
| 7 | Every key result scored and the retrospective written |

**Phase enforcement** is a practice setting (§12):

| Setting | Effect |
|---|---|
| **Guided** (default) | Completion is shown as progress, with what is missing and a link to fix it. Nothing is refused |
| **Binding** | Drafting waits for phases 1 to 3 and publishing waits for phase 4. The governed choice for organisations that run a formal planning process |
| **Hidden** | The phase strip and its checklist are not shown. OKRs are written and tracked without the planning workflow |

*Source:* No source found that requires earlier phases before drafting. Perdoo (vendor): "You can draft an unlimited number of OKRs". Doerr: "Start: Launch a new OKR mid-cycle, whenever the need arises."

### 2.4 Timeline

Guidance for people, not machine thresholds (§11).

**Annual cycle**, weeks before the year starts:

| Weeks before | Activity |
|---|---|
| 6 to 5 | Phase 1: scope, roles, input pack |
| 4 | Phase 2: diagnosis session |
| 4 to 3 | Phase 3: direction-setting session with leadership |
| 3 to 2 | Phase 4: annual OKRs drafted, then peer review between teams |
| 2 to 1 | Phase 5: annual OKRs aligned and published |
| 1 to 0 | Company OKRs for the first quarter drafted inside the published frame. Phase 6 calendar booked |

**Quarterly cycle**, weeks before and after the quarter starts:

| When | Activity |
|---|---|
| 4 weeks before | Phase 1: light refresh of the input pack |
| 2 weeks before | The ending quarter is graded and reviewed (§8). Phase 2: diagnosis with those scores |
| 2 to 1 weeks before | Phase 3: revalidation. Phase 4: company OKRs drafted |
| 1 week before | Phase 5: company OKRs aligned and published |
| Weeks 1 to 2 of the quarter | Department and team OKRs drafted and published, the second publish step (§4.5) |

*Source:* Wodtke: "Two weeks before the end of the quarter, it's time to grade your OKRs, and plan for the next cycle"; whatmatters' typical cycle.

### 2.5 Roles

| Role | Owns | Rule |
|---|---|---|
| Sponsor | The cycle. Accountable senior leader | One per cycle. Sees escalations in the weekly digest |
| Facilitator | The sessions and the quality bar | One per cycle. May decline to run a drafting session without its inputs. That is their judgement; the product never refuses on their behalf unless phases are binding |
| Champion | One goal. Posts its check-ins | Exactly one per goal. Never a team, never a committee. Block. *Source:* whatmatters: "only one owner per OKR, even if Key Results are distributed across a team" |
| Key result owner | One key result | Exactly one per key result, defaulting to the champion |
| Reviewer | Acknowledging that goal's check-ins | Practice setting: off, optional (default) or required. Where used, a different person from the champion where possible. *Source:* OpenOKR default; no OKR source defines a per-goal reviewer |
| Contributor | Work that moves a key result | Any number |
| Coordinator | The weekly session for a space | One per space. Runs the check-in, chases blockers. *Source:* OpenOKR default |

### 2.6 The input pack

A checklist for Phase 1, shown in Phase 1 and beside the drafting form. It never blocks unless phases are binding.

1. Mission, vision and current strategy documents
2. Prior cycle OKRs with scores and retrospective notes
3. KPI dashboard or baseline health metrics
4. Customer feedback and market or competitor signals
5. Financial constraints: budget, headcount, committed spend
6. Committed projects and obligations that consume capacity
7. Open risks and dependencies carried over from the last cycle

Distribute it a few working days before the first session (3 by default, §11). An incomplete pack delivered on time beats a complete pack delivered late. *Source:* Atlassian (vendor) lists the same kind of pre-reads, previous OKRs "If available".

### 2.7 Levels and quantities

A workspace chooses the levels it uses (§12). A change applies to cycles that start after it: a running or closed cycle keeps the levels it began with, so no objective is ever left at a level that no longer exists. Many organisations use only two, company and team. *Source:* Castro: "Use as few OKR levels as possible"; Cagan: focus on team objectives.

| Level | Objectives | Rule |
|---|---|---|
| Company | 1 to 5 | Warn above 5. If the annual set already contains everything, no quarter can choose |
| Department | 1 to 3 per department | Warn above 3. Optional level |
| Team | 1 to 3 per team | Warn above 3 |
| Individual | 0 to 3 | Optional, and off by default. Never required. *Source:* Castro: "Individual OKRs are not for everyone and should never be required" |

Every objective carries 2 to 5 key results: block at none, warn at one or above five. A unit may contribute to another unit's OKRs instead of setting its own. Record which units do this. *Source:* Doerr: "A limit of three to five OKRs per cycle" and "five or fewer" key results; re:Work: "around three key results per objective"; Castro: "2 to 5 Key Results".

### 2.9 Writing and changing OKRs at any time

**Who may write, and when.** By default, any member who can edit a space may create, change, start or stop its objectives and key results at any time in the cycle. *Source:* Doerr; decided by Akmal on 1 October 2026. A workspace may restrict this in its practice settings (§12):

| Setting | Effect |
|---|---|
| **Any time** (default) | Writing is never refused for planning reasons |
| **Planning window** | New objectives may be created from planning-open (§11) until the team publication window closes. Changes to existing ones stay open |
| **After the phases** | Drafting waits for phases 1 to 3, as under binding phase enforcement (§2.3) |

Access still applies everywhere: a member writes only where they may edit. Quality checks run as they type.

---

## 3. Scoring, confidence and health

Three different numbers. They are never mixed. Every numeric boundary in this section is a parameter in the §11 registry; the values shown are the defaults.

| Number | Range | Direction | Answers |
|---|---|---|---|
| Progress | 0 to the progress ceiling, 100% by default | Backward | How far has the value moved from baseline to target? |
| Confidence | 0.0 to 1.0 | Forward | Do we believe this will land? |
| Score | 0.0 to 1.0 | Backward, final | What did we actually achieve, judged at the close? |

### 3.1 Progress

Direction-aware linear interpolation, clamped to 0 and to the progress ceiling.

The ceiling is 100% by default, so a key result that reached its target reads as done and no further. A workspace may raise it as far as 200%, which is the ceiling §6.4 already applies to KPI achievement. Raising it makes over-achievement visible where it was earned: a key result that reached 150 of a 100 target reads 150%.

Two consequences of raising it, and both are the workspace's to accept. A goal's progress is the weighted average of its key results, so a goal holding one key result at 150% and one at 50% reads 100% and looks complete while half the work was missed. And a *maintain* key result is never above 100%, because its value is either inside the stated band or on its way back and there is no notion of exceeding a band.

The ceiling does not touch scoring. A score is judged at the close by a person against the key result as written, on the 0.0 to 1.0 scale in §3.3, and a key result that overshot is still a key result whose target was set too low.

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

Statuses: **pass**, **warn** (worth another look), **fail** (a structural defect), **todo** (waiting on input).

**Enforcement.** Each check has a default level, below, and a workspace may change it (§12):
- A check at **block** refuses publishing while it reports fail. A workspace that raises a check from warn to block turns that check's warns into fails.
- A check at **warn** shows and coaches.
- A check at **off** is not evaluated.
- **Strict mode** raises every check to block at once. It is off by default.

| Check | Default level |
|---|---|
| OBJ-1 Outcome, OBJ-2 Qualitative, OBJ-5 Counted | Warn |
| OBJ-3 Timebound, OBJ-4 Owned (champion) | Block |
| KR-1 Count | Block at none; warn at one or above five |
| KR-2 Verifiable | Warn |
| KR-3 Complete | Block on a missing target (metric and maintain), due date or owner. Warn on a missing baseline |
| KR-4 Leading and lagging, KR-6 Ambitious but honest | Info |
| KR-5 Impact, not effort | Warn |
| KR-7 Direction set | Block only where a metric key result has none and none can be derived |
| AL-1, AL-4, AL-5 | Warn |
| AL-2 | Block (a data rule) |
| AL-3, AL-6 | Off |
| CY-1 to CY-8 | Info. Block only under binding phase enforcement |

*Source:* No OKR tool found that blocks publishing on automated quality checks. Perdoo (vendor): "To activate a Draft OKR, you must manually activate it." Microsoft Viva Goals' approval is optional and done by a person.

**Strength score** = (passes + 0.5 × warns) / evaluated checks, as a percentage, computed over the objective, key result and alignment checks of the set being drafted. A todo check counts in the denominator and adds nothing. Checks that are off are not evaluated. The cycle checks feed phase completion and the publish gates, not the strength score. Below 45% is red, 45% to below 75% is amber, 75% and above is green. *Source:* OpenOKR default. A product heuristic, not a published measure.

**What word lists can and cannot do.** OBJ-1, KR-5 and parts of KR-2 match words. A word list will always be behind English, and the checks are measured against published OKRs (METHOD-REVIEW.md §3.4). So no word-list check blocks by default. A person decides what blocks, not a word.

### 4.1 Objective checks

**OBJ-1 Outcome, not output.** Warn.

| Condition | Status | Coaching prompt |
|---|---|---|
| Starts with an output verb | warn | "Your objective starts with a deliverable. If we do it and nothing changes, did we succeed? Consider naming the change you want, and keep the deliverable in a key result or an initiative." |
| Matches an end-state shape | pass | "This names the state you want to be in. Keep the deliverables in your key results." |
| Contains an output verb anywhere | warn | "There is output language here. What would be true after this is done? Lead with that." |
| Bare metric movement, no why | warn | "Naming a metric to move is usually a key result in disguise. The outcome is the why behind the movement. Add the why, or lead with the end state." |
| Metric movement with a why | pass | "You have paired movement with a why. Stronger still: lead with the end state and let the key results carry the movement." |
| Names a change in state | pass | "This reads as a change in state, not a to-do. Keep the deliverables in your key results." |
| Cannot tell | pass | "Tip: could you complete this without anything actually improving? If yes, rewrite around the improvement." |

The shape row sits second, above the output-verb sweep, since 28 September 2026 (completeness review M-27). "Cannot tell" passes with a tip since 1 October 2026: as a warning it fired on most well-formed objectives, which made it a banner rather than coaching.

Every row that used to fail now warns. Doerr's own example objective is "Build a planning model for their company", and Wodtke's good example is "Launch an Awesome MVP", so an objective that opens with an action is a style question, not a defect. *Source:* Doerr: objectives are "significant, concrete, action oriented, and (ideally) inspirational".

Word lists:

| List | Words |
|---|---|
| Output verbs | launch, build, ship, implement, create, deliver, release, complete, develop, deploy, write, publish, migrate, install, conduct, hold, organise, organize, set up, roll out, rollout, hire, redesign, finish, produce, run |
| Movement verbs | increase, grow, improve, reduce, boost, raise, cut, double, triple, maximise, maximize, minimise, minimize, decrease, accelerate, expand, drive, bring |
| State words | become, be the, delight, delighted, loved, trusted, leading, best, strongest, profitable, sustainable, engaged, thriving, world-class, prefer, preferred, go-to, healthiest, excellence, dominant, known for, famous for, proud |
| Why markers | so that, in order to, because |

"To" left the why markers on 1 October 2026. Every "from X to Y" contains it, so "Increase revenue from $2M to $3M" passed as movement with a why. "Bring" joined the movement verbs at the same time, so a recovery objective is judged as movement.

**End-state shapes.** A word list can only recognise an end state that happens to use one of its words. These are sentence shapes that name an end state without needing any of them, and an objective matching one passes OBJ-1. `…` stands for any words.

| Shape | Example |
|---|---|
| make … something … | Make onboarding something new customers finish by themselves |
| reach the point where … | Reach the point where the product sells itself |
| get to where … | Get to where a failed payment never reaches a person |

Added 11 September 2026 after the P7-T07 audit measured OBJ-1 against twenty real drafts.

**OBJ-2 Qualitative and memorable.** Warn.

| Condition | Status | Prompt |
|---|---|---|
| Contains digits other than a four-digit year | warn | "Metrics usually belong in the key results. Keep the objective qualitative and memorable." |
| More than 18 words | warn | "Trim it. If your team cannot recite it from memory, it will not steer their daily decisions." |
| Otherwise | pass | "Good length and qualitative. Read it aloud. Would it make your team lean in?" |

The lower bound of four words was removed on 1 October 2026: whatmatters' own "Achieve fiscal sustainability" is three. The 18-word limit is an OpenOKR default.

**OBJ-3 Timebound.** Block. Fail without a cycle or an explicit timeframe. An OKR without a deadline is a wish. *Source:* Wodtke: "Time Bound"; Doerr: key results are "time-bound".

**OBJ-4 Owned.** Block. Fail without a named champion. A named reviewer is required only where the workspace requires reviewers (§2.5).

**OBJ-5 Counted.** Warn when a unit exceeds 3 objectives, or the company level exceeds 5.

### 4.2 Key result checks

**KR-1 Count.** Pass at 2 to 5. Fail at none, which blocks. Warn at 1 ("can a single measure prove this from every angle?"). Warn above 5 ("which would you drop if you had to?").

**KR-2 Measurable.** Warn. Pass when the text reads "from X to Y" or carries two numbers. Warn on a single number ("a target but no baseline. Without the from, you cannot prove movement"). Warn with no numbers ("what is the baseline today, and where must it land?").

**KR-3 Complete.** Block when the target, the due date or the owner is missing. Warn when the baseline is missing. If a baseline is unknown, establishing it can be its own key result. *Source:* Doerr's own key results ("99% uptime") often carry no baseline.

**KR-4 Leading and lagging.** Info. Tagging is optional. Where the set's key results are tagged: pass when the set holds at least one of each. Note when all are lagging ("you will only find out at the end whether it worked"). Note when all are leading ("which key result proves the outcome landed?"). *Source:* whatmatters: "The most effective way to go is often a mix."

**KR-5 Impact, not effort.** Warn. A key result tagged leading is exempt: an activity can be a fair leading signal.

| Condition | Status | Prompt |
|---|---|---|
| Activity noun, no impact word, no purpose | warn | "This measures activity volume. Ask why: more calls, to what end? If you can measure that impact, make it the key result and keep the activity as a leading indicator." |
| Output verb with fewer than two numbers | warn | "Reads like a milestone. If it is one, mark it a milestone key result. Otherwise measure what changes because of it." |
| Activity plus a why, but the target sits on the activity | warn | "Good instinct, but consider flipping it. Measure the impact itself and keep the activity as a tagged leading indicator." |
| Otherwise | pass | "These measure impact, not activity." |

| List | Words |
|---|---|
| Activity nouns | call, meeting, interview, demo, email, workshop, session, training, webinar, post, visit, proposal, campaign, feature, report, presentation, event, ticket, article, sprint, task, activity, outreach, touchpoint (and plurals) |
| Impact words | revenue, pipeline, conversion, retention, churn, nps, csat, satisfaction, margin, profit, growth, adoption, activation, engagement, win rate, quality, insight, market share, loyalty, renewal, upsell, arr, mrr, ltv, cac, accuracy, uptime, productivity, time-to-value, referrals, deal size |

*Source:* Google's OKR playbook: key results "must describe outcomes, not activities"; Cagan on outcomes over output. Google's own sample "Launch xx feature to all users" and Intel's Operation Crush key results show outputs are sometimes the honest measure, which is why this warns.

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

Info by default, shown as the phase checklist. Under binding phase enforcement they decide phase completion.

| ID | Check |
|---|---|
| CY-1 | Input pack gathered and distributed before session one |
| CY-2 | Prior cycle scored, or this is the first cycle |
| CY-3 | At least 3 strategic issues listed and ranked by impact |
| CY-4 | Annual cycles: 3 to 5 priorities, each with a stated 12-month success |
| CY-5 | Annual cycles: the not-doing list is written |
| CY-6 | Capacity checked, no committed OKR left at "exceeds" |
| CY-7 | Every dependency confirmed, escalated or risk-owned |
| CY-8 | Every check-in and review booked for the whole cycle |

### 4.5 Publish gates

Publishing makes a cycle's planned OKRs live, in up to two steps: the company set before the cycle starts, then the department and team sets by the time the team publication window closes (§11). Each publish runs the gates over what it publishes. Each gate has an enforcement level (§12). A gate at block refuses publishing until it is green, and an admin may override it with a recorded reason. OKRs added after the team publication window go live as §2.9 says: they must pass the checks set to block, not the set-level gates.

1. Every objective has a title and a named champion, and a reviewer where reviewers are required. Block.
2. Every objective has at least one key result, and every key result passes the checks set to block (by default a target where it needs one, a due date and an owner). Block.
3. Alignment is mapped. Each objective states what it contributes to, or why it stands alone. Warn.
4. Every dependency is confirmed, escalated or logged with a named risk owner. Warn.
5. Capacity is checked. No committed OKR is left marked as exceeding capacity. Warn.
6. A publication date is set. Off by default; the countdown reminders run either way.

OBJ-1 joined gate 2 on 28 September 2026, under REQUIREMENTS §3.2 as it then read. Since 1 October 2026 OBJ-1 warns by default, so it reaches gate 2 only where a workspace raises it to block.

### 4.6 Weak and strong examples

The coach shows these beside the check that fired.

| Weak | Strong | Why |
|---|---|---|
| Objective: Launch the new mobile app by end of Q3 | Objective: Make mobile the way our customers prefer to reach us | You can launch and still fail. The strong version names the change in customer behaviour. For a committed delivery, "Launch the app" can be an honest milestone key result under it |
| KR: Improve customer satisfaction | KR: Increase NPS from 32 to 50 (lagging). KR: Cut first-response time from 9h to 2h (leading) | No baseline, no target, no way to score it. The strong pair sets from and to, and combines lagging proof with a leading signal you can steer weekly |
| KR: Hold 12 customer interviews | KR: Raise activation rate of new sign-ups from 41% to 60% (lagging). KR: Interview 12 churned customers by week 6 (leading) | Interviews alone are activity. Ask what they are for and measure that outcome; the interviews can stay as a tagged leading signal |
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

Every numeric value the product enforces, computes with or fires on is a parameter in this registry; the §2.4 planning timelines are guidance for humans, not machine thresholds. Each parameter ships as data in `packages/method` with the default shown here, and may be overridden per workspace in the rhythm settings. Nothing numeric is hardcoded anywhere else, and a value not in this registry is not a setting.

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
| Team publication window | 2 weeks after the cycle starts |
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
| Progress ceiling | 100%, raisable to 200% |
| Progress signal pass | 75% |
| Progress signal fail | 50% |

**Quality and planning**

| Parameter | Canon default |
|---|---|
| Coach strictness | Per check, as §4 sets out. Strict mode raises every check to block |
| Strength score boundaries | Red below 45%, green at 75% and above |
| Strength score warn weight | 0.5 |
| Key results per objective | 2 to 5 |
| Objective length limit | 18 words, warn above |
| Company objective cap | 5 |
| Objectives per unit cap | 3 |
| Strategic issue minimum | 3, ranked |
| Priority bounds | 3 to 5, each with a 12-month success statement |
| Annual strategy bounds | 2 to 5 |
| Carry-forward issue impact | 4 |
| Input pack lead time | 3 working days before session one |
| Quality word lists | The §4 lists. A workspace may add terms; the built-in terms remain |

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

The registry's keys, types, valid ranges and defaults are data in `packages/method`. The workspace rhythm settings store only deviations, validated against that schema; an unset key reads the default. The conformance suite compares the defaults against this document.

Every parameter has a default, so a workspace practises the full method correctly from the moment it is created. Tuning is an option, never a prerequisite.

---

## 12. Practice settings and profiles

The non-numeric choices a workspace makes about its practice. Each has the recommended default first. Changing one is an audited admin action, and no setting can make the product refuse a read or lose data.

### 12.1 The settings

| Setting | Options | Default | Source |
|---|---|---|---|
| Who may write OKRs, and when | Any time · Planning window · After the phases | Any time | Doerr; Akmal, 1 October 2026 |
| Phase enforcement | Guided · Binding · Hidden | Guided | No source requires phases before drafting |
| New objectives mid-cycle start as | Live · Draft published by its owner · Draft approved by the reviewer | Live, marked added mid-cycle | whatmatters |
| Reason when adding mid-cycle | Off · Optional · Required | Optional | OpenOKR default |
| Reason when easing a target | Required · Optional | Required | whatmatters |
| OKR kinds | Committed and aspirational · Aspirational only · Committed only | Both, new objectives aspirational | Google's OKR playbook |
| Key result kinds | Metric, maintain, milestone, baseline: each on or off | All on | Lamorte; re:Work |
| Reviewer per goal | Off · Optional · Required | Optional | OpenOKR default |
| Check enforcement | Each check: Block · Warn · Off | As §4 | §4 |
| Strict mode | Off · On | Off | OpenOKR default |
| Publish gate enforcement | Each gate: Block · Warn · Off | Gates 1 and 2 block, 3 to 5 warn, 6 off | §4.5 |
| Gate override | An admin with a recorded reason | On | REQUIREMENTS §3.2 |
| Levels in use | Company, department, team, individual: each on or off | Company, department and team on, individual off | Castro; Cagan |
| Progress roll-up from aligned goals | On · Off | Off | Perdoo (vendor) |
| Confidence shown as | x in 10 · 0.0 to 1.0 · Percent | x in 10 | Wodtke |
| Scoring | On · Off | On | Lamorte; Castro |
| Score adjustment at close | Allowed with a reason · Not allowed | Allowed with a reason | Doerr |
| Score colours | Google (0.6, 0.3) · Doerr (0.7, 0.4) | Google | re:Work; whatmatters |
| Progress signal | Pace-aware · Absolute | Pace-aware | Microsoft Viva Goals (vendor) |
| Critical confidence escalation | Off · On | Off | OpenOKR default |
| Sponsor in escalation ladders | Off · On | Off | OpenOKR default |
| Quarterly review format | One session · Review and retrospective separately | One session | Workpath (vendor) |
| Root causes at the review | As §8.4 · Optional | As §8.4 | OpenOKR default |
| Carry forward unfinished aspirational objectives | Proposed as Keep · Not proposed | Proposed | Google's OKR playbook |
| Unhealthy KPI response | Offer the three responses · Draft a recovery OKR at once | Offer the three responses | Wodtke |

### 12.2 Profiles

A profile is a named starting point: choosing one sets the settings above, and every setting can still be changed afterwards. A workspace starts on **Recommended**.

| Profile | For | What it sets differently from Recommended |
|---|---|---|
| **Recommended** | Most organisations | The defaults in this document |
| **Google-style** | Organisations following Google's playbook closely | Individual level on. Department level off. Reviewer off. Google's score colours |
| **Radical Focus** | Small companies and teams starting out, following Wodtke | One objective per team, three key results, warn above. Confidence as x in 10. Phases hidden. Weekly commitments and wins |
| **Lightweight** | Teams that want to track OKRs without the planning workflow | Phases hidden. Reviewer off. Only gates 1 and 2. Check-ins every two weeks. Scoring on, root causes optional |
| **Governed** | Organisations that run a formal planning process | Phases binding. Writing in the planning window. New objectives mid-cycle as drafts approved by the reviewer. Reviewer required. Gates 1 to 5 block. AL-3 on. Sponsor in the escalation ladders |

*Source:* Google's OKR playbook, Wodtke's Radical Focus, Castro's two levels, and the configuration Perdoo and Microsoft Viva Goals offer (vendor).
