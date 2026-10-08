# METHOD.md

The OKR practice canon. Every rule, threshold, band, ritual and diagnostic that OpenOKR encodes lives here.

This document answers two questions: **what does good OKR practice look like, precisely enough to build, and what may an organisation change about it?** It is the authority for the Draft Coach rule engine, the OKR Coach and OKR Champion agents, the scoring and health engines, the session flows, the practice settings, and every nudge the product sends. Product scope lives in REQUIREMENTS.md. Schema and engines live in TECHNICAL-PLAN.md. When one of those needs to know *what the right practice is*, it cites this file.

**Defaults, not dogma.** Every rule was reviewed against public OKR practice (§13), and four principles follow from that review:

1. Anybody can create an objective or key result at any time, by default. An admin can restrict it.
2. Only structural defects block publishing, by default.
3. Committed and aspirational OKRs are adopted, by default.
4. Locks become practice settings, each with the best-practice default.

Every rule below is the recommended default. Each says how strongly the product applies it, whether a workspace may change it (§12), and the published practice it rests on (§13). Where no source was found, it says "OpenOKR default".

**How strongly a rule applies:**

| Level | Meaning |
|---|---|
| **Block** | The product refuses the action until the rule holds. The default only for structural defects |
| **Warn** | The product shows the problem beside the work and coaches. Nothing is refused |
| **Info** | A tip or a note, shown where it helps |
| **Off** | Not evaluated |

Unless a rule says otherwise, a workspace may move it between these levels in its practice settings (§12).

Terms used throughout:

| Term | Meaning |
|---|---|
| Objective | A statement of a desired future state. Usually qualitative and memorable. Also called a goal in the product, and the two words mean the same thing here |
| Key result (KR) | A verifiable result that proves the objective is being achieved. Usually a measured change from a baseline to a target by a date. It can also be a value held inside a band, a milestone that is done or not done, or a baseline still to be established (§2.10) |
| Committed OKR | An OKR the team agrees will be achieved, adjusting schedules and resources to deliver it. Expected to score 1.0 (§2.8) |
| Aspirational OKR | An OKR that describes how the team would like the world to look, without a clear path or all the resources. Expected to average around 0.7 (§2.8) |
| Cycle | The time box the OKRs are set and scored against. Usually a quarter, sometimes a year |
| Champion | The one person accountable for a goal. They post the check-in. The label is a terminology setting; "Owner" is a common alternative |
| Key result owner | The one person who moves and reports a key result. Defaults to the goal's champion |
| Reviewer | The person who acknowledges a goal's check-ins, where the workspace uses reviewers (§2.5) |
| Sponsor | The senior leader accountable for the whole cycle |
| Facilitator | The person who runs the sessions and guards quality |
| Check-in | A short written update on a goal, with a snapshot of every KR value at that moment |
| Confidence | A belief that a KR will land, forward-looking. Stored 0.0 to 1.0 and shown as "x in 10" by default |
| Score | A 0.0 to 1.0 measure of what actually happened. Backward-looking |
| Leading indicator | An early signal you can act on this week |
| Lagging indicator | The result you ultimately want, visible late |
| Practice setting | A workspace's choice about how strongly a rule applies, or which variant it uses (§12) |
| Profile | A named bundle of practice settings a workspace starts from (§12) |

---

## 1. The operating principles

Every rule below serves one of these. They are the practice's centre, and the part a workspace cannot switch off (§11).

1. **Objectives are destinations, key results are the proof.** An objective is usually qualitative; a number in it is usually a key result in disguise. A key result must be verifiable: if nobody can tell whether it happened, it is an opinion. *Source:* Wodtke; Doerr.
2. **Prefer impact to effort.** "Hold 12 interviews" is an output. "Raise activation from 41% to 60%" is an outcome. Outputs are how you get there. Measure the change they are for wherever you can, and keep deliverables in initiatives or, for committed work, in milestone key results. *Source:* Google's OKR playbook: key results "must describe outcomes, not activities"; Cagan; Doerr's own milestone key results.
3. **Focus is a decision.** Few objectives, few key results. Writing down what you will not do is strongly recommended. *Source:* Grove: "if we try to focus on everything, we focus on nothing"; Doerr.
4. **Know what kind of promise you are making.** A committed OKR is expected to be delivered in full. An aspirational OKR is a stretch: about 5 in 10 confidence when drafted, and around 0.7 at the close, is healthy. *Source:* Google's OKR playbook; Wodtke.
5. **The rhythm is the product.** "Without frequent status updates, goals slide into irrelevance." Weekly check-ins are the default; the monthly review and the close are booked before the cycle starts. *Source:* Doerr; Wodtke.
6. **Scores are planning data, not pay.** A score is never an input to compensation or a rating. It may inform a conversation about how the work went. *Source:* Doerr: "Divorce compensation (both raises and bonuses) from OKRs"; re:Work.
7. **Nothing carries over silently.** Every objective gets a deliberate decision at the close. An unfinished aspirational OKR may carry forward on purpose. *Source:* Doerr; Google's OKR playbook.
8. **Neglect must be visible.** A goal nobody has updated cannot quietly stay green.
9. **Alignment is contribution, not copying.** A team's OKR states its own contribution to a goal above or beside it. It may turn a parent's key result into its own objective; it does not restate the parent's objective word for word. *Source:* whatmatters; Castro.
10. **Diagnose before you prescribe.** A missed cycle with a strong rhythm points at strategy. A missed cycle with a weak rhythm points at cadence. Treat the diagnosis as a hypothesis to test, not a verdict. *Source:* OpenOKR default.
11. **Anybody can write.** A member who can edit a space can add or change its OKRs at any time. Coaching happens while they type. It never refuses them, unless the workspace has chosen to (§2.9). *Source:* Doerr: "Start: Launch a new OKR mid-cycle, whenever the need arises".
12. **Defaults, not dogma.** This is the recommended method. Organisations adapt OKRs to their own context, and the product lets them from settings, starting from a working default rather than from blank. *Source:* Google's OKR playbook, which says other organisations' approach may and should differ from Google's; Castro: "There is not a single way to adopt OKR"; Lamorte's deployment parameters.

---

## 2. The cycle model

### 2.1 Two horizons

| Horizon | Runs | Sets | Revisited |
|---|---|---|---|
| Annual | Once a year, about 6 weeks before the year starts | The annual frame (mission, vision, mid-term strategy), 2 to 5 annual strategies, up to 5 annual OKRs, the year's not-doing list | Mission and vision stay stable. Annual OKRs and the not-doing list may be revised at a quarterly revalidation, with a written reason. An annual target changes under the same rules as any target (§2.9): easing it needs a reason, and the original stays on record |
| Quarterly | Four times a year, planning opens about 4 weeks before the quarter | Quarterly OKRs inside the annual frame | Scored and closed at the end of the quarter |

The annual frame is reference material during a quarterly cycle. Phase 3 of a quarterly cycle revalidates it: it holds, or it changes with a documented reason. *Source:* Castro: company OKRs "are not set in stone"; whatmatters: "it's rare to adjust company-level OKRs … it may be necessary".

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

### 2.8 Committed and aspirational OKRs

Every objective is one of two kinds. The kind is chosen when it is written and can be changed, visibly, until the close.

| Kind | Meaning | Expected score | When it misses |
|---|---|---|---|
| **Committed** | "OKRs that we agree will be achieved, and we will be willing to adjust schedules and resources to ensure that they are delivered" | 1.0 | "A score of less than 1.0 requires explanation for the miss." A short postmortem, not a punishment. Escalate early when it is at risk |
| **Aspirational** | "OKRs express how we'd like the world to look, even though we have no clear idea how to get there and/or the resources necessary" | An average around 0.7, "with high variance" | Normal. It may carry forward until it is achieved |

Rules that depend on the kind:

- Stretch coaching (§3.2, KR-6), "too safe" notes (§3.3, §3.4), and capacity allowed to exceed (§5.5) apply to aspirational OKRs only.
- A committed OKR should credibly consume most, but not all, of the team's resources. Committed and aspirational together may consume somewhat more.
- New objectives are aspirational by default (§12). A workspace may use one kind only.

*Source:* Google's OKR playbook, all quotations above. It names "Failing to differentiate between committed and aspirational OKRs" as its first trap.

### 2.9 Writing and changing OKRs at any time

**Who may write, and when.** By default, any member who can edit a space may create, change, start or stop its objectives and key results at any time in the cycle. *Source:* Doerr. A workspace may restrict this in its practice settings (§12):

| Setting | Effect |
|---|---|
| **Any time** (default) | Writing is never refused for planning reasons |
| **Planning window** | New objectives may be created from planning-open (§11) until the team publication window closes. Changes to existing ones stay open |
| **After the phases** | Drafting waits for phases 1 to 3, as under binding phase enforcement (§2.3) |

Access still applies everywhere: a member writes only where they may edit. Quality checks run as they type.

**Through the cycle**, every OKR can make one of four moves. *Source:* Doerr, *Measure What Matters*: continue, update, start, stop.

| Move | Meaning | Recorded as |
|---|---|---|
| Continue | Still right as written | Nothing new |
| Update | Change the wording, a key result, or a target | A dated change in the activity, with the previous value kept |
| Start | Add a new objective or key result mid-cycle | Created and marked **added mid-cycle**, visible in lists and at the close. OKRs created before the team publication window closes (§11) are the cycle's plan, not additions, and carry no mark |
| Stop | It no longer matters | Closed as abandoned with a one-line reason |

**Live or draft.** An objective or key result added mid-cycle is live at once by default, as soon as it passes the checks set to block (§4): a key result needs its target where its kind has one, its due date and its owner. Until it does, it is a draft its space can see, and the list shows what is missing. A workspace may instead make new objectives start as drafts that their owner publishes, or that their reviewer approves (§12).

**Changing a target.**
- Making a target harder needs no reason: raising it on an increase, lowering it on a reduce. Neither does setting a first target where there was none.
- Easing a target, moving it toward its baseline, needs a written reason, and the original target stays on record so the close can see both.
- "It got hard" is not a reason. *Source:* whatmatters: "Never change your OKRs because you're afraid you'll fall short."
- There is no limit on how many times by default.

**When the organisation changes.** A team that merges, splits or is renamed takes its OKRs with it. An objective can move to another space at any time: its key results, check-ins, dependencies and alignment move with it, and the move is recorded as a dated change. A merged team writes its own objectives at the next cycle rather than carrying both teams' sets; until then, both sets run in the merged space. *Source:* whatmatters: "A new team doesn't automatically inherit old OKRs"; resetting after a reorganisation is "very similar to the end of a cycle".

**Mid-cycle changes are evidence, not failure.** The close reads them. A cycle full of starts and stops says the planning inputs were weak, which Phase 2 of the next cycle should hear.

*Source:* whatmatters: "OKRs are amendable and revisable", consider "adding an additional OKR or simply taking away one or two KRs" when "something out of your control changes or you become more aware of what the aggressively realistic goal should be"; re:Work: OKRs are "revisited a few times a quarter" to "adjust to new information, abandon objectives".

### 2.10 Kinds of key result

| Kind | Written as | Progress | Scored |
|---|---|---|---|
| **Metric** | Move a number from a baseline to a target by a date (increase, reduce or move) | Linear from baseline to target (§3.1) | From progress at the close |
| **Maintain** | Hold a number inside a band through the cycle | 100% while inside the band, otherwise the distance back | From the share of the cycle spent inside the band, by default |
| **Milestone** | A verifiable thing done by a date | 0% until done, then 100% | 1.0 if done, 0 if not, unless a person adjusts it with a reason |
| **Baseline** | Establish the number nobody measures yet | 0% until the baseline is recorded, then 100% | 1.0 once recorded |

All four kinds are on by default, and a workspace may turn any off (§12). Prefer metric key results where an outcome can be measured. A set made only of milestones is usually a plan, not proof. *Source:* Lamorte names "metric, baseline, and milestone" key results; re:Work: "Sometimes key results are either 0 or 1"; Grove: "Did I do that or did I not do it? Yes/no."

---

## 3. Scoring, confidence and health

Three different numbers. They are never mixed. Every numeric boundary in this section is a parameter in the §11 registry; the values shown are the defaults.

| Number | Range | Direction | Answers |
|---|---|---|---|
| Progress | 0 to the progress ceiling, 100% by default | Backward | How far has the value moved from baseline to target? |
| Confidence | 0.0 to 1.0, shown as "x in 10" | Forward | Do we believe this will land? |
| Score | 0.0 to 1.0 | Backward, final | What did we actually achieve, judged at the close? |

### 3.1 Progress

Direction-aware linear interpolation, clamped to 0 and to the progress ceiling. Milestone, baseline and maintain key results follow §2.10.

The ceiling is 100% by default, so a key result that reached its target reads as done and no further. A workspace may raise it as far as 200%. Raising it makes over-achievement visible where it was earned: a key result that reached 150 of a 100 target reads 150%.

Raising it has two consequences, and both are the workspace's to accept:
- A goal's progress is the weighted average of its key results, so a goal holding one key result at 150% and one at 50% reads 100% and looks complete while half the work was missed.
- A *maintain* key result is never above 100%, because its value is either inside the stated band or on its way back.

The ceiling does not touch scoring. A score is judged at the close against the key result as written, on the 0.0 to 1.0 scale in §3.3.

| Direction | Formula |
|---|---|
| Increase | (current − baseline) / (target − baseline) |
| Reduce | (baseline − current) / (baseline − target) |
| Maintain | 100% while the value stays inside the stated band, otherwise the distance back to the band |
| Move | Treated as increase toward the target value |

A metric key result whose baseline equals its target is not a metric. The coach asks whether it is a maintain or a milestone key result.

A goal's progress is the weighted average of its key results' progress. Including the progress of goals aligned beneath it is a practice setting, off by default, because a child's work usually also moves the parent's own key results and would be counted twice. *Source:* Perdoo (vendor): "By default, an Objective's progress is based on its Key Results only".

### 3.2 Confidence bands

Confidence is asked every check-in, on every key result. It is shown as "x in 10" by default (§12). *Source:* Wodtke: "Adjust your confidence levels every single week."

| Confidence | Band | What happens |
|---|---|---|
| 0.7 and above | High | Nothing to do |
| 0.4 to below 0.7 | Medium | When it has dropped since last week, name what changes this week |
| Below 0.4 | Low | A next action due by the next check-in, with an owner. Capture a blocker where something is actually blocked |

**A drop matters more than a level.** When a key result's confidence falls into the low band, the coordinator is told. A key result drafted low on purpose, such as an aspirational moonshot, does not escalate for staying where it started. *Source:* Wodtke: "has that moved up or down? Have a discussion about why."

**Critical confidence** (0.3 and below) escalates to the sponsor the same day only where the workspace turns that on (§12). Off by default.

**At drafting time, judge the set.** For aspirational key results, judge the average:

| Average confidence at draft | Verdict |
|---|---|
| Above 0.90 | Near certain. If this must be delivered, mark it committed. If it is a stretch, raise the targets |
| Above 0.70, up to 0.90 | Comfortable. A stretch usually feels like 5 in 10 |
| 0.30 to 0.70 | The sweet spot. A real stretch you still believe in |
| Below 0.30 | A moonshot. Make sure there is a credible path, and expect a low score |

*Source:* Wodtke: "you set a difficult number you have a 50% confidence in achieving"; "A confidence level of ten is also known as sandbagging."

For committed key results, high confidence is right. A committed key result below 0.7, whether drafted there or falling there at any check-in, is a risk: escalate now to find the resources, or make it aspirational. *Source:* Google's OKR playbook: "Teams who cannot credibly promise to deliver a 1.0 on a committed OKR must escalate promptly."

### 3.3 Score bands

Scored at the close, against the key result as written. The score is computed from progress at the close (§2.10). A person may adjust it with a written reason, and both numbers are kept (§12). No credit for activity alone. *Source:* Doerr: "unbiased scores should be looked at subjectively, in case there are extenuating circumstances"; Google's grading example: three of six features launched grades 0.5.

| Score | Aspirational | Committed |
|---|---|---|
| 1.0 | Achieved | Met |
| 0.6 to below 1.0 | On target. The expected range for a stretch | Missed. Explain the miss |
| 0.3 to below 0.6 | Partial progress. Examine what limited it | Missed. Explain the miss |
| Below 0.3 | Little progress. Examine the target, the capacity, the cadence or the tracking | Missed. Explain the miss |

*Source:* re:Work: "The sweet spot for OKRs is somewhere in the 60-70% range"; Google's OKR playbook: committed OKRs expect 1.0, aspirational average 0.7. Doerr colours 0.7 and above green, 0.4 to 0.6 yellow and below 0.4 red, which a workspace may choose instead.

The coach annotates. First match wins; nothing else gets a note:

| Score | Note |
|---|---|
| A pattern of 1.0 | Across a closed cycle, when three quarters or more of the aspirational key results scored 1.0: "the targets were too safe" |
| Committed, below 1.0 | "Write the short explanation of the miss" |
| Below 0.3 | "Little progress. Pick its root cause" |

*Source:* Klau: "if someone consistently gets 1.0, their OKRs aren't ambitious enough."

### 3.4 Portfolio verdict

Committed and aspirational key results are reported separately, because averaging them hides both.

**Committed:** the share met, and each miss with its explanation.

**Aspirational:** the average across the scored set.

| Average | Verdict |
|---|---|
| Above 0.85 | The targets may not have been ambitious enough |
| 0.60 to 0.85 | Healthy portfolio |
| 0.40 to below 0.60 | Partial. Examine what limited it |
| Below 0.40 | Investigate: the strategy, the capacity or the cadence (§8.6) |

*Source:* Google's OKR playbook and re:Work: "Scoring higher may mean the aspirational goals are not being set high enough."

### 3.5 Health

Health is derived, never typed in. Precedence, first match wins:

1. **Closed outcome.** The goal is closed as achieved, missed or abandoned.
2. **Outdated.** The check-in is overdue past the grace window. This overrides whatever the last check-in said, and the last reported status is still shown beside it.
3. **Latest published check-in status.** On track, at risk, or off track. "At risk" is the default label for the stored status `caution`, set in terminology.
4. **Pending.** No check-in yet.

A goal that has never been checked in is `pending`, not `on track`. Silence is never green. *Source:* Perdoo (vendor) uses the same "no status" grey and an "outdated" flag.

**Reported health against the data.** When a goal reports on track and one of its metric key results has not moved within the divergence window (§11), the coach says so (§10).

### 3.6 Trend forecast

From a metric key result's value history, project the end-of-cycle value with a linear fit over the recent window, once there are enough values (§11). If the projection misses the target, flag `trending off track` before the human status changes. It is labelled a projection. Milestone, baseline and maintain key results get no forecast. *Source:* Lamorte: predictive progress "acts as an early warning system".

### 3.7 The progress signal

Beside health, every goal and key result carries a red, amber or green signal. By default it compares progress with the progress expected for the date: on pace is green, behind by more than the first gap is amber, behind by more than the second is red (§11). A workspace may choose the absolute signal instead, green at or above the pass threshold and red below the fail threshold (§12).

The signal is shown beside health, never instead of it. A green progress bar on an outdated goal still reads outdated. *Source:* Microsoft Viva Goals (vendor): "expected progress % based on the Start date and End date"; "If (Expected Progress - Aggregate Progress > 25%), then At Risk".

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

**What word lists can and cannot do.** OBJ-1, KR-5 and parts of KR-2 match words. A word list will always be behind English, and the checks are measured against published OKRs (`packages/method/test/published-examples.test.ts`). So no word-list check blocks by default. A person decides what blocks, not a word.

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

The shape row sits second, above the output-verb sweep. "Cannot tell" passes with a tip: as a warning it would fire on most well-formed objectives, which would make it a banner rather than coaching.

No row fails; the worst verdict is a warning. Doerr's own example objective is "Build a planning model for their company", and Wodtke's good example is "Launch an Awesome MVP", so an objective that opens with an action is a style question, not a defect. *Source:* Doerr: objectives are "significant, concrete, action oriented, and (ideally) inspirational".

Word lists:

| List | Words |
|---|---|
| Output verbs | launch, build, ship, implement, create, deliver, release, complete, develop, deploy, write, publish, migrate, install, conduct, hold, organise, organize, set up, roll out, rollout, hire, redesign, finish, produce, run |
| Movement verbs | increase, grow, improve, reduce, boost, raise, cut, double, triple, maximise, maximize, minimise, minimize, decrease, accelerate, expand, drive, bring |
| State words | become, be the, delight, delighted, loved, trusted, leading, best, strongest, profitable, sustainable, engaged, thriving, world-class, prefer, preferred, go-to, healthiest, excellence, dominant, known for, famous for, proud |
| Why markers | so that, in order to, because |

"To" is not a why marker: every "from X to Y" contains it, so "Increase revenue from $2M to $3M" would pass as movement with a why. "Bring" is a movement verb, so a recovery objective is judged as movement.

**End-state shapes.** A word list can only recognise an end state that happens to use one of its words. These are sentence shapes that name an end state without needing any of them, and an objective matching one passes OBJ-1. `…` stands for any words.

| Shape | Example |
|---|---|
| make … something … | Make onboarding something new customers finish by themselves |
| reach the point where … | Reach the point where the product sells itself |
| get to where … | Get to where a failed payment never reaches a person |

Measured against twenty real drafts with `pnpm method:verdicts`.

**OBJ-2 Qualitative and memorable.** Warn.

| Condition | Status | Prompt |
|---|---|---|
| Contains digits other than a four-digit year | warn | "Metrics usually belong in the key results. Keep the objective qualitative and memorable." |
| More than 18 words | warn | "Trim it. If your team cannot recite it from memory, it will not steer their daily decisions." |
| Otherwise | pass | "Good length and qualitative. Read it aloud. Would it make your team lean in?" |

There is no lower bound: whatmatters' own "Achieve fiscal sustainability" is three words. The 18-word limit is an OpenOKR default.

**OBJ-3 Timebound.** Block. Fail without a cycle or an explicit timeframe. An OKR without a deadline is a wish. *Source:* Wodtke: "Time Bound"; Doerr: key results are "time-bound".

**OBJ-4 Owned.** Block. Fail without a named champion. A named reviewer is required only where the workspace requires reviewers (§2.5).

**OBJ-5 Counted.** Warn when a unit exceeds 3 objectives, or the company level exceeds 5.

### 4.2 Key result checks

**KR-1 Count.** Pass at 2 to 5. Fail at none, which blocks. Warn at 1 ("can a single measure prove this from every angle?"). Warn above 5 ("which would you drop if you had to?").

**KR-2 Verifiable.** Judged by the key result's kind (§2.10).

| Condition | Status | Prompt |
|---|---|---|
| Metric with a baseline and a target, or "from X to Y" | pass | "Measurable from where you are to where you must land." |
| Metric with a target but no baseline | warn | "A target but no baseline. Without the from, you cannot prove movement." |
| Metric with no numbers | warn | "What is the number today, and where must it land? If it is done or not done, make it a milestone key result." |
| Maintain with a band | pass | "Clear: inside the band or not." |
| Milestone with a due date | pass | "Verifiable: done or not done by the date. Check it proves the objective, not only the plan." |
| Baseline | pass | "Establishing the number is a fair first key result." |

**KR-3 Complete.** Block when the target (metric and maintain), the due date or the owner is missing. Warn when a metric key result has no baseline. If a baseline is unknown, establishing it can be its own key result (§2.10). *Source:* Doerr's own key results ("99% uptime") often carry no baseline.

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

**KR-6 Ambitious but honest.** Info. Aspirational key results only, judged on the set's average confidence (§3.2). For committed key results, see §3.2's committed rule.

**KR-7 Direction set.** Derived from the baseline and the target for a metric key result. Fail, which blocks, only when a metric key result has none and none can be derived. Not asked of the other kinds.

### 4.3 Alignment checks

**AL-1 Supports a bigger priority.** Warn when a goal has no parent, no stated contribution and no standalone reason ("which priority does this move forward?"). Warn when the stated contribution is fewer than three words ("growth is not a priority, it is a word. Which growth goal, whose?"). Pass otherwise. A goal may stand alone with a stated reason. *Source:* Perdoo (vendor): "Alignment is not mandatory, but best practice"; whatmatters: a team that inherits no objective is not unimportant.

**AL-2 One parent only.** Block. A goal aligns under exactly one parent goal or one parent key result, or neither. Never both. A data rule of this product.

**AL-3 No level skip.** Off by default. A workspace that wants a strict cascade may turn it on, and then a team goal aligned straight to a company goal is flagged. *Source:* whatmatters: "A team can ladder to any other team's priority in the organization – vertically, horizontally, even diagonally."

**AL-4 Company anchor.** Warn. At least one company-level objective anchors the tree. *Source:* re:Work: "it can be helpful to commit first to organizational objectives".

**AL-5 Dependencies declared.** Warn. Every cross-team dependency is confirmed by the providing team, or escalated to the sponsor, or logged as a risk with a named owner. *Source:* Google's OKR playbook: contributions "should appear explicitly in each such group's OKRs", and "escalation is good".

**AL-6 Not siloed.** Off by default. Where on, a department whose whole subtree has no horizontal dependency with any other department is noted as a possible silo. Finance, legal and platform teams are often legitimately self-contained. *Source:* OpenOKR default.

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

OBJ-1 warns by default, so it reaches gate 2 only where a workspace raises it to block.

### 4.6 Weak and strong examples

The coach shows these beside the check that fired.

| Weak | Strong | Why |
|---|---|---|
| Objective: Launch the new mobile app by end of Q3 | Objective: Make mobile the way our customers prefer to reach us | You can launch and still fail. The strong version names the change in customer behaviour. For a committed delivery, "Launch the app" can be an honest milestone key result under it |
| KR: Improve customer satisfaction | KR: Increase NPS from 32 to 50 (lagging). KR: Cut first-response time from 9h to 2h (leading) | No baseline, no target, no way to score it. The strong pair sets from and to, and combines lagging proof with a leading signal you can steer weekly |
| KR: Hold 12 customer interviews | KR: Raise activation rate of new sign-ups from 41% to 60% (lagging). KR: Interview 12 churned customers by week 6 (leading) | Interviews alone are activity. Ask what they are for and measure that outcome; the interviews can stay as a tagged leading signal |
| KR: Increase sales calls from 40 to 120 per week | KR: Grow qualified pipeline from $1.2M to $3.0M (lagging). KR: Lift call-to-meeting conversion from 8% to 15% (leading) | Measurable, but still an output. If 120 calls create no pipeline, the key result was achieved and the quarter was wasted |
| Committed objective whose key results are all at 0.4 confidence | Either find the resources now, or mark it aspirational | A commitment nobody believes in is a risk to escalate, not a stretch |

---

## 5. Alignment

### 5.1 Two directions

| Direction | Meaning | Recorded as |
|---|---|---|
| Vertical | This goal supports a goal or key result at its own level or any level above it, in any space and in an earlier or longer cycle, such as an annual objective | A single parent pointer |
| Horizontal | This goal and another goal in a different team depend on each other | A two-way dependency link |

Vertical alignment is contribution, not copying (principle 9). Roughly half of a healthy organisation's OKRs are proposed by the teams themselves and laddered up. *Source:* Doerr: "roughly half"; Castro: "60% of the OKRs are created bottom-up".

### 5.2 Alignment health score

The share of goals below company level that align to a parent or state why they stand alone, as a percentage.
- **Healthy:** 90% and above.
- **Watch:** 80% to below 90%.
- **Gap:** below 80%.

With no company-level objective, the score reads as a gap whatever the share.

The coach lists every unaligned goal, each linking straight to it. *Source:* Profit.co (vendor): fewer than 10% of team OKRs without a traceable parent is healthy, more than 20% is a warning.

The score is a share rather than a sum of per-goal penalties, because a fixed penalty would make eight unaligned goals cost the same in a ten-goal company and a five-hundred-goal one.

### 5.3 Semantic review

Structure is not enough. Two goals can be perfectly wired and still pull against each other. The coach reads every objective and key result and returns typed findings:

| Type | Meaning |
|---|---|
| Relink | This goal's content supports a different parent better than its current one, or it is unaligned and this is the right parent |
| Dependency | These two goals share metrics or workstreams but no explicit horizontal link exists |
| Conflict | These two goals pull in opposite directions, or may double-count the same metric |
| Gap | Something is missing or weak, with no second goal involved |

Each finding carries a severity of high, medium or low and one specific sentence of reasoning. Findings are advice. Where the fix is mechanical (relink, dependency), the finding offers a one-click proposal for a person to accept. Findings are dismissible and stay dismissed.

### 5.4 Dependencies

Every dependency records: the key result that depends, the providing team, and whether the providing team has confirmed it. A dependency that is not confirmed is escalated to the sponsor, or logged as a risk with a named owner. *Source:* Google's OKR playbook on escalation; Lamorte on naming a co-owner from each team.

### 5.5 Capacity

For every key result, record the main initiatives that will move it and one of three capacity verdicts: **fits**, **tight**, **exceeds**.
- **Committed OKRs:** a committed OKR left at "exceeds" is a warning at publish (gate 5).
- **Aspirational OKRs:** they may exceed.
- **What was cut:** the facilitator asks each team what it cut to make room, and records it. "Nothing" is worth a second question.

*Source:* Google's OKR playbook: a team's committed OKRs should credibly consume most, but not all, of its resources, and its committed and aspirational OKRs together "somewhat more than their available resources".

---

## 6. KPIs and recovery OKRs

### 6.1 What a KPI is here

A KPI is a number you watch every period whether or not it is an OKR. KPIs describe the health of the business. OKRs describe what you are changing about it. The two connect in three ways:
- a key result can be measured by a live KPI;
- an unhealthy KPI can prompt a response, including a recovery OKR;
- the KPI baseline is a Phase 2 input.

*Source:* Castro: "Monitoring KPIs are sometimes called health metrics"; whatmatters: "KPIs often track ongoing metrics of health, or BAU".

### 6.2 KPI attributes

| Attribute | Values |
|---|---|
| Target type | Stay at or above, stay at or below, increase to, decrease to, stay within a range |
| Thresholds | Green and red boundaries in the KPI's own units. Optional; without them the ratio fallback in §6.4 applies |
| Type | Leading, lagging |
| Tier | Input, output, outcome, impact. Optional |
| Frequency | Daily, weekly, monthly, quarterly, yearly |
| Aggregate | Sum, average, max, min, count, last value, first value. Used when a finer period rolls into a coarser one. Use last value for balances and headcount, and model a rate as a calculated KPI (§6.7) |
| Owner | One named person |

*Source:* Perdoo (vendor) target types; Intrafocus (vendor) on banded thresholds for "measures where both extremes are undesirable".

### 6.3 The KPI tree

KPIs may form a driver tree. A tree has one root, usually a lagging KPI such as operating margin or revenue, and its leaves are leading drivers a team can act on this week. A link is one of two kinds:
- **formula**: the child is part of the parent's calculation (§6.7);
- **influence**: the child is believed to move the parent.

A KPI may also stand alone, outside any tree.

Reading rule: to move the root, find the unhealthy branch, then find the leading drivers at its edge. Those drivers are candidates for key results, beside the KPI itself.

*Source:* Mixpanel (vendor): "component relationships … with a formula" and "influence relationships … correlated but don't have the same quantifiable connection".

### 6.4 Health corridors

A KPI's health comes from its own thresholds, in its own units, by its target type. A KPI without thresholds falls back to achievement, the direction-aware ratio of current to target. The fallback suits positive KPIs measured from zero. It does not suit uptime, rating scales, net promoter score, or anything that can be negative, and the KPI form says so when it is used for one.

| State | Meaning |
|---|---|
| Healthy | Inside the green boundary, or 90% of target and above on the fallback |
| Watch | Between the boundaries, or 70% to below 90% on the fallback. Watch the leading drivers |
| Unhealthy | Past the red boundary, or below 70% on the fallback. Decide a response (§6.5) |
| No data | Enter a current value and a target |

For a KPI that should stay within a range, the range is its green band. Its red boundaries sit outside the range: one below, and one above where too high matters too. Between the range and a red boundary is watch.

State precedence, first match wins: no data, then the band. A KPI with an active recovery OKR is shown as **recovering** beside its real band, never instead of it. The fallback thresholds are workspace settings, and each KPI may carry its own (§11). *Source:* Castro: "as long as the dials on the dashboard are within certain thresholds, you don't care about them".

### 6.5 Responding to an unhealthy KPI

An unhealthy KPI asks for a decision. The product offers three:

1. **Fix it now** as day-to-day work, with an owner and a date.
2. **Add a key result** for it to an existing objective.
3. **Launch a recovery OKR.**

*Source:* Wodtke: on a Code Red "you prioritize fixing it … over OKR efforts"; whatmatters: elevate a KPI when it has "slipped so far that it's become a common issue".

A recovery OKR is committed: it restores a level the business already relies on. The product drafts it as follows:
- **Objective:** a qualitative line naming what the KPI protects, such as "Margins we can run the business on again", with the KPI's name in the description. The owner writes the why.
- **First key result:** the KPI itself, from its current value to its healthy boundary.
- **Further key results:** up to three, one per leading driver at the edge of the unhealthy branch that is itself below its target and has an owner. Each is written "improve *driver* from *current* to *target*", inheriting the driver's owner, with each target sized to close the gap.
  - The drivers are found by walking the unhealthy KPI's subtree breadth-first. A leading child is a candidate directly; a lagging child is descended through until its nearest leading descendants are found.
  - A driver already at or past its target is skipped.

The draft is available for one-click launch the moment the KPI turns unhealthy. The coach proposes it after two consecutive unhealthy periods, or at once when the KPI falls from healthy to unhealthy in a single period.

While a recovery OKR is active, the KPI shows its real band and the recovery's progress side by side. When the real reading re-enters the healthy band, the coach proposes closing the recovery OKR. *Source:* whatmatters: "Once it's holding steady, you can demote it to a KPI".

### 6.6 Recovery board

One list across every KPI in the workspace: every KPI that is unhealthy or under recovery, with its real band, its recovery objective and progress, and the three responses for those that have none. This is the KPI equivalent of the review inbox.

### 6.7 Calculated KPIs

A KPI may be calculated from a formula over other KPIs rather than entered. Sources at a finer frequency roll up using their own aggregate function before the formula applies, which keeps a ratio a ratio of sums. Changing a source recomputes every dependent KPI. Self-reference and cycles are rejected.

---

## 7. The rhythm

### 7.1 The three rituals

| Ritual | Length | Frequency | Purpose |
|---|---|---|---|
| Weekly check-in | 15 to 30 minutes | Weekly | A decision loop. Score confidence, discuss what dropped, close and set commitments, name the wins |
| Monthly review | 30 to 60 minutes | Monthly | Trend per objective, dependency and risk log, resource shifts, continue, update, start or stop, decisions recorded |
| Quarterly review | 90 minutes | At cycle close | Review the results, retro the way you worked, reset the next cycle |

Book all of them for the whole cycle before the cycle starts. Calendars fill fast, and "set and forget" kills OKR programmes. *Source:* Wodtke's "Set & Forget".

Every two weeks and monthly are valid check-in frequencies (§11). The streak and the escalation ladders follow whichever is chosen. *Source:* Lamorte: "The sweet spot is bi-weekly check-ins"; Doerr and Wodtke: weekly.

Keep check-ins forward-looking. Status lives in the product. The meeting is for decisions. *Source:* Wodtke: if only a third of the time is presentations "you are doing it right".

### 7.2 The weekly check-in, in four steps

**Step 1. Confidence round.** Every key result gets a confidence. Where the team votes, each member submits privately and the votes reveal together with a team average, so nobody anchors on the champion. The champion confirms the confidence and writes one or two lines: what changed this week. Facts first.

**Step 2. Discuss what dropped.** Any key result whose confidence fell gets a short discussion. Every low score gets a next action due by the next check-in, with an owner. Where something is actually blocked, it gets a blocker too:

| Field | Rule |
|---|---|
| Blocker type | One of the types in §7.3 |
| Blocker owner | A named person, not a team |
| Next action | One concrete action due by the next check-in, not a discussion |

A key result that falls into the low band is raised with the coordinator.

**Step 3. Commitments and wins.**
1. Close last week's commitments: delivered or not, with a line on why where it helps.
2. Set this week's: three or four concrete actions for the team, each with an owner and a linked key result. Not a to-do list; the few moves that shift a key result.
3. Name the week's wins.

*Source:* Wodtke: "what are the 3-4 most important things you must get done this week toward the Objective?"; her Friday wins.

**Step 4. Digest.** The product assembles it: headline average and the change on last week, what is on track, what is at risk with owners, open blockers and their next actions, the commitment count and the wins. The coordinator adds a note for leadership. It posts to the team's channel.

### 7.3 Blocker taxonomy

| Type | Definition |
|---|---|
| Resource | No capacity, budget or tools to progress the key result |
| Dependency | Progress waits on another team's output or decision |
| Clarity | The key result is ambiguous. Nobody agrees what done means |
| Priority conflict | Business as usual keeps displacing OKR work |
| External | Market, regulation or partner factors beyond your control |
| Approach not working | The work is happening and the number is not moving |
| Other | Anything else, described in a line |

Every blocker carries an opened time, an owner and a next action. The next action is due by the next check-in. A blocker whose action passes that point is escalated to the coordinator, not re-discussed. *Source:* OpenOKR default. No OKR source defines a blocker taxonomy.

### 7.4 The rhythm streak, holidays and leave

Consecutive check-in periods in which a space held its check-in, at whatever frequency the space runs. A skipped period breaks it; a period marked as a holiday does not.

A space marks its holiday periods. No check-in is due in them, nobody is nudged for them, the streak does not break, and the measured rhythm (§8.6) does not count them. Shown on the space home. A light touch that keeps the heartbeat visible. *Source:* Tability (vendor) shows check-in streaks.

A member marks their own leave, with a delegate. While they are away nobody nudges them, their reviews and acknowledgements go to the delegate, and a check-in on a goal they champion is the delegate's to post, so their absence never breaks the space's streak. Leave never moves a role for good: that is a reassignment, recorded as one.

### 7.5 Monthly review

| Item | Recorded as |
|---|---|
| Trend per objective | Improving, flat, declining |
| Dependency and risk log | Status per dependency |
| Resource or priority shifts | Free text |
| Continue, update, start or stop | Each move recorded as §2.9 says |
| Decisions | A dated decision against the affected key result |

The decision log is the artifact that survives the meeting. Every decision names the key result it affects. *Source:* re:Work: "it can be helpful to have a mid-quarter check-in"; Doerr's continue, update, start, stop.

### 7.6 Mid-cycle calibration

A target may be changed at any time in the cycle, as §2.9 says. Making a target harder needs no reason. Easing one, toward its baseline, needs a written reason, and the original target stays on record. It got hard is not a reason, and changing a target only because it got hard empties the score of meaning.

---

## 8. The quarterly review

Ninety minutes by default, four acts, eleven timed stages, held about two weeks before the cycle ends. A workspace may split it into a review session and a separate retrospective (§12). When split, the review session holds the Open and Review acts (stages 1 to 4) and the retrospective holds the Retro and Reset acts (stages 5 to 11). An annual cycle closes with the same review over its annual OKRs, held before any of the next year's drafting. Each act asks one question.

| Act | Question |
|---|---|
| Open | Where is everyone, before the numbers? |
| Review | Did we achieve the results we set out to? |
| Retro | How did we work together to get there? |
| Reset | What do we decide for the next cycle? |

*Source:* Mooncamp (vendor): a retrospective takes "45 to 90 minutes"; Workpath (vendor): "a Review is about the outcome, while the Retrospective focuses on the process"; Lamorte suggests about ten minutes per key result.

### 8.1 The stages

| # | Stage | Act | Minutes | Purpose |
|---|---|---|---|---|
| 1 | Open and check-in | Open | 5 | Before the numbers, the people. A pulse and one word for the cycle |
| 2 | Score the key results | Review | 20 | Grade every key result against the key result as written, then reveal the objective score together |
| 3 | Objective narratives | Review | 12 | Owner by owner, the story behind the score, and what the number does not show |
| 4 | Recognition and wins | Review | 5 | Name the effort that deserved to be seen. Specific beats generous |
| 5 | Team retro | Retro | 10 | What worked, what did not. Silent writing, then dot voting |
| 6 | Management retro | Retro | 8 | The four questions leadership owes the team |
| 7 | Root cause and diagnostic | Retro | 8 | Every key result below its root-cause threshold gets one honest cause. Then read the diagnostic |
| 8 | OKR process health | Retro | 4 | Score the practice, not the results. Anonymous |
| 9 | Keep, modify, abandon or defer | Reset | 8 | Close every objective deliberately |
| 10 | Learnings | Reset | 5 | Turn what happened into what you now know |
| 11 | Decisions and actions | Reset | 5 | Every action has a name and a date, or it is a wish |

Stage minutes are defaults (§11). A stage timer runs with pacing cues. Going over is normal and visible. The facilitator lands it and moves.

### 8.2 Room pulse

Each participant gives a 1 to 5 pulse and one word. The average is read back:

| Average | Read |
|---|---|
| 4.0 and above | The room has energy. Use it. Be honest about ambition, not just relieved |
| 3.0 to 3.9 | Steady, not euphoric. Watch for polite scoring later. Steady rooms round their numbers up |
| Below 3.0 | The cycle cost something. Name it early or it leaks into every score in the next ten minutes |

The reads are coaching for the facilitator. *Source:* OpenOKR default; a one-word check-in is a common retrospective opener.

### 8.3 Scoring reveal

Score each key result 0.0 to 1.0 against the key result as written, with baseline, target, actual and any mid-cycle changes on screen as evidence, plus a one-line reason. The objective score is hidden until the team reveals it together. Facts, not feelings. A row of 1.0s on aspirational key results usually means the ambition was too safe, and that gets said out loud now, not next quarter. A committed key result below 1.0 gets its short explanation, and the scoring stage does not close until every one has it.

An objective's score is the weighted average of its key results' scores, using the same weights §3.1 uses for progress. A team that said one key result matters three times as much should see that in the score, exactly as it sees it in the progress. An unscored key result is left out rather than counted as zero, so a half-graded objective does not read as a failing one.

The cycle score is a different question about a different set: the §3.4 average over every scored aspirational key result in the cycle (§8.6), with committed key results reported as the share met. Averaging the objective scores instead would weight an objective with two key results the same as one with eight.

### 8.4 Root causes

Every aspirational key result below 0.6, and every committed key result below 1.0, gets one primary cause, and may name a second:

1. Ambition set too high
2. Wrong key result. We measured the wrong thing
3. Blocked by a dependency
4. Capacity or resourcing
5. Priority shifted mid-cycle
6. External or market change
7. Lack of focus. Too many OKRs
8. No clear owner or cadence
9. Other, described in a line

Look for the system, not the person. Ask why until it stops being a symptom. *Source:* Google's OKR playbook: a missed committed OKR gets a postmortem "not intended to punish teams"; Doerr: "If not, what obstacles did I encounter?"

### 8.5 Process health

Five statements, anonymous, 1 (not true for us) to 5 (consistently true):

1. Our OKRs stayed visible and were genuinely used to make decisions this cycle.
2. We held a real check-in cadence, not a status report.
3. Our key results measured outcomes, not activity we were going to do anyway.
4. We had few enough OKRs that focus was possible.
5. When something went off track, we said so early rather than at the end.

The lowest-scoring statement becomes an improvement action for the next cycle, with an owner and a date. *Source:* OpenOKR default.

### 8.6 The rhythm diagnostic

Combine the cycle score (the §3.4 average over every scored aspirational key result in the cycle) with the rhythm score: the share of due check-ins published within tolerance, measured by the product. Holiday periods (§7.4) are not due, so they are not counted. Process-health statements 2 and 5 are shown beside it as a cross-check. The diagnosis is a hypothesis for the room to test, not a verdict.

| Condition | Diagnosis | Prescription |
|---|---|---|
| Cycle score 0.6 or above | Results delivered | The question is not effort. It is whether the ambition was set high enough to be worth the quarter |
| Cycle score below 0.6, rhythm 75% or above | Likely a strategy or OKR-quality problem | The team ran the rhythm and still missed. Look first at the OKRs themselves, or the strategy behind them, before you push the team |
| Cycle score below 0.6, rhythm below 75% | Likely a rhythm problem | This looks like a cadence problem, not an ambition problem. Restore the weekly check-in before you rewrite a single objective |

*Source:* OpenOKR default. Thresholds are in §11.

### 8.7 Management retro

The four questions leadership answers out loud, before anyone drafts a next cycle:

1. Were we focused on the right priorities?
2. Did our OKRs bridge strategy and execution?
3. Did we change how we work, or reinforce old habits?
4. Where did alignment break down?

*Source:* OpenOKR default. Guidance for the facilitator.

### 8.8 Keep, modify, abandon or defer

Every objective is closed deliberately with one decision and a one-line why:

| Decision | Meaning |
|---|---|
| Achieved | Done. Close it |
| Keep | Still relevant. It pre-fills next cycle's draft, and still passes next cycle's checks |
| Modify | Adjust the target or wording from what we learned, then keep it |
| Defer | Still worth doing, not next cycle. It goes to the issue list |
| Abandon | Priority shifted. End it cleanly |

Nothing carries over silently. An unfinished aspirational objective is proposed as Keep by default (§12). *Source:* Lamorte: "keep, modify, abandon, or defer"; Google's OKR playbook on carrying aspirational OKRs forward; Doerr: rolling over automatically "then these OKRs aren't serving you".

### 8.9 Learnings and feed-forward

Capture learnings as "we learned that…". Promote the top dot-voted retro themes into learnings. Mark the ones to carry forward. *Source:* Doerr: "What have I learned that might alter my approach to the next cycle's OKRs?"

At close, the product feeds the next cycle automatically:

| From this cycle | Into the next cycle |
|---|---|
| Every key result and its score | Phase 2, the prior-cycle scoring list |
| Every kept or modified objective | Phase 4, a pre-filled draft whose key results start from their last recorded values as baselines |
| Every deferred item and carry-forward learning | Phase 2, the strategic issue list at impact 4 |
| Learnings and the retrospective | Phase 1, the input pack |
| The lowest process-health statement | Phase 3, an improvement action |
| The annual frame and annual OKRs | Phase 0 reference, focus flags cleared |

### 8.10 Minutes

The review produces minutes with:
- an executive summary: the cycle score, committed key results met, objectives and key results reviewed, key results below their root-cause threshold, the team pulse, learnings carried and actions agreed;
- every stage's record.

The minutes are exportable as a document and as a PDF.

Grade and hold the review before drafting the next cycle's OKRs, and preferably not in the same session. Drafting pressure distorts honest scoring.

---

## 9. Facilitator guidance

What a good coach says at each phase. The product surfaces these as notes to the facilitator, and the coach agent uses them as its voice.

| Phase | Guidance |
|---|---|
| 0 Annual strategy | Run this once a year with the most senior group in the room, before any quarterly cycle starts. Keep it to five annual objectives at most. If the annual set already contains everything, no quarter can choose |
| 1 Prepare | Gather the inputs before the drafting session; drafting blind wastes the room. Timebox the gathering. An incomplete pack on time beats a complete pack late |
| 2 Diagnose | Keep scoring factual. Scores are planning data, not pay. If prior OKRs were never tracked, record that as a process issue to fix in Phase 6 |
| 3 Set direction | Force trade-offs. A priority list that accommodates everything is a to-do list, not a strategy. Push for a written not-doing list. Quarterly revalidation takes 30 to 60 minutes, not a full strategy debate |
| 4 Draft OKRs | Ask of every key result "what changes if this succeeds?" and measure that where you can. Ask whether each objective is committed or aspirational. Run peer review between teams before leadership sees the drafts |
| 5 Align and commit | Run alignment and dependencies as a joint session or a structured asynchronous review. Teams rarely volunteer that the plan does not fit. Ask each team directly what they cut |
| 6 Run the cadence | Book every check-in and review for the whole cycle before it starts. Keep check-ins forward-looking. Status lives in the product, the meeting is for decisions. Use the monthly review to continue, update, start or stop |
| 7 Review and learn | Grade two weeks before the end and hold the review before drafting the next cycle. A pattern of 1.0s on aspirational key results suggests sandbagging. Name it and address stretch explicitly in the next Phase 4. A committed miss gets a postmortem, not blame |

---

## 10. What the coach watches for

The full trigger catalogue is in AI-NATIVE-PLAN.md §6. This is the practice behind it: the situations a real OKR coach spots, and what they say. A situation whose rule a workspace has turned off is not raised.

| Situation | What the coach says |
|---|---|
| Objective starts with an output verb | If we do it and nothing changes, did we succeed? |
| Objective contains numbers | Metrics usually belong in the key results |
| Metric key result has no baseline | Where are you today? If you do not know, establishing it can be its own key result |
| Key result measures activity volume | More calls, to what end? If you can measure that impact, make it the key result |
| Tagged key results are all lagging | You will only find out at the end. Add a leading indicator you can act on weekly |
| Aspirational set near certain at draft | If this must be delivered, mark it committed. If it is a stretch, raise the targets |
| Committed key result below 0.7 confidence, at drafting or at a check-in | A commitment nobody believes in is a risk. Escalate now, or make it aspirational |
| More than five company objectives | If everything is a priority, nothing can be chosen. Which two would you drop? |
| Not-doing list empty at the end of an annual Phase 3 | A list that accommodates everything is a to-do list, not a strategy |
| Goal with no parent and no stated reason | Which priority does this move forward? If it stands alone, say why |
| Two goals may double-count a metric | These two claim the same movement. Check which one owns it |
| Dependency unconfirmed | Unconfirmed is a risk. Get the confirmation, escalate, or name a risk owner |
| Capacity check with nothing cut | What did you stop doing to make room? |
| Check-in overdue past grace | This goal is stale. It cannot quietly stay green |
| Blocker action past the next check-in | This blocker has not moved. Raising it with the coordinator |
| Confidence fell into the low band | What changed? Name the next action |
| Reported health disagrees with the data | Reported on track, but this key result has not moved within the divergence window |
| Trend forecast misses the target | On current trajectory this misses. Better to say it now than at the close |
| KPI turns unhealthy | This KPI is unhealthy. Fix it now, add a key result, or launch the drafted recovery OKR |
| Pattern of 1.0s on aspirational key results at the close | Targets were too safe. Address stretch explicitly when drafting the next cycle |

Under a stricter profile, level skips (AL-3) and silos (AL-6) join this list.

The coach never guesses at the situation. Every one maps to a rule in this document, and every message cites the rule so the recipient can argue with it. The semantic review (§5.3) is advice, and says so.

---

## 11. The threshold registry

**What a workspace cannot change.** The principles in §1 are the practice's centre:
- outcomes over activity;
- few objectives;
- one owner per goal;
- derived health and visible neglect;
- scores kept out of pay;
- deliberate closes;
- every coaching message citing its rule.

These are not settings.

**What a workspace may change.** Everything else, from settings, starting from the defaults in this document:
- which checks and gates apply and how strongly;
- whether phases bind;
- who may write and when;
- the kinds of OKR and key result in use;
- the scales;
- the cadence;
- the escalation;
- the session formats;
- every number below.

The practice settings are in §12. A workspace that changes them is still practising OKRs, adapted to its context.

Every numeric value the product enforces, computes with or fires on is a parameter in this registry. The §2.4 timelines are guidance for humans, not machine thresholds. Each parameter ships as data in `packages/method` with the default shown here, and may be overridden per workspace. Nothing numeric is hardcoded anywhere else, and a value not in this registry is not a setting. Where no source was found for a value, it is an OpenOKR default.

**Cadence and escalation**

| Parameter | Canon default |
|---|---|
| Check-in frequency | Weekly. Every two weeks and monthly are also valid |
| Check-in anchor day | Monday |
| Cadence tolerance | 1 day either side of the due date without double-advancing |
| Staleness grace | 3 days past the due date, after which the goal reads outdated |
| Check-in escalation ladder | Champion at due, champion again at 1 day overdue, reviewer when grace is exceeded where the goal has one, coordinator at 7 days. The sponsor sees stale goals in the weekly digest, and is a ladder step, at 14 days, only where the workspace adds it |
| Acknowledgement ladder | Reviewer nudged 1 day after publication, escalated at 3 days. Only where the goal has a reviewer |
| Blocker clock | The next action is due by the next check-in |
| Blocker ladder | Owner reminded 1 day before the next check-in, coordinator when the check-in passes with the action open |
| Nudge deduplication window | 1 nudge per subject per member per day unless the escalation step increases |
| Nudge volume ceiling | 5 per member per week. Anything past the ceiling waits for the next digest |
| Due-soon lead | 1 day before the anchor day |
| Planning-open lead | 6 weeks before an annual cycle starts, 4 weeks before a quarterly |
| Team publication window | 2 weeks after the cycle starts |
| Publication deadline countdown | 14, 7 and 1 days before the deadline |
| Review preparation lead | 2 weeks before the cycle ends |

**Confidence and scoring**

| Parameter | Canon default |
|---|---|
| Confidence high boundary | 0.7 |
| Confidence low boundary | 0.4 |
| Critical confidence | 0.3 and below. Escalates the same day only where critical escalation is on |
| Aspirational draft target | About 0.5, shown as 5 in 10 |
| Draft near-certain threshold | Average above 0.90 on aspirational key results |
| Draft comfortable boundary | 0.70 |
| Draft moonshot boundary | 0.30 |
| Committed confidence floor | 0.7, at drafting and at every check-in |
| Score band boundaries | 1.0, 0.6, 0.3 |
| Committed expected score | 1.0 |
| Aspirational expected average | 0.7 |
| Portfolio verdict boundaries | 0.85, 0.60, 0.40, over aspirational key results |
| Close too-safe pattern | Three quarters or more of a closed cycle's aspirational key results at 1.0 |
| Root-cause threshold | Aspirational below 0.6, committed below 1.0 |
| Progress ceiling | 100%, raisable to 200% |
| Progress signal pace gaps | 10 and 25 percentage points behind expected progress |
| Progress signal pass | 75%, for the absolute signal |
| Progress signal fail | 50%, for the absolute signal |
| Trend forecast minimum values | 4 |
| Divergence window | 4 weeks with no movement while reported on track |

**Quality and planning**

| Parameter | Canon default |
|---|---|
| Coach strictness | Per check, as §4 sets out. Strict mode raises every check to block |
| Strength score boundaries | Red below 45%, green at 75% and above |
| Strength score warn weight | 0.5 |
| Key results per objective | 2 to 5. Block at none, warn at one or above five |
| Objective length limit | 18 words, warn above |
| Company objective cap | 5, warn above |
| Objectives per unit cap | 3, warn above |
| Contribution minimum | 3 words |
| Strategic issue minimum | 3, ranked |
| Priority bounds | 3 to 5, each with a 12-month success statement, annual cycles |
| Annual strategy bounds | 2 to 5 |
| Carry-forward issue impact | 4 |
| Input pack lead time | 3 working days before session one, as guidance |
| Quality word lists | The §4 lists. A workspace may add terms; the built-in terms remain |

**Alignment**

| Parameter | Canon default |
|---|---|
| Alignment healthy threshold | 90% of goals below company level aligned or standing alone with a reason |
| Alignment watch threshold | 80% |

**KPIs and recovery**

| Parameter | Canon default |
|---|---|
| KPI healthy threshold | 90% of target, on the ratio fallback |
| KPI watch threshold | 70% of target, on the ratio fallback |
| Recovery key result cap | 4, the KPI itself included |
| Recovery proposal delay | 2 consecutive unhealthy periods, or at once on a fall from healthy to unhealthy in one period |

**Sessions**

| Parameter | Canon default |
|---|---|
| Weekly session length | 15 to 30 minutes |
| Monthly review length | 30 to 60 minutes |
| Quarterly review length | 90 minutes |
| Annual revalidation length | 30 to 60 minutes |
| Weekly commitment bounds | 3 to 4 per team per week |
| Quarterly stage minutes | The §8.1 durations |
| Retro dots per member | 3 |
| Room pulse read boundaries | 4.0 and 3.0 |
| Diagnostic cycle-score threshold | 0.6 |
| Diagnostic rhythm threshold | 75% of due check-ins published on time |

The registry's keys, types, valid ranges and defaults are data in `packages/method`. The workspace settings store only deviations, validated against that schema; an unset key reads the default. The conformance suite compares the defaults against this document.

Every parameter has a default, so a workspace practises the full method correctly from the moment it is created. Tuning is an option, never a prerequisite.

---

## 12. Practice settings and profiles

The non-numeric choices a workspace makes about its practice. Each has the recommended default first. Changing one is an audited admin action, and no setting can make the product refuse a read or lose data.

**A cycle keeps the rules it was graded under.** When a cycle closes, the practice settings and every threshold in force are recorded with it. Changing a band or a cap later does not rewrite a closed cycle's verdicts.

### 12.1 The settings

| Setting | Options | Default | Source |
|---|---|---|---|
| Who may write OKRs, and when | Any time · Planning window · After the phases | Any time | Doerr |
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

---

## 13. Sources

The published practice this document rests on.

| Short name | Source |
|---|---|
| Google's OKR playbook | Google's internal OKR playbook, hosted by John Doerr: whatmatters.com/resources/google-okr-playbook |
| re:Work | Google re:Work, "Set goals with OKRs": rework.withgoogle.com/en/guides/set-goals-with-okrs |
| Doerr | John Doerr, *Measure What Matters* (2018) |
| whatmatters | Doerr's site, whatmatters.com: changing OKRs, a typical OKR cycle, grading, alignment and KPIs |
| Grove | Andy Grove, *High Output Management*, as quoted in *Measure What Matters* and on whatmatters.com |
| Wodtke | Christina Wodtke, *Radical Focus*, eleganthack.com and cwodtke.com |
| Castro | Felipe Castro, read.felipecastro.com and his published talks and interviews |
| Lamorte | Ben Lamorte, *The OKRs Field Book* and okrs.com |
| Cagan | Marty Cagan, svpg.com |
| Klau | Rick Klau, "How Google sets goals: OKRs" |
| Vendor documentation | Perdoo, Microsoft Viva Goals, Atlassian, Tability, Mooncamp, Workpath, Profit.co, Mixpanel and Intrafocus. Evidence of common practice, not authority |
