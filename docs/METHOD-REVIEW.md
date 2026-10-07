# METHOD.md review against public OKR practice

**Date:** 1 October 2026
**Document reviewed:** [`docs/development-plan/METHOD.md`](development-plan/METHOD.md), 826 lines, at `main` `ab775f8b`. Line numbers below are from that commit.
**Asked by:** Akmal, after the demo refused to let anybody add an objective: "I can't trust that doc anymore … it can be 100% wrong and need to be changed."
**Question:** Which rules in METHOD.md does publicly documented OKR practice support, and which should change?

Nothing in METHOD.md or the code has been changed by this review. METHOD.md changes are a decision for a person (CLAUDE.md, "Never change practice on your own"). Section 9 lists the decisions.

---

## 1. The short answer

**METHOD.md is mostly right about what a good OKR looks like. It is mostly wrong about how hard to enforce it.**

The core ideas come straight from Doerr, Grove, Google and Wodtke:

- outcomes over activity;
- three to five objectives, two to five key results;
- one owner per goal;
- a weekly rhythm;
- scores kept out of pay;
- neglect made visible.

Most of what sits on top of those ideas has no source:

- **Invented detail stated as canon.** Nearly every number, escalation ladder, word list, gate and session agenda was written by the plan's author and presented as canon.
- **Contradictions with the sources.** Several rules say the opposite of what the founding sources say.
- **Contradictions with itself.** The document disagrees with itself in nearly fifty places (section 6). Its score bands alone define the "intended" score three different ways.
- **Advice turned into locks.** The product then turned some of the document's advice into locks that the document never asked for. One of these is the lock that stopped you adding an objective on the demo.

| Area | What holds up | What breaks | Worst single finding |
|---|---|---|---|
| Cycle model (§2, §7.6) | Counts of objectives and key results. Single owner. Individual OKRs optional | Phases as a precondition for drafting. No way to add or stop an OKR mid-cycle | Nobody can create an objective until earlier phases are "complete". No source supports that |
| Scoring and confidence (§3) | Linear progress. Health derived, never typed. "Silence is never green" | Score bands, confidence bands, time-blind red/amber/green | A team that delivers a committed launch at 1.0 is told its target "was too safe" |
| Writing quality (§4.1, §4.2) | Outcomes over outputs as coaching. Few key results | Word-list checks that hard-fail | Doerr's, Wodtke's and Google's own example objectives fail the check and cannot be published |
| Alignment and gates (§4.3 to §5) | Company anchor. Declared dependencies. A capacity check | Six hard publish gates. "No level skip". The alignment score | Doerr says a team "can ladder to any other team's priority … even diagonally". METHOD fails that |
| KPIs (§6) | KPIs measure health, OKRs measure change | Health as a ratio to target. The "recovering" projection | A collapsing KPI can display "90, recovering" |
| Rhythm and reviews (§7, §8) | Weekly confidence. Monday commitments. A close with keep/modify/abandon | 24-hour clocks, same-day escalation, an 11-stage 60-minute review | Every blocker reaches a senior leader within 48 hours |

**The single most important gap is Google's distinction between committed and aspirational OKRs.** Google's own playbook names failing to make it as "TRAP #1". METHOD.md does not have it. That one omission is the root of a dozen wrong rules (section 3.2).

---

## 2. How this review was done

Every rule in METHOD.md was checked against public sources in seven topic reviews. Each review searched and read sources, quoted them, and gave every rule one verdict.

**Sources, in order of weight:**

1. **Primary sources.**
   - John Doerr's *Measure What Matters* and his site whatmatters.com, including Google's internal OKR playbook, which it hosts.
   - Google re:Work.
   - Christina Wodtke (eleganthack.com, cwodtke.com).
   - Felipe Castro (read.felipecastro.com).
   - Ben Lamorte and Paul Niven.
   - Marty Cagan (svpg.com).
   - Rick Klau's account of how Google sets goals.
2. **Vendor documentation**, as evidence of common practice. It is labelled as vendor wherever it is cited: Perdoo, Microsoft Viva Goals, Atlassian, Tability, Mooncamp, Weekdone, Profit.co, Workpath, Mixpanel and Amplitude.

**Verdicts:**

| Verdict | Meaning |
|---|---|
| Supported | A credible source says the same |
| Stricter | The idea is sourced, but METHOD makes it a hard rule, a narrower number, or a lock |
| Contested | Credible sources disagree with each other |
| Unsupported | No source found. Usually a number or list the author invented |
| Contradicted | Sources say the opposite |
| Inconsistent | METHOD.md disagrees with itself |

**Measured, not guessed.** The shipped quality checker ([`packages/method/src/quality.ts`](../packages/method/src/quality.ts)) and the KPI code were run against published OKR examples. The results in sections 3.4 and 3.6 are what the code returns today.

**Verified twice.** The quotes this review leans on hardest were re-fetched and confirmed verbatim:
- Google's committed and aspirational definitions, its expected scores, its resource rules and its carry-forward rule;
- whatmatters' guidance on changing OKRs mid-cycle.

**Limits.** These are in section 10.

---

## 3. Seven problems that run through the whole document

### 3.1 Advice became a lock

The sources treat almost all of METHOD's quality and planning rules as coaching. METHOD, and the code built from it, turns them into refusals.

| What METHOD says | What the product does | What the sources say |
|---|---|---|
| §2.5 L112: the facilitator "**can** refuse to run Phase 4 without a complete input pack" | `goals.create` and `goals.addKeyResult` refuse **everyone**, admins included, while any earlier phase is incomplete. See [`workflow.ts`](../packages/method/src/workflow.ts) `phaseWorkAllowed`, whose comment reads "the product refuses on their behalf", and [`goals.ts`](../packages/core/src/actions/goals.ts) `refuseUnreadyDrafting`, added in commit `4e569ea0` (H-09e) | Doerr: "Start: Launch a new OKR mid-cycle, whenever the need arises." whatmatters: consider "adding an additional OKR". Perdoo (vendor): "You can draft an unlimited number of OKRs". No source requires earlier phases before drafting |
| §2.3 L81: Phase 4 is complete when every check passes. L780: coach strictness is "Warn" | A warning on any draft keeps Phase 4 incomplete, which then blocks later phases | Warnings are advice by METHOD's own definition (L249) |
| §4.5 gate 2: every key result passes §4.2, and no objective fails OBJ-1 | Publishing is refused on word-list heuristics (KR-2, KR-3, KR-4, KR-5, OBJ-1) | No tool found that blocks publishing on automated quality checks. Perdoo: "To activate a Draft OKR, you must manually activate it." Viva Goals approval is human and optional |
| §4.5 gate 1, OBJ-4: every objective needs a named reviewer | Publishing is refused without one | No OKR source defines a per-objective reviewer |
| §4.5 gate 6: a publication date set before day one | A team formed mid-cycle can never publish | No source |
| §4.5 gate 5, §5.5: nothing may be published at "exceeds" capacity | Publishing is refused | Google: "committed and aspirational OKRs should credibly consume somewhat more than their available resources" |

**This is the cause of what you hit on the demo.** The seeded cycle's prior quarter is unscored, so Phase 2 is incomplete and drafting is refused for everybody.

### 3.2 No committed versus aspirational OKRs

Google's playbook defines the two:

> "Commitments are OKRs that we agree will be achieved, and we will be willing to adjust schedules and resources to ensure that they are delivered."

> "Aspirational OKRs express how we'd like the world to look, even though we have no clear idea how to get there and/or the resources necessary to deliver the OKR."

> "The expected score for a committed OKR is 1.0 … Aspirational OKRs have an expected average score of 0.7, with high variance."

It calls "Failing to differentiate between committed and aspirational OKRs" its TRAP #1. METHOD treats every OKR as aspirational, which breaks these rules for committed work:

| METHOD rule | What happens to a committed OKR |
|---|---|
| Principle 4 L33: "Certainty means the target was too safe" | High confidence on a must-deliver commitment is called a fault |
| §3.2 L188: draft confidence above 0.90 is "Sandbagging" | Same |
| §3.3 L209: a key result at 1.0 means "The target was too safe" | A delivered commitment is criticised |
| §3.4 L219: portfolio above 0.85 means "Targets were too safe" | A team that delivered its commitments is told it sandbagged |
| §8.4 L604, L771: every key result below 0.7 needs a root cause | Too loose for committed work: Google says any score below 1.0 needs explaining |
| §5.5, gate 5: nothing published at "exceeds" | Blocks aspirational OKRs, which Google expects to exceed resources |
| Principle 7 L36: "Nothing carries over by default" | Google: aspirational OKRs "should remain on a team's OKR list until they are completed, carrying them forward from quarter to quarter as necessary" |
| §6.5 recovery OKRs, judged by stretch rules | A recovery restores a baseline. That is a commitment |

### 3.3 Numbers with no source, presented as canon

None of these could be traced to any source. Most are reasonable starting values. None should be called canon, and several are wrong as defaults.

| Number | Where | Problem |
|---|---|---|
| Objective length 4 to 18 words | OBJ-2, L783 | whatmatters' own "Achieve fiscal sustainability" is three words and warns |
| Input pack sent 3 working days before session one | L130, CY-1 | Part of Phase 1 completion, so it holds up everything after it |
| "The single most common failure point in an OKR programme" | L120 | Contradicted. WorkBoard: "the biggest mistake is setting and forgetting OKRs". Castro's list of common mistakes does not mention inputs |
| Confidence bands at 0.7 and 0.4. Same-day escalation at 0.3 | §3.2, L763 | A key result drafted in METHOD's own "Ambitious" band (0.25 to 0.40) escalates every single week |
| Score bands 0.9 / 0.7 / 0.4. Portfolio 0.85 / 0.60 / 0.40 | §3.3, §3.4 | Disagree with Google's 0.6 to 0.7, and with each other (section 6) |
| Progress signal green at 75%, red below 50%, with no regard for time | §3.7 | Every goal reads red for the first half of a cycle. Viva Goals compares progress with expected progress for the date |
| Strength score: (pass + 0.5 × warn) / evaluated, red below 45%, green at 75% | §4, L251 | No published equivalent |
| Alignment score penalties 10, 12, 4, 3, 8, floor 5, healthy at 75 | §5.2 | Fixed per-goal penalties do not scale. Eight orphans cost 96 points in a 10-goal and a 500-goal company alike |
| KPI healthy at 90% of target, watch at 70% | §6.4 | Found in one vendor's help pages only. Wrong for uptime, rating scales and negative-valued KPIs (section 3.6) |
| Recovery proposal after 2 consecutive unhealthy periods | §6.5 | Contradicts §10 L725, which fires when a KPI "drops out of its corridor" |
| 24-hour blocker clock. Owner warned at 20 hours, coordinator at 24, sponsor at 48 | §7.3, L748 to L749 | Unrealistic for dependency and external blockers. Every blocker reaches a senior leader in two days |
| Check-in ladder: coordinator at 7 days, sponsor at 14 days | L746 | No tool found that escalates stale goals to an executive |
| 10 nudges per member per week | L751 | Two a working day. Unsourced |
| Quarterly review: 60 minutes, 11 timed stages | §8.1 | Vendors give 60 to 90 minutes for the retrospective alone. Lamorte suggests about 10 minutes per key result |
| Rhythm diagnostic thresholds 0.7 and 3.5 | §8.6 | Rests on two anonymous self-reported statements, while the product already records real rhythm data |

### 3.4 The word-list checks misfire, measured

The shipped checker was run against published OKRs.

**Objectives, OBJ-1:**

| Objective | Source | OBJ-1 today |
|---|---|---|
| "Build a planning model for their company" | Doerr | **fail** |
| "Create the lowest carbon footprint in our industry" | whatmatters | **fail** |
| "Run a 10K in under 50 minutes by June" | whatmatters | **fail** |
| "Launch an Awesome MVP" | Wodtke's *good* example | **fail** |
| "Develop the next generation client platform for web applications" | Google Chrome | **fail** |
| "Run the best support team in the region" | test case | **fail**. The state word "best" is never reached |
| "Sales numbers up 30%" | Wodtke's *bad* example | warn |
| "Double users" | Wodtke's *bad* example | warn |
| "Increase revenue from $2M to $3M" | bare metric movement | **pass**, as "movement with a why" |

The last row passes because "to" is on the list of why markers (L276), and every "from X to Y" contains "to".

**Key results, KR-2 and KR-5:**

| Key result | Source | KR-2 / KR-5 today |
|---|---|---|
| "No one on the team experienced a major injury" | whatmatters | KR-2 **fail** |
| "Launch xx feature to all users" | Google re:Work sample | KR-2 **fail** |
| "Hold 10 meetings with heads of procurement" | whatmatters' *good* leading indicator | KR-5 **fail** |
| "Establish the baseline for weekly active teams" | METHOD's own advice, L309 and L694 | KR-2 **fail** |
| "Increase lines of code shipped from 10000 to 20000" | test case, pure output | **pass** / **pass** |
| "Increase story points delivered from 40 to 60" | test case, pure output | **pass** / **pass** |

METHOD itself says "a word list will always be behind English" (L286). The fix is to make every word-list check advisory, and to let a person, not a word, decide what blocks.

**Re-run at P9-T03a, 2 October 2026.** Every objective above now warns or passes on OBJ-1, and none fails; "Increase revenue from $2M to $3M" warns as bare metric movement once "to" left the why markers. The key results warn on KR-2 or KR-5 rather than failing, and whatmatters' leading indicator passes KR-5 once it is tagged leading. The two pure-output key results still pass: no word list can see them. `packages/method/test/published-examples.test.ts` holds every verdict.

### 3.5 No legitimate way to change an OKR mid-cycle

METHOD allows exactly one mid-cycle change: §7.6 L552, "Once per cycle … a target may be adjusted only for a verifiable change in external reality". There is no way to add an objective, add a key result, close one early, or drop one.

| Source | What it says |
|---|---|
| Doerr, *Measure What Matters* | Four moves through a cycle: continue, update, start, stop. "Start: Launch a new OKR mid-cycle, whenever the need arises" |
| whatmatters | "OKRs are amendable and revisable". Consider "adding an additional OKR or simply taking away one or two KRs" when "something out of your control changes or you become more aware of what the aggressively realistic goal should be" |
| whatmatters | "Never change your OKRs because you're afraid you'll fall short." This part of §7.6 is right |
| Google re:Work | OKRs are "revisited a few times a quarter" to "adjust to new information, abandon objectives" |
| Jos Visser, at Google from 2006 | Against "adding OKRs for things that became hip and happening after the quarter started". This is the strongest voice against; it is about rewriting goals to match whatever was done, not about the tool refusing |

The supported position: anyone may add, update or stop an OKR mid-cycle. The change is visible and carries a reason. Lowering a target because it is hard is not a valid reason.

### 3.6 KPI health arithmetic is wrong for common KPIs

§6.4 measures health as "the direction-aware ratio of current to target", with fixed 90% and 70% cut-offs. The KPI code returns:

| KPI | Actual against target | Result today |
|---|---|---|
| Uptime | 95 against 99.9 | 95.1%, **healthy** |
| Customer satisfaction on a 1 to 5 scale | 3.2 against 4.5 | 71%, watch |
| Net promoter score | target −5 | no state at all |
| Defects | 1 against 0 | 0%, unhealthy |

A collapsing KPI under a recovery OKR displays the higher of its real achievement and a projection (L479). With real achievement at 20%, a recovery started at 60%, and the recovery key results complete, the KPI shows **90, "recovering"**. That breaks METHOD's own rule that a goal "cannot quietly stay green" (L721).

The draft recovery OKR also fails METHOD's own checks:
- **The objective.** "Bring Operating margin back to 15" puts a number in an objective (OBJ-2, L708).
- **A key result that goes the wrong way.** A drafted key result can ask a number to fall while it is marked "increase": "Improve Sales calls per week from 120 to 100".
- **The fallback key result.** "define the first leading driver to move" fails KR-2.

### 3.7 One rigid method

L734: "The structure of the practice is canon and cannot be changed … A workspace that needs a different structure is practising a different method." The practitioners say otherwise:

- Castro: "There is not a single way to adopt OKR."
- Castro: "Even inside Google different teams use OKR in a variety of ways."
- Perdoo (vendor): cycle length is "whatever matches the natural rhythm of the work".

The method also contradicts this framing itself. L369 allows a workspace to override gate 2, while L780 says the gates are "always hard".

---

## 4. What to keep

These are well supported and should survive any rewrite.

| Rule | Where | Source |
|---|---|---|
| Objectives are usually qualitative. Metrics belong in key results | OBJ-2 as a warning | Wodtke: "Sales numbers up 30%" is a poor objective, "Probably because they are actually key results" |
| Prefer outcomes to activity in key results | Principle 2, KR-5 as coaching | Google playbook: key results "must describe outcomes, not activities" |
| Three to five company objectives, up to three per team, two to five key results | §2.7, OBJ-5, KR-1 | Doerr: "A limit of three to five OKRs per cycle"; "five or fewer" key results. re:Work: "around three key results per objective". Castro: "2 to 5 Key Results" |
| One accountable owner per goal | L113 | whatmatters: "only one owner per OKR, even if Key Results are distributed across a team" |
| Individual OKRs are optional | L139 | Castro: "Individual OKRs are not for everyone and should never be required" |
| Scores never feed pay | Principle 6 | Doerr: "Divorce compensation (both raises and bonuses) from OKRs" |
| Health is derived. A goal with no check-in is not green | §3.5 | Perdoo (vendor) uses the same "no status" grey and an "outdated" flag |
| Weekly confidence, Monday commitments, a weekly digest | §7.1, §7.2 | Wodtke: "Adjust your confidence levels every single week" |
| Status lives in the product, the meeting is for decisions | L503 | Wodtke: if only a third of the time is presentations "you are doing it right" |
| Review before drafting the next cycle | L680 | Doerr and Wodtke grade two weeks before the end, then plan |
| Keep, modify or abandon at the close, with nothing rolled over silently | §8.8 | Doerr: rolling over automatically "then these OKRs aren't serving you". Lamorte: "keep, modify, abandon, or defer" |
| KPIs measure health, OKRs measure change | §6.1 | Castro: "Monitoring KPIs are sometimes called health metrics" |
| A company anchor, declared dependencies, a capacity conversation | AL-4, AL-5, §5.5 | re:Work, the Google playbook, Castro, Lamorte |
| Book the cadence up front | §7.1, CY-8 | Wodtke's "Set & Forget" failure mode |

---

## 5. Findings by section

Rows marked Supported are listed briefly. Everything else has a row.

### 5.1 Cycle model and governance (§2, §7.6)

Supported: the counts in §2.7. Annual and quarterly planning lead times as guidance (L49, L50, L753). The single owner. Sponsor and facilitator as roles. Individual OKRs optional. A unit contributing to another unit's OKRs (L141). The timelines as guidance.

| Line: what METHOD says | Verdict | Change | Key source |
|---|---|---|---|
| L69: "Phases 0 to 5 happen before the cycle starts" | Contradicted below company level | Company OKRs before the start. Team and individual OKRs in the first one to two weeks | whatmatters' typical cycle: "1 week after start of quarter: Share Employee Q1 OKRs" |
| L73 to L84: phase completion, used as a lock | Contradicted as a lock | Keep the computation as progress and coaching. Never block creating a draft | Doerr's "Start" |
| L79, CY-2: prior cycle scored or "first cycle" declared | Contradicted as a precondition. Inconsistent with the §2.4 timeline | A warning. Infer "first cycle" when there is no prior cycle | §2.4 L103 schedules scoring three weeks before the quarter, while the prior quarter still has three weeks to run |
| L79, L80: at least 3 issues, 3 to 5 priorities, 12-month statements | Concept supported, numbers unsupported | Guidance, out of phase completion | re:Work: "stack rank the team's current work" |
| L49, L52: the annual frame is "never rewritten mid-year" | Contradicted, and inconsistent with L80 ("documented change") | Mission and vision stay stable. Annual OKRs can be revised at quarterly revalidation, with a reason | Castro: company OKRs "are not set in stone" |
| L114, OBJ-4, gate 1: exactly one reviewer per goal, required | Unsupported | An optional workspace setting. Out of gate 1 | No source names the role |
| L116: one coordinator per space | Unsupported as canon | Keep as an OpenOKR convention, labelled as such | |
| L14, L113 "Champion" vs L5 "OKR Champion" agent | Inconsistent, and clashes with industry use | Rename the goal role to **Owner** | Mooncamp (vendor): an "OKR Champion" runs the programme |
| L120 vs L130: Phase 4 "must not run" without the pack vs "an incomplete pack on time beats a complete pack late" | Inconsistent, stricter | A checklist with a warning | Atlassian (vendor) lists pre-reads, "If available" |
| L120: "the single most common failure point" | Contradicted | Remove the claim | WorkBoard (vendor): "setting and forgetting" |
| L36, principle 7: nothing carries over by default | Contested | Carrying forward is a decision recorded at the close. Unfinished aspirational OKRs carry forward by default | Google playbook |
| L552, §7.6: calibration once, for external change only | Contested. "Not for difficulty" is supported | Section 3.5: add, update and stop at any time, with a reason. No count limit. Keep the original target on record | whatmatters, Doerr |
| L734: the structure cannot be changed | Contradicted as an absolute | Section 3.7 | Castro |

### 5.2 Scoring, confidence, progress and health (§3, §8.3)

Supported:
- the 0.0 to 1.0 scales;
- linear progress from baseline to target;
- the 100% ceiling as a setting;
- "maintain" key results;
- health derived, with closed, outdated, latest status and pending;
- "silence is never green";
- the objective score as a weighted average;
- unscored key results left out;
- the cycle score as a plain average.

| Line: what METHOD says | Verdict | Change | Key source |
|---|---|---|---|
| L33, principle 4: "around 0.6 to 0.7 confidence at drafting" | Contradicted, and inconsistent with §3.2 (0.40 to 0.75) | About 0.5, or five in ten, for aspirational key results. High for committed ones | Wodtke: "a difficult number you have a 50% confidence in achieving". Google's 0.6 to 0.7 is an expected *score*, not a confidence |
| L178 to L180: confidence bands 0.7 and 0.4, each with a required action | Unsupported as confidence cuts | Trigger on a *drop* from the drafted confidence. Keep the bands as settings | Wodtke: "has that moved up or down? Have a discussion about why" |
| L180, L182: blocker within 24 hours; same-day escalation at 0.3 | Unsupported. Inconsistent with L191 | Remove the same-day escalation or make it opt-in, triggered by a drop | |
| L196: "No partial credit for effort" | Contested | Keep "no credit for activity alone". Allow a person to adjust the computed score with a reason | Doerr: "unbiased scores should be looked at subjectively, in case there are extenuating circumstances" |
| L200 to L203: score bands 0.9 / 0.7 / 0.4 | 0.7 to 0.9 as "intended" excludes Google's sweet spot | One "on target" range, 0.6 to below 0.9, used everywhere | re:Work: "The sweet spot for OKRs is somewhere in the 60-70% range" |
| L209: 1.0 means "The target was too safe" | Contradicted for committed | No note on committed key results. Flag a *pattern* of 1.0s on aspirational ones | Google playbook. Klau: "if someone **consistently** gets 1.0" (emphasis added) |
| L211: below 0.3 means "Disconnected from capacity" | Unsupported cause. Inconsistent with L203 | Neutral wording that points to the root-cause step | |
| L219 to L222: portfolio verdicts | 0.85 unsupported. "Outran capacity" inconsistent with principle 10 | Average aspirational key results only. Cut-points as settings | |
| L230: status words on track / caution / off track | "Caution" is used by none of the tools checked | Rename to "at risk" | Atlassian, Tability, Viva Goals (vendor) |
| L172: goal progress includes aligned child goals | Contested | A setting, off by default | Perdoo (vendor): "By default, an Objective's progress is based on its Key Results only" |
| L237: linear-fit trend forecast | Idea supported, method unsupported | Require a minimum number of points. Skip binary key results. Label it a projection | |
| L241: progress signal at 75% and 50%, blind to time | Contradicted by tool practice | Compare progress with expected progress for the date | Viva Goals (vendor): "expected progress % based on the Start date and End date" |
| L598: weights cited as "§3.2" | Inconsistent | They are in §3.1 | |

### 5.3 Writing quality checks (§4.1, §4.2, §4.6)

Supported: OBJ-3 (timebound). OBJ-5's warning above three objectives per unit. The two to five range in KR-1. A target, a date and an owner on every key result. The coaching question "what changes if this succeeds?".

| Line: what METHOD says | Verdict | Change | Key source |
|---|---|---|---|
| L11, L30: an objective has "No numbers in it" | Stricter as a definition | "Usually qualitative". Keep OBJ-2 as a warning. Exempt years and product names | whatmatters' example objective "Run a 10K in under 50 minutes by June" |
| L12: a key result is "from X to Y by date" | Stricter | "Usually from X to Y". Add key result types: metric, milestone, binary, baseline | Lamorte names "metric, baseline, and milestone" key results. re:Work: "Sometimes key results are either 0 or 1" |
| L259, OBJ-1: an objective starting with an output verb **fails** | Contradicted as a fail | A warning. Escalate only when its key results are also all outputs | Doerr: objectives are "action oriented". His own example: "Build a planning model for their company" |
| L262: bare metric movement fails | Stricter | A warning | Google's "Low Value Objectives" trap |
| L276: "to" is a why marker | Defect | Remove "to" | Section 3.4 |
| L273 to L275, L324, L325: word lists | Unsupported | Hints only. Never fail | METHOD L286 |
| L293 to L295: 4 to 18 words | Unsupported | Remove, or keep only as a soft warning labelled a product heuristic | |
| L299: a named reviewer is required | Unsupported | Optional workspace setting | |
| L301: **fail** above 5 company objectives | Stricter | A warning | Doerr: guidance, not a rule |
| L305: **fail** above 5 key results | Stricter | A warning | Perdoo (vendor), "10 OKR dogmas" |
| L307, KR-2: fail with no numbers | Contradicted for binary and milestone key results | Judge "can it be graded objectively", not digit count | Grove: "Did I do that or did I not do it? Yes/no." |
| L309, KR-3: a baseline is required | Stricter | Baseline as a warning. Not applicable to milestone key results | Doerr's examples ("99% uptime") carry no baseline |
| L309 vs KR-2: "establishing a baseline can be the first key result" | Inconsistent. That key result fails KR-2 and KR-3, so gate 2 blocks it | Add a baseline key result type exempt from KR-2 and KR-3 | |
| L311, KR-4: fail if any key result is untagged leading or lagging | Contested. Mandatory tagging unsupported | Tagging optional. The mix as a coaching warning | whatmatters: "often a mix". Perdoo (vendor): "Key Results are always lag measures" |
| L313 to L319, KR-5: activity fails | Contested. The fail is stricter | A warning. Exempt key results tagged leading | Google re:Work samples include "Launch xx feature to all users" |
| L319 vs L317, L260 vs KR-5 | Inconsistent. "Keep the activity as a tagged leading indicator", then fail it anyway. "Keep the deliverables in your key results", then punish deliverable key results | One stance. Recommended: deliverables go to initiatives, and tagged leading key results are allowed | |
| L251: the strength score | Unsupported | Keep, labelled a product heuristic | |
| §4.6 row 3: strong key result "Raise activation…" is untagged | Inconsistent. It fails KR-4 as printed | Tag it | |

### 5.4 Alignment, dependencies, capacity and publish gates (§4.3 to §4.5, §5)

Supported: AL-4, the company anchor, as a warning. Declared dependencies (AL-5) as a check. A capacity conversation. A written not-doing list as strategy practice. Semantic review as advice. Booking the cadence.

| Line: what METHOD says | Verdict | Change | Key source |
|---|---|---|---|
| L333, AL-1, gate 3: fail when a goal has no parent and no stated contribution | Stricter | A warning. Add a "standalone, with a reason" option | Perdoo (vendor): "Alignment is not mandatory, but best practice." whatmatters: a team that inherits no objective is not unimportant |
| L337, AL-3: no level skip | **Contradicted** | Remove the check, the penalty and the coaching line at L716 | whatmatters: "A team can ladder to any other team's priority in the organization – vertically, horizontally, even diagonally" |
| L335, AL-2: exactly one parent | Contested | Keep as a product simplification, not canon | whatmatters: "A good cascade looks more like a network, not an org chart" |
| L38, principle 9: a team does not restate its parent | Contested | Allow a parent key result to become the child's objective, which is the classic pattern. Flag only a verbatim copy | whatmatters: "while the Objective is top-down, the metrics of success – the KRs – are bottom-up" |
| L343, AL-6: no horizontal dependency means a possible silo | Unsupported | Remove from the score. At most a low-severity prompt | Finance, legal and platform teams are often legitimately self-contained |
| §5.2: penalty-based alignment score | Unsupported, does not scale | Ratios: share aligned, share of dependencies confirmed | Profit.co (vendor): under 10% orphaned is healthy |
| L341, AL-5, gate 4: unconfirmed dependency with a risk owner | Check supported. Block stricter. The risk-owner route is invented | A warning. Escalate to the sponsor | Google playbook: "escalation is good" |
| L428, gate 5: nothing at "exceeds" | Contradicted for aspirational | Committed OKRs only | Google playbook |
| L428, L695: "nothing cut" means capacity was not checked | Unsupported as a test | A coaching question | |
| CY-3: 3 to 10 issues vs L79 "at least 3" | Inconsistent | Guidance. Drop the cap | |
| CY-4: 3 to 5 priorities with 12-month statements | Stricter, and L80 makes it annual-only while §4.4 does not | Mark it annual-only, as a warning | |
| §4.5: six hard gates, "always hard" (L780) vs overridable (L369) | Stricter and inconsistent | Block only structural defects (no key results, no target, no owner). The rest warn. Enforcement as a workspace setting | Section 3.1 |
| Gate 6: publication date before day one | Unsupported | Remove. Keep the countdown reminder at L754 | |
| L137: department as a standard level | Contested | Workspaces define their own levels | Castro: "only two levels: company and team". Cagan: focus on team objectives |

### 5.5 KPIs and recovery OKRs (§6)

Supported:
- the KPI and OKR distinction;
- "an unhealthy KPI **can** trigger a recovery OKR", as an option a person chooses;
- leading and lagging;
- a driver tree in shape;
- the recovery board;
- calculated KPIs;
- proposing to close a recovery when the KPI is healthy again.

| Line: what METHOD says | Verdict | Change | Key source |
|---|---|---|---|
| L456: health is the ratio of current to target | Contradicted for bounded, near-ceiling and negative KPIs | Green and red boundaries in the KPI's own units, with target types: stay above, stay below, increase to, decrease to, stay within a range. Keep the ratio only as the fallback for simple positive KPIs | Castro: "as long as the dials on the dashboard are within certain thresholds, you don't care about them". Perdoo (vendor) target types |
| L460 to L466: 90 and 70 | Unsupported numbers | Per-KPI settings. The schema already stores `healthy_pct` and `watch_pct` per KPI, so L466 understates it | |
| L462: unhealthy means "Launch a recovery OKR" | Stricter | A choice: fix it now, add a key result to an existing objective, or launch a recovery OKR | Wodtke: on a Code Red "you prioritize fixing it … over OKR efforts" |
| L466, L479: "recovering" overrides the band and shows a projection | Unsupported, and hides bad news | Always show the real band, with recovery progress beside it | METHOD L721 |
| L472: objective "Bring KPI back to target" | Inconsistent with OBJ-1, OBJ-2 and L708 | A qualitative, number-free objective. The KPI itself becomes the first key result | whatmatters: the KPI goes in the key result, under "Win the Indy 500" |
| L473: drafted key results from leading drivers | Inconsistent. Drafts a key result going the wrong way, and inherits a null owner | Skip drivers already at target. Require an owner. Size targets to the gap | |
| L474: placeholder "define the first leading driver to move" | Inconsistent. Fails KR-2 | "KPI from current to healthy" | |
| L477 vs L725: proposal after 2 periods vs on the first drop | Inconsistent | Delay as a setting. Fire at once on a severe drop | Statistical process control rules |
| L444: tiers input, output, outcome, impact | Contested. Mixes two vocabularies | Optional, or drop in favour of leading and lagging plus tree position | |
| L446: aggregates sum, average, max, min, count | Stricter | Add last value and first value. Model rates as calculated KPIs | Summing monthly recurring revenue into a quarter triples it |
| L450: every child "drives" its parent | Stricter | Record the link type: formula or influence | Mixpanel (vendor) |

### 5.6 Rhythm and reviews (§7, §8)

Supported:
- weekly sessions of 15 to 30 minutes;
- confidence every week;
- the digest;
- anchor day Monday;
- planning lead times;
- review preparation two weeks before the end;
- a monthly review;
- "we learned that…";
- keep, modify, abandon;
- recognition.

| Line: what METHOD says | Verdict | Change | Key source |
|---|---|---|---|
| L34, principle 5: OKRs reviewed only at quarter end "are worse than no OKRs" | Stricter | Doerr's framing: "Without frequent status updates, goals slide into irrelevance" | |
| L742: weekly only | Contested | Weekly default. Every-two-weeks is a valid setting, and the streak and ladders follow it | Lamorte: "The sweet spot is bi-weekly check-ins" |
| L507: the champion "confirms the **score**" | Inconsistent with "never mixed" (L147) | "Confirms the confidence" | |
| L509 vs L179: medium "moves on with no discussion" vs medium must "name what changes" | Inconsistent | Discuss any key result whose confidence fell | Wodtke: "Why is confidence dropping?" |
| L509 to L517: every low score gets a blocker and a 24-hour action "without exception" | Stricter | One next action before the next check-in. A blocker only when one exists | |
| L519: 2 to 3 commitments; "no negotiation and no explanation" | Stricter, unsupported | Three to four per team (Wodtke). Drop "no explanation" | Wodtke: "the 3-4 most important things you must get done this week" |
| L523 to L533: blocker taxonomy and 24-hour clock | Unsupported as canon | Keep the list as a default. Add "approach not working" and "other". Clock per type, or "by the next check-in" | |
| L746, L749: sponsor escalation at 14 days and 48 hours | Unsupported | Stop at the coordinator. The sponsor gets a digest | |
| §8.1: 60 minutes, 11 stages | Stricter, unrealistic | 90 to 120 minutes, or a review session plus a retro session. Stage minutes are not canon | Mooncamp (vendor): retro "45 to 90 minutes". Workpath (vendor): review and retro are separate |
| L604, L771: every key result below 0.7 needs a cause | Contradicted for aspirational | Below 0.6 for aspirational, below 1.0 for committed | Google playbook |
| L604: "exactly one" of eight causes | Stricter | Add "other". Allow a secondary cause | |
| §8.6: rhythm diagnostic at 0.7 and 3.5 | Unsupported. Inconsistent with §3.4, where 0.65 is "healthy" | Compute rhythm from recorded on-time check-ins and blocker age. Align to 0.6. Present it as a hypothesis | |
| L619 to L627: five process-health statements; the lowest "becomes next cycle's process OKR" | Unsupported. Inconsistent with L671 ("process priority") | The lowest becomes an improvement action with an owner and a date | |
| L641 to L646: four management-retro questions | Unsupported | Guidance | |
| L654 vs L674: "Keep" carries forward, but carried work re-enters as an issue | Inconsistent | A kept objective pre-fills the next draft and still passes the gates | |
| §2.4 L99 to L105 vs L499, L680: drafting two weeks before a review held "at cycle close" | Inconsistent | Grade about two weeks before the end, then diagnose, then draft | Wodtke: "Two weeks before the end of the quarter, it's time to grade your OKRs, and plan for the next cycle" |
| L579: stage 10 "Learnings and next drafts" vs L680 "never in the same session" | Inconsistent | Rename the stage | |
| §8.8: three close decisions | Supported. Incomplete | Add "Defer" and "Achieved" | Lamorte: "keep, modify, abandon, or defer" |

### 5.7 Principles, the coach and the registry (§1, §9, §10, §11)

**The ten principles.** The core is mainstream. Several are stated more absolutely than any source supports.

| Line: principle | Verdict | Change | Key source |
|---|---|---|---|
| L30, P1: "If the objective contains a number, it is a key result in disguise" | Overstated | Soften to match OBJ-2's warning | Doerr: objectives are "concrete, action oriented" |
| L30, P1: "If a key result has no baseline and target, it is an opinion" | Contested | "If a key result cannot be verified, it is an opinion" | Doerr: "You either meet a Key Result's requirements or you don't" |
| L31, P2: impact, not effort | Supported as a strong preference | Keep. Doerr's and Google's own milestone key results show it is not a law | Castro: OKRs "measure impact instead of tasks" |
| L32, P3: focus; a not-doing list must be written | Focus supported. Mandatory list unsupported | Recommend the list, do not gate on it | Grove: "if we try to focus on everything, we focus on nothing" |
| L33, P4: 0.6 to 0.7 confidence at drafting | Contested. Confuses score with confidence | Section 3.2 | |
| L34, P5: quarter-end review "worse than no OKRs" | Overstated | Drop the claim. Keep weekly as the default | re:Work: "some teams find that they are best revisited a few times a quarter" |
| L35, P6: scores never appraisal | Supported ("never" is slightly strong) | Keep | re:Work: "OKRs are not synonymous with performance evaluation" |
| L36, P7: nothing carries over, blank sheet | Contested, contradicted for aspirational OKRs | Every objective gets a deliberate close decision | Google playbook |
| L37, P8: neglect must be visible | Supported | Keep | |
| L38, P9: contribution, not copying | Supported | Keep. AL-3 works against it | Perdoo (vendor): "The better approach is directional alignment" |
| L39, P10: rhythm problem vs strategy problem need "opposite fixes" | Unsupported | Label it an OpenOKR heuristic and feed it measured cadence | |

**The definitions.** Mostly sound. Two need widening:

| Definition | Problem | Change |
|---|---|---|
| L12: a key result is "from X to Y" | Excludes milestone and binary key results, and METHOD's own "maintain" band (L169) | A key result has a target that can be verified: a value, a band, or done or not done |
| "Goal" | Used as a synonym for objective throughout (L37, L113, L172, L402) and never defined. A key result "owner" is required (L309, L473) but is not a role in §2.5 | Add both to the terms table |

**§10, what the coach watches for.** There are exactly twenty situations. Sixteen map cleanly to rules. Four do not:

| Situation | Problem |
|---|---|
| L715: "Goal with no parent … This OKR is an island" | AL-1 (L333) passes a parentless goal that states a contribution |
| L718: "Two goals double-counting a metric … One of them is not real" | Rests on the AI semantic review, which contradicts "The coach never guesses" (L728). Two goals contributing to one metric is normal |
| L723: "Reported health disagrees with the data … in four weeks" | No rule anywhere in METHOD, and "four weeks" is not in the §11 registry |
| L725: "KPI drops out of its corridor" | §6.5 (L477) waits two periods |

**Common mistakes the literature names that the coach never watches for:**

| Mistake | Source |
|---|---|
| Not telling committed OKRs from aspirational ones | Google playbook, Trap #1 |
| Business-as-usual objectives | Google playbook, Trap #2 |
| Low-value objectives "no one will notice or care" about | Google playbook, Trap #5 |
| Key results that are "necessary but not sufficient" for the objective | Google playbook, Trap #6 |
| Top-down only, no team input | re:Work: "a mix of top-down and bottom-up". Mooncamp, Tability (vendor) |
| OKRs for everything; KPIs confused with OKRs | Mooncamp (vendor). Perdoo (vendor), dogma 10 |
| Never abandoning an OKR that has stopped mattering | re:Work: "abandon objectives that are clearly not going to happen" |
| OKRs not visible to everyone | re:Work: "OKRs are public" |
| Rolling out to the whole company without a pilot | Wodtke: "start with a pilot program" |
| Too many key results per team | Castro: "no team should have more than 10 KRs" |

**§9 claims with no source:**
- the input pack as "the single most common failure point" (L691);
- "missing baselines are second" (L694);
- "silent overload" (L695);
- "scores near 1.0 indicate sandbagging" (L697), which Google contradicts for committed OKRs.

**§11, the registry.** Practitioners and tools treat OKRs as something each organisation adapts:

| Source | What it says or allows |
|---|---|
| Google's own playbook | Ends its introduction by saying other organisations' approach may and should differ from Google's |
| Wodtke | Recommends starting with a pilot and with a single company OKR. METHOD allows one to five |
| Castro | Uses two levels, company and team, even in organisations of over a thousand people |
| Lamorte | Lists "Ten Universal Deployment Parameters" to decide before deploying |
| Perdoo (vendor) | Lets an admin switch stretch goals on or off and set the update frequency per goal |
| Viva Goals (vendor) | "lets you create and configure your own OKR rules to fit your business needs" |

METHOD locks exactly the parts these sources vary:
- whether committed OKRs exist;
- the number of levels;
- the key result forms;
- the reviewer role;
- the leading or lagging tag;
- the review agenda;
- the input pack.

L734's "practising a different method" is a product decision, not something the sources support.

---

## 6. Where METHOD.md contradicts itself

| # | One side | Other side | Suggested fix |
|---|---|---|---|
| 1 | L33: 0.6 to 0.7 confidence at drafting | L190: sweet spot 0.40 to 0.75. L179: 0.6 to 0.7 is "Medium", which demands action | About 0.5 for aspirational |
| 2 | L201: 0.7 to 0.9 is "the intended level" | L210: 0.6 and above is intended. L220: 0.60 is healthy | One range, 0.6 to below 0.9 |
| 3 | L200: 0.9 and above, "check ambition" | L210: 0.95 is "on the intended level" | Same |
| 4 | L697, L726: scores "near 1.0" mean sandbagging | L770: "clustering above 0.85". L209: a single 1.0 | One pattern rule |
| 5 | L222: below 0.40, "Targets outran capacity" | L39, principle 10: a miss can be strategy or cadence | Neutral wording |
| 6 | L191 to L192: drafting at 0.25 to 0.40 is "Ambitious", allowed | L182, L517: 0.3 and below escalates the same day | Trigger on a drop |
| 7 | L604, L771: below 0.7 needs a cause | L210: 0.6 and above is intended | 0.6 |
| 8 | §8.6: cycle score below 0.7 is a "problem" | §3.4 L220: 0.60 to 0.85 is "Healthy" | 0.6 |
| 9 | L598: weights "§3.2 uses for progress" | Weights are in §3.1, L172 | Fix the reference |
| 10 | L147: the three numbers "are never mixed" | L172: "Equal baseline and target **scores** 0". L507: champion "confirms the **score**" | Reword both |
| 11 | L120: Phase 4 "must not run" without the pack | L130, L691: on time beats complete | A checklist |
| 12 | L81: Phase 4 complete when every check passes | L780: strictness is "Warn" | Complete when drafts exist |
| 13 | L369: gate 2 can be overridden | L780: gates "always hard". L734: not configurable | Enforcement as a setting |
| 14 | L49, L52: annual frame never rewritten | L80: "holds or documented change" | Revisable with a reason |
| 15 | §2.4 L103: score the prior cycle three weeks before the quarter | L84, L755: the prior quarter still has three weeks to run | Grade two weeks before the end |
| 16 | §2.4: draft at T−2 weeks | L499, L680: review "at cycle close", before drafting | Same |
| 17 | L579: stage 10 "Learnings and next drafts" | L680: "never in the same session" | Rename |
| 18 | L509: medium "moves on with no discussion" | L179: medium must "name what changes this week" | Discuss drops |
| 19 | L319: keep activity as a tagged leading indicator | L317: the same key result fails | One stance |
| 20 | L260: "Keep the deliverables in your key results" | KR-5, §9 L694: deliverable key results are the main defect | One stance |
| 21 | L309: establish the baseline as the first key result | KR-2, KR-3: that key result fails, and gate 2 blocks it | Baseline type |
| 22 | §4.6 row 3: the strong key result | KR-4: it is untagged, so it fails | Tag it |
| 23 | L472: recovery objective "Bring KPI back to target" | OBJ-1, OBJ-2, L708: metrics belong in key results | Qualitative objective |
| 24 | L479: projected "recovering" health | L233, L721: silence is never green, cannot quietly stay green | Show the real band |
| 25 | L477: proposal after 2 periods | L725: the coach fires when the KPI drops | Severe drop fires at once |
| 26 | L654: Keep means carry forward | L674: carried work re-enters as an issue | Keep pre-fills the draft |
| 27 | L627: lowest statement becomes a "process OKR" | L671: a "process priority" | An improvement action |
| 28 | L333 to L335: AL-2 allows "neither", AL-1 passes with a stated contribution | §5.2 L402: every parentless goal costs 12 | Count stated contributions as aligned |
| 29 | L14, L113: "Champion" owns a goal | L5: "OKR Champion" is an agent | Rename the role to Owner |
| 30 | CY-3: 3 to 10 issues | L79: at least 3 | One rule |
| 31 | L56: "Every cycle runs the same eight phases" | The next sentence: Phase 0 runs only in an annual cycle | Quarterly cycles run seven |
| 32 | L12: a key result is "from X to Y" | L169, L329: the "maintain" direction is a band | Section 5.7 |
| 33 | L36: "Every cycle starts with a blank sheet" | L49 to L52: the annual frame persists. L664 to L674: carried items feed forward automatically | Reword |
| 34 | L73: phase completion "is not self-reported" | L631: the rhythm score is two survey answers, while the streak (L537) is measured | Use measured check-in adherence |
| 35 | L81: Phase 4 needs every "§4 check" to pass | The §4 checks include CY-8, booking the cadence, which is a Phase 6 item | "No fails in the objective, key result and alignment checks" |
| 36 | §2.4 L92 to L97: Q1 drafting in week 2 | Annual OKRs are published in weeks 1 to 0, yet quarterly OKRs sit "inside the annual frame" (L52) | Sequence them |
| 37 | L228: a goal closes as achieved or missed | L652 to L656: close decisions are keep, modify, abandon. No "achieved" decision, and abandoned has no health state | Reconcile |
| 38 | L159: the 200% ceiling "§6.4 already applies" | §6.4 states no ceiling | Fix the reference |
| 39 | L477: a recovery OKR launches mid-cycle with one click | L69 (phases before the cycle), L367 (gate 6), OBJ-4 (no champion), AL-1 (no parent) | Define a mid-cycle path for every OKR, not only recovery |
| 40 | L736: nothing numeric is hardcoded outside the registry | Unregistered: AL-1's "fewer than three words" (L333), the 0.5 warn weight (L251), the trend "recent window" (L237, no value at all), "Once per cycle" (L552), "four weeks" (L723) | Register them, or drop them |
| 41 | L734: the structure "cannot be changed" | L791 and L780: workspaces may add word-list terms and set strictness, which change how checks judge | Say what is fixed |
| 42 | L736: the §2.4 timelines are guidance, not machine thresholds | L753 registers the same numbers as parameters | One status |
| 43 | CY-5, L714: the not-doing list is checked every cycle | L80: quarterly Phase 3 does not require it | Annual only |
| 44 | L545, L610, L656: priority shifts are logged monthly, a root cause and an abandon reason | L552: no mid-cycle change is allowed for a priority shift | Section 3.5 |
| 45 | L558: "three acts" | L570: the table has a fourth, "Open" | Say four |
| 46 | L182, L517: escalate to "management" | No such role in §2.5 | Name it |
| 47 | L715: "This OKR is an island" | L333: AL-1 passes a goal with a stated contribution | Same as 28 |
| 48 | L718: "One of them is not real", from the semantic review | L728: "The coach never guesses at the situation" | Advisory wording |
| 49 | L723: "has not moved in four weeks" | No rule, and not in the registry | Write the rule, or drop the situation |

---

## 7. What METHOD.md is missing

| Practice | Why it matters | Source |
|---|---|---|
| Committed and aspirational OKRs | Section 3.2 | Google playbook |
| Continue, update, start, stop mid-cycle | Section 3.5 | Doerr |
| Key result types: metric, milestone or binary, baseline | Real OKRs use them. METHOD fails them | Lamorte. re:Work. Perdoo (vendor) |
| Expected progress for the date | A time-blind signal is red for half of every cycle | Viva Goals (vendor) |
| Self-assessment beside the computed score | Doerr allows judgement for extenuating circumstances | whatmatters |
| A postmortem for a missed committed OKR, "not intended to punish teams" | The committed half of Google's model | Google playbook |
| Bottom-up OKRs as normal, about half of them | Laddering is how alignment works in practice | Doerr ("roughly half"). Castro ("60%") |
| Shared OKRs and co-owners across teams | An alternative to one-way dependency links | Google playbook. Lamorte |
| Escalation as the remedy for an unconfirmable dependency | Replaces the invented "risk owner" route | Google playbook |
| Every-two-weeks check-ins | A common, sourced cadence | Lamorte. Perdoo (vendor) |
| Weekly wins and celebration | Half of Wodtke's weekly rhythm | Wodtke, "Friday wins" |
| Defer as a close decision | Not everything is keep or abandon | Lamorte |
| KPI target types and per-KPI thresholds | Section 3.6 | Castro. Perdoo, Intrafocus (vendor) |
| A lighter first cycle | Lamorte limits scope "when getting started" | Lamorte |
| Paired or counter-metric key results | Stops gaming of a single number | Grove, via whatmatters |
| Sources | METHOD.md cites no external source anywhere | |

---

## 8. A proposed order of change

Every stage changes METHOD.md, so every stage starts with a decision from section 9. Each stage then needs four things:

- a design note in `docs/design/`;
- tasks in IMPLEMENTATION-PLAN.md;
- the conformance suite ([`scripts/method-check.ts`](../scripts/method-check.ts)) updated in the same change;
- any mockup that shows a changed band or rule redrawn.

| Stage | What changes | Mainly touches |
|---|---|---|
| **1. Unblock** | Anyone with access can create an objective or key result at any time; phase status becomes coaching. Publish gates block only structural defects; everything else warns. The reviewer becomes optional. Remove "to" from the why markers. The recovery draft stops writing key results that go the wrong way. Remove the "recovering" projection | [`workflow.ts`](../packages/method/src/workflow.ts), [`goals.ts`](../packages/core/src/actions/goals.ts), [`quality.ts`](../packages/method/src/quality.ts), [`word-lists.ts`](../packages/method/src/word-lists.ts), [`kpi-recovery.ts`](../packages/method/src/kpi-recovery.ts), [`kpi.ts`](../packages/method/src/kpi.ts) |
| **2. The model** | Committed and aspirational OKRs. Key result types. Continue, update, start, stop with a reason. Re-cut the score and confidence bands around Google's 0.6 to 0.7 and Wodtke's 0.5. Expected progress for the date | [`scoring.ts`](../packages/method/src/scoring.ts), [`thresholds.ts`](../packages/method/src/thresholds.ts), [`quality.ts`](../packages/method/src/quality.ts), the goals schema and actions |
| **3. Alignment and KPIs** | Remove AL-3. An alignment score built on ratios. Standalone OKRs with a reason. KPI target types and per-KPI thresholds. Last-value and first-value aggregates | [`alignment.ts`](../packages/method/src/alignment.ts), [`kpi.ts`](../packages/method/src/kpi.ts), [`kpi-aggregate.ts`](../packages/method/src/kpi-aggregate.ts) |
| **4. Rhythm** | Calmer escalation ladders. Every-two-weeks as an option. A realistic quarterly review, or a review and a retro. Fix the §2.4 timeline. Rhythm diagnostic from recorded data | [`escalation.ts`](../packages/method/src/escalation.ts), [`sessions.ts`](../packages/method/src/sessions.ts), [`triggers.ts`](../packages/method/src/triggers.ts), [`streak.ts`](../packages/method/src/streak.ts) |
| **5. The document** | Rewrite METHOD.md so that every rule names its source, and every number is labelled either "sourced" or "OpenOKR default". Replace §11's "cannot be changed" with a short list of what is fixed and what a workspace may tune | METHOD.md, the conformance suite |

Stage 1 is what you asked for on 1 October: "at any time anyone can add objective, or key result".

---

## 9. Decisions for a person

Each of these changes METHOD.md, so each needs a yes or no from Akmal and Agung.

| # | Decision | Recommendation |
|---|---|---|
| 1 | Remove the drafting lock, so anyone with access can create an objective or key result at any time? | Yes. You asked for this. No source supports the lock |
| 2 | Which publish gates stay hard? | Only structural ones: no key results, no target, no owner. Everything else warns. Enforcement becomes a workspace setting |
| 3 | When an OKR is added mid-cycle, does it go live at once or wait for its reviewer? Does it need a reason? | Live at once, visibly marked as added mid-cycle. Reason optional when adding, required when lowering a target |
| 4 | Adopt committed and aspirational OKRs? | Yes. It fixes about a dozen rules (section 3.2) |
| 5 | Add key result types: metric, milestone or binary, baseline? | Yes |
| 6 | Keep the per-goal reviewer role? | Make it an optional workspace setting |
| 7 | Rename the "Champion" role to "Owner"? | Yes. The OKR Champion agent keeps its name |
| 8 | May any word-list check still hard-fail? | No. Every word-list check becomes advisory |
| 9 | Should escalation still reach the sponsor? | Not by default. The sponsor gets a weekly digest |
| 10 | Quarterly review length and shape? | 90 to 120 minutes, or a review session plus a retro session |
| 11 | What in §11 stays fixed and non-configurable? | The core: outcomes over activity, few objectives, one owner, derived health, scores out of pay. Every number becomes a labelled default |
| 12 | Agung's proposal ([`docs/design/okr-entry-points.md`](design/okr-entry-points.md)) recommends "keep every gate, and move the door". This review recommends removing the drafting gate. Which wins? | Settle it with Agung before stage 1. The two cannot both be built |

---

## 10. Limits of this review

- **Some sources could not be read directly.**
  - felipecastro.com now redirects to its home page. Castro was read through his newsletter (read.felipecastro.com), his slides, and an interview hosted by a vendor.
  - The fetch tool sometimes refused web.archive.org.
  - Niven and Lamorte's books are not online. Lamorte is quoted from reader highlights, from his own posts on okrs.com, and from interviews on vendor sites.
  - Rick Klau is quoted from his own blog repost, because the Google Ventures library did not resolve.
- **Some quotes come from search snippets** rather than a fetched page. Where they are relied on above, they are marked as such in the topic reviews, and none carries a recommendation on its own.
- **Absence of evidence.** "Unsupported" means nothing was found after a targeted search. It does not prove nobody has ever recommended the rule.
- **Vendor practice is not canon.** It is used to show what is common, not what is right.
- **The topic reviews were done by research agents.** I checked their most important quotes and their measurements myself:
  - the Google playbook and whatmatters quotes;
  - the quality checker results in section 3.4, which I re-ran.

  The rest is as they reported it.

---

## 11. Sources

**Primary**

| Source | URL |
|---|---|
| Google OKR playbook, hosted by Doerr | https://www.whatmatters.com/resources/google-okr-playbook |
| Google re:Work, Set goals with OKRs | https://rework.withgoogle.com/en/guides/set-goals-with-okrs |
| whatmatters, changing OKRs | https://www.whatmatters.com/faqs/changing-okrs |
| whatmatters, the process for changing OKRs | https://www.whatmatters.com/okrs-explained/changing-okrs-process |
| whatmatters, creating new OKRs | https://www.whatmatters.com/faqs/creating-new-okrs-changing-and-cascading-together |
| whatmatters, a typical OKR cycle | https://www.whatmatters.com/resources/a-typical-okr-cycle |
| whatmatters, how to grade OKRs | https://www.whatmatters.com/faqs/how-to-grade-okrs |
| whatmatters, what is a key result | https://www.whatmatters.com/okrs-explained/what-is-a-key-result |
| whatmatters, OKR meaning and examples | https://www.whatmatters.com/faqs/okr-meaning-definition-example |
| whatmatters, how many OKRs | https://www.whatmatters.com/faqs/how-many-okrs-to-have |
| whatmatters, leading and lagging key results | https://www.whatmatters.com/okrs-explained/leading-lagging-key-results |
| whatmatters, alignment | https://www.whatmatters.com/series_entries/s3-5-okr-alignment/ |
| whatmatters, bottom-up OKRs | https://www.whatmatters.com/okrs-explained/bottom-up-okrs-laddering |
| whatmatters, OKR ownership | https://www.whatmatters.com/faqs/dear-andy-how-to-assign-okr-ownership |
| whatmatters, how many cycles | https://www.whatmatters.com/faqs/dear-andy-how-many-okr-cycles-is-too-many |
| whatmatters, KPIs and OKRs | https://www.whatmatters.com/resources/difference-between-okr-kpi |
| whatmatters, converting KPIs to OKRs | https://www.whatmatters.com/faqs/dear-andy-converting-kpis-to-okrs |
| whatmatters, weekly check-ins | https://www.whatmatters.com/faqs/weekly-okr-grading-check-in |
| Christina Wodtke, The Art of the OKR | https://eleganthack.com/the-art-of-the-okr/ |
| Christina Wodtke, Monday commitments and Friday wins | https://cwodtke.com/monday-commitments-and-friday-wins |
| Christina Wodtke, Tracking and evaluating OKRs | https://cwodtke.com/tracking-and-evaluating-okrs/ |
| Christina Wodtke, on health metrics and Code Red | https://eleganthack.com/what-sam-altman-just-taught-us-about-okrs-without-meaning-to/ |
| Felipe Castro, OKR vs KPIs | https://read.felipecastro.com/p/okr-vs-kpis |
| Felipe Castro, review of Measure What Matters | https://read.felipecastro.com/p/measure-what-matters |
| Felipe Castro, interview (vendor-hosted) | https://blog.weekdone.com/setting-okrs-like-pro-felipe-castro/ |
| Marty Cagan, team objectives | https://www.svpg.com/team-objectives-overview/ |
| Rick Klau, How Google sets goals | https://tins.rklau.com/2013/05/how-google-sets-goals-okrs/ |
| Ben Lamorte, scoring OKRs | https://okrs.com/2026/02/how-to-score-okrs/ |
| Jos Visser, Seven habits for effective OKR management | https://josvisser.substack.com/p/seven-habits-for-effective-okr-management |

**Vendor**

| Source | URL |
|---|---|
| Perdoo, 10 OKR dogmas you should ignore | https://www.perdoo.com/resources/blog/10-okr-dogmas-you-should-ignore |
| Perdoo, draft OKRs | https://support.perdoo.com/en/articles/2754249-draft-okrs |
| Perdoo, goal statuses | https://support.perdoo.com/en/articles/4640875-goal-statuses |
| Perdoo, aligning OKRs | https://support.perdoo.com/en/articles/5391069-aligning-okrs |
| Perdoo, KPI target types | https://support.perdoo.com/en/articles/2298599-add-kpis-for-a-team |
| Microsoft Viva Goals, progress and status | https://learn.microsoft.com/en-us/viva/goals/track-okr-progress-status |
| Microsoft Viva Goals, approval workflows | https://learn.microsoft.com/en-us/viva/goals/approval-workflows |
| Atlassian, OKRs play | https://www.atlassian.com/team-playbook/plays/okrs |
| Tability, cascading vs aligning | https://www.tability.io/okrs/cascading-vs-aligning-okrs |
| Tability, OKR meetings | https://www.tability.io/odt/articles/okr-meetings |
| Mooncamp, OKR retrospective | https://mooncamp.com/blog/okr-retrospective |
| Workpath, review and retro | https://workpath.com/magazine/review-retro |
| WorkBoard, what goes wrong with OKRs | https://workboard.com/blog/okrs-what-goes-wrong.php |
| Profit.co, Lamorte's answers | https://www.profit.co/blog/okr-university/14-toughest-questions-on-okrs-answers-by-ben-lamorte-series-2/ |
| Mixpanel, metric trees | https://mixpanel.com/blog/metric-tree/ |
| Intrafocus, performance thresholds | https://www.intrafocus.com/blog/what-are-performance-thresholds/ |
