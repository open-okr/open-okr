# 1. Q1 2027: the rollout

1 January to 31 March 2027. Week 1 starts on Monday 4 January. The first cycle the whole company runs in OpenOKR, and it makes the mistakes first cycles make:
- too many objectives;
- key results that are task lists;
- a duplicated key result;
- a status reported green that the data does not support.

The product coaches through all of them and refuses none. Doerr warns that an organisation "may need up to four or five quarterly cycles to fully embrace the system". Q1 is the first.

Planning follows the staggered calendar in METHOD v2 §2.4 and publishes in two steps (§4.5). The company set publishes on 23 December; the department and team sets publish on 15 January, when the team publication window closes.

---

## The plan

### Company OKRs for Q1

Drafted 16 to 22 December, after the pilot's review, and published 23 December. Each quarterly company objective takes the quarter's slice of an annual one.

| # | Objective | Kind | Champion · reviewer | Aligns to | Key results (baseline → Q1 target), owner |
|---|---|---|---|---|---|
| C1 | New accounts reach value in their first week | Aspirational | Priya · Elena | A1 | C1.1 Median time to first value 9 → 6 days (reduce, lagging), Sara. C1.2 30-day activation 51% → 58% (lagging), Sara. C1.3 Guided setup completed by 63% → 75% of new accounts (leading), Sara |
| C2 | Support stops growing with the customer count | Committed | Tomás · Elena | A2 | C2.1 Support tickets per account 2.9 → 2.4 a month (reduce, leading), Kofi. C2.2 Support cost per account $128 → $115 a month (reduce, lagging), Hugo |
| C3 | Be ready for the SOC 2 audit | Committed | Mei · Elena | A3 | C3.1 SOC 2 controls implemented 60% → 100% (leading), Leo. C3.2 Audit observation window started by 1 March (milestone), Mei. C3.3 Uptime held at or above 99.9% every month (maintain), Leo |

### Department and team OKRs for Q1

Drafted 4 to 14 January and published 15 January. Reviewers sit on department objectives only (NW-P-09).

| # | Objective | Level · space | Kind | Champion · reviewer | Aligns to | Key results (baseline → target), owner |
|---|---|---|---|---|---|---|
| P1 | Onboarding runs without us in the room | Team · Product | Aspirational | Sara · none | C1 | P1.1 Manual setup calls per new account 1.2 → 0.6 (reduce, lagging), Sara. P1.2 Establish an onboarding NPS baseline (baseline), Amara |
| P2 | Prove the onboarding change with cohort evidence | Team · Product | Aspirational | Amara · none | C1 | P2.1 Weekly cohort report published 0 → 12 of 13 weeks (leading), Amara |
| E1 | Take the twelve repeated questions out of the product | Department · Engineering | Aspirational | Mei · Priya | C2.1 (a key result) | E1.1 In-product answers shipped 5 → 12 (leading), Mei. E1.2 p95 setup API latency 610 → 400 ms (reduce, leading), Leo |
| E2 | Keep the platform standing | Team · Engineering | Committed | Leo · none | C3 | E2.1 Uptime held at or above 99.9% every month (maintain), Leo. E2.2 Mean time to restore 90 → 45 minutes (reduce), Leo |
| E3 | New accounts bring their data in one step | Team · Engineering | Committed | Mei · none | P1 (same level) | E3.1 Bulk import generally available by 15 February (milestone), Mei |
| S1 | Sell to accounts that can onboard themselves | Department · Sales | Aspirational | Daniel · Elena | C1 | S1.1 New deals inside the target profile 68% → 80% (leading), Jonas. S1.2 Days from signature to kickoff 7 → 4 (reduce, lagging), Jonas |
| S2 | Fill the pipeline with accounts that fit | Team · Sales | Aspirational | Jonas · none | S1 | S2.1 Call-to-meeting conversion 8% → 12% (leading), Jonas. S2.2 Qualified mid-market pipeline $2.1M → $3.0M (lagging), Ben |
| CS1 | No customer is surprised by their own renewal | Department · Customer Success | Aspirational | Tomás · Elena | A2 (annual) | CS1.1 Accounts over $10k with a health reading under 30 days old 81% → 100% (leading), Tomás. CS1.2 Renewals flagged 90 days out 55% → 90% (lagging), Tomás |
| SU1 | Answer once, in the product | Team · Support | Aspirational | Kofi · none | C2.1 | SU1.1 Self-serve deflection 17% → 25% (leading), Kofi. SU1.2 Tickets answered with a help-centre link 30% → 50% (leading), Kofi |
| M1 | Bring in accounts that fit | Department · Marketing | Aspirational | Nadia · Elena | S1 (diagonal) | M1.1 Marketing-qualified leads inside the target profile 40% → 60% (leading), Nadia. M1.2 Target-profile trials started 120 → 180 a month, Nadia |
| F1 | Close the books in five days | Department · Finance | Committed | Hugo · Elena | Stands alone (reason given) | F1.1 Month-end close 9 → 5 working days (reduce), Hugo |

Of the eleven department and team objectives, six were proposed by the teams themselves: P2, E3, S2, SU1, M1 and F1. That is close to the half Doerr's site calls healthy: "Healthy organizations aim to have half of their goals come from the bottom-up."

---

## Planning Q1

**NW-Q1-01 · 4 Dec 2026 · Champion, Priya · S-04 `/cycle` · METHOD v2 §2.4, §11 planning-open lead · P9-T19a**
Planning for Q1 opens four weeks before the quarter. The release Northwind ran in October opened it three weeks before; 0.2.0 opens it four. The Champion tells the sponsor and the facilitator. Phase 1 is a light refresh of the annual pack.
*Test:* Given Q1 starting 1 January and a quarterly planning-open lead of four weeks, when the Champion runs on 4 December, then Elena and Priya each receive one planning-open message, citing its rule.

**NW-Q1-02 · 15 Dec 2026 · Priya, leadership · S-05 `/cycle?phase=2` · METHOD v2 §2.3 phase 2 · Today**
Phase 2: diagnose. It runs the day after the pilot's review (NW-P-13), so the prior cycle is scored at 0.55. Baseline health is recorded from the KPI grid. Four strategic issues are ranked:
- onboarding speed (impact 5);
- support cost (5);
- audit readiness (4);
- deal fit (3).

*Test:* Given the pilot scored, baseline health recorded and four issues ranked, when Phase 2 is evaluated, then it is complete.

**NW-Q1-03 · 16 Dec 2026 · Leadership · S-06 `/cycle?phase=3` · METHOD v2 §2.3 phase 3 · Today**
Phase 3: the annual frame is revalidated in 40 minutes and holds. The focus areas for the quarter are the first week, support load and audit readiness.
*Test:* Given a quarterly cycle, when the revalidation is recorded as "holds" with focus areas chosen, then Phase 3 is complete without priorities or a not-doing list, which are annual-only (CY-4, CY-5).

**NW-Q1-04 · 16 to 22 Dec 2026 · Leadership · S-09 drafting · METHOD v2 §2.8, §3.2 · P9-T11**
The three company objectives are drafted.
- **C2 and C3 are committed.** Each of their key results is drafted at 7 in 10 or above, and the committed floor raises nothing. High confidence is right for a commitment.
- **C1 is aspirational.** It is drafted at 5 and 6 in 10, the sweet spot.

*Test:* Given C1 aspirational with key results at 0.5, 0.6 and 0.6, when the draft set is judged, then it reads "the sweet spot". Given every committed key result at 0.7 or above, then the committed-floor message is not sent.

**NW-Q1-05 · 23 Dec 2026 · Elena · S-10 publish, first step · METHOD v2 §4.5 · P9-T03**
The company set publishes: the first of the two steps. The gates run over the three company objectives, and gates 1 and 2 are green. The department and team sets will publish in the second step.
*Test:* Given the three company objectives complete, when Elena publishes the company step, then they are live and readable by every member, and the cycle records its team step as still open.

## Teams draft, in the list and on the diagram

**NW-Q1-06 · 4 Jan · Sara · S-13 OKRs list · design okr-writing §4.3 · P9-T07b**
Sara opens OKRs, picks the Product team, and clicks "+ Add objective". She types "Onboarding runs without us in the room" and presses Enter. A draft key result row is already waiting under it. She types P1.1, presses Tab to the target and types 0.6. The row saves on Enter.

She starts a second key result row, changes her mind, and presses Escape: the empty row disappears. Nothing was written before her first Enter.
*Test:* Given an empty Product team in Q1, when Sara adds P1 and one key result from the list with the keyboard, then both exist after a reload. When she presses Escape on an empty draft row, then the row disappears and no record exists. The audit log shows no write before her first commit.

**NW-Q1-07 · 5 Jan · Amara · S-14 drawer · METHOD v2 §2.10 · P9-T12**
Nobody measures onboarding NPS (NW-P-12). Amara adds P1.2 to Sara's objective: "Establish an onboarding NPS baseline", as a baseline key result. It passes KR-2 and KR-3. Under the old rules it failed both, and gate 2 would have blocked the set.
*Test:* Given a key result of the baseline kind with no numbers, when it is checked, then KR-2 and KR-3 pass.

**NW-Q1-08 · 5 Jan · Jonas · S-13 OKRs list · METHOD v2 §4.2 KR-5, §4.6 · P9-T03**
Jonas drafts the Sales team's objective with "Make 300 cold calls" and "Hold 40 demos". KR-5 warns beside each cell: "This measures activity volume. Ask why…". The strength score shows amber, 52%. Nothing is refused; the draft is saved.
*Test:* Given the key result "Make 300 cold calls", when it is typed, then KR-5 warns with its prompt and the draft saves.

**NW-Q1-09 · 6 Jan · Mei · S-13 OKRs list · METHOD v2 §2.7, OBJ-5 · P9-T03**
Engineering drafts five objectives. OBJ-5 warns: "a unit with more than 3 objectives". Mei leaves it for the peer review.
*Test:* Given a fourth and a fifth objective in the Engineering space, when they are saved, then OBJ-5 warns on the space, and both save.

**NW-Q1-10 · 7 Jan · Nadia · OKRs diagram · METHOD v2 AL-1, AL-3, §5.1 · P9-T10, P9-T16**
Nadia drafts M1 with no parent. AL-1 warns: "which priority does this move forward?"
- **The drag.** She switches to the diagram and drags M1's handle onto Sales' S1, another department. The edge moves at once and the save is confirmed, with an undo toast for six seconds.
- **The rule.** METHOD v2 allows alignment at a goal's own level, in any space.
- **No level-skip message.** AL-3 is off by default.

*Test:* Given M1 with no parent, when it is dragged onto S1 in the diagram, then M1's parent is S1, AL-1 passes, and the list shows M1 under S1. Given AL-3 off, then no level-skip message is sent.

**NW-Q1-11 · 7 Jan · Hugo · S-14 drawer · METHOD v2 AL-1 · P9-T16**
Finance's "Close the books in five days" supports no 2027 strategy. Hugo marks it as standing alone, with the reason "Finance operating cadence the board relies on". AL-1 passes, and it counts as aligned in the alignment score.
*Test:* Given F1 with no parent and a standalone reason, when the alignment score is computed, then F1 counts as aligned.

**NW-Q1-12 · 12 Jan · Facilitator Priya, all teams · S-09 drafts read across teams, S-16 findings · METHOD v2 §9 phase 4, §5.3 · Today, P9-T06, P9-T07a**
In the peer review, each team reads another team's drafts:
- **Marketing reads Sales.** Nadia asks Jonas what the 300 calls are for. He rewrites S2 as conversion (leading) and qualified pipeline (lagging), and KR-5 passes.
- **Two edits at once.** While Jonas is rewriting, Daniel edits the same title from his own screen. The second commit is refused with the current value, "Changed by Jonas a moment ago", and Daniel takes Jonas's wording.
- **Engineering cuts five objectives to three.** The other two become initiatives under E1.
- **A duplicate.** The semantic review flags P1's third key result, "Bulk import available to every new account", as the same delivery as Engineering's E3.1. Sara deletes it, with the undo toast, and P1 records a dependency on E3 instead.

The strength score for the set rises to green, 81%.
*Test:* Given two members editing one title, when the second commits after the first, then it is refused with the current value and nothing is overwritten. Given a key result deleted from the list, then it is restorable from deleted items for as long as the workspace keeps them, and the undo toast restores it within six seconds.

**NW-Q1-13 · 13 Jan · Priya, Mei, Kofi · S-16 dependency register, alignment score · METHOD v2 §5.2, §5.4 · Today, P9-T16**
Dependencies are declared and confirmed:
- P1 depends on Engineering's E3, and Mei confirms it.
- SU1.1 (deflection) depends on E1's in-product answers, and Mei confirms that too.

Alignment health reads 100%: every goal below company level is aligned or stands alone with a reason. GitLab's rule is the same: "KRs with dependencies should not be considered final until other teams have confirmed support."
*Test:* Given every dependency confirmed and every goal aligned or standing alone, when the alignment score is read, then it is healthy, with no gaps listed.

**NW-Q1-14 · 15 Jan · Elena · S-10 publish, second step · METHOD v2 §4.5, §5.5, §2.9 · P9-T03, P9-T11, P9-T13**
The department and team sets publish, which is the second step. Gate 5 asks about capacity:
- **E1.1, the in-product answers, is at "exceeds".** The facilitator asks what was cut, and Mei records "the knowledge-base rewrite".
- **E1 is aspirational,** so it may exceed, and gate 5 raises nothing for it. Only a committed OKR at "exceeds" is a warning (METHOD v2 §5.5).
- **The window.** Everything was written inside the team publication window, so nothing is marked as added mid-cycle.

*Test:* Given an aspirational key result at "exceeds", when the team step publishes, then gate 5 raises nothing for it, the cut is recorded, and publishing succeeds. Given a committed key result at "exceeds", then gate 5 warns naming it. Given objectives created on 4 to 14 January in a cycle starting 1 January, then none carries the added-mid-cycle mark.

## Running Q1

**NW-Q1-15 · 18 Jan (W3) · All spaces · S-22 weekly session, Slack, S-02 · METHOD v2 §7.2, §2.5 · Today, P9-T04**
The first company-wide Monday check-ins take place:
- **Sales.** Jonas checks in from Slack with the one-tap check-in, and his narrative and confidence land on the goal.
- **Product.** The team votes on confidence privately, and the votes reveal together with the average.
- **Department objectives.** They have reviewers, so Elena and the department heads find acknowledgements in their review inbox.
- **Team objectives.** They have no reviewer, so their check-ins owe nobody an acknowledgement.

*Test:* Given a check-in posted from Slack on a department objective, when it publishes, then the goal shows it, and the reviewer's inbox lists one acknowledgement owed. Given a team objective with no reviewer, then its check-in creates no acknowledgement.

**NW-Q1-16 · 24 to 27 Jan (W4) · Champion, Nadia · S-02 review inbox, email · METHOD v2 §11 ladders · Today**
Marketing's check-in is due on Monday 25 January. The Champion sends three nudges:
1. **Sunday:** the due-soon reminder, one day ahead.
2. **Monday:** the due nudge.
3. **Tuesday:** a nudge one day overdue.

Nadia checks in on Wednesday, inside the three-day grace. M1 never reads "outdated". On Friday the Champion's digest goes to every space.
*Test:* Given a weekly goal due Monday and checked in on Wednesday, when health is read on Thursday, then it is not outdated, and Nadia received exactly three nudges: due-soon, due and overdue.

**NW-Q1-17 · 1 Feb (W5) · Tomás, Kofi · S-20 KPI grid, S-19 recovery board · METHOD v2 §6.4, §6.5, §2.9 · P9-T17, P9-T18, P9-T13**
A January release broke the export button. Tickets per account rose from 2.9 to 3.3, crossing the red boundary of 3.2, so the KPI turns unhealthy. OpenOKR offers three responses:
- fix it now;
- add a key result;
- launch a recovery OKR.

Tomás adds a key result to C2: "C2.3 Reopened tickets from the January release 18% → 5%". It is marked "added mid-cycle". The reason when adding is optional, and he writes one anyway: "January release regression".
*Test:* Given tickets per account at 3.3 with a red boundary of 3.2, when the reading is recorded, then the KPI is unhealthy and the three responses are offered. A key result added on 1 February, after the window, is marked added mid-cycle.

**NW-Q1-18 · 1 Feb · Priya, leadership · S-23 monthly review · METHOD v2 §7.5 · Today, P9-T13**
At the first monthly review, the trends are recorded: C1 flat, C2 declining, C3 improving. The decision log records C2.3's addition against C2. Everything else continues.
*Test:* Given a monthly review, when a decision is recorded, then it names the key result it affects. The review lists the mid-cycle addition beside it.

**NW-Q1-19 · 8 Feb (W6) · Sara, Priya · S-15 check-in, S-22 · METHOD v2 §3.2, §7.3 · P9-T19a**
Bulk import (E3) slips two weeks. Sara's confidence on C1.3, guided setup, drops from 7 to 3.
- **The coordinator is told.** C1 is a company objective, so Priya, the company space's coordinator, is told the same day.
- **The next action.** It is due by the next check-in: "Mei confirms the new date on Thursday".
- **The blocker.** Type Dependency, owner Mei.
- **No sponsor escalation.** Critical escalation is off by default, so Elena is not told.

*Test:* Given confidence falling from 0.7 to 0.3 with critical escalation off, when the check-in publishes, then the company space's coordinator is told, the blocker's next action is due by the next check-in, and no sponsor escalation is recorded.

**NW-Q1-20 · 12 to 15 Feb (W6 to W7) · Mei, Sara · S-14 drawer · METHOD v2 §2.10, §5.4 · P9-T12**
Bulk import ships on 12 February. Mei ticks E3.1 done, and the milestone reads 100%. P1's dependency on E3 is now satisfied. The blocker closes, and Sara's confidence on C1.3 returns to 6.
*Test:* Given a milestone key result, when its owner marks it done, then its progress is 100%. The blocker that named it can be closed, with the dependency shown as delivered.

**NW-Q1-21 · 22 Feb (W8) · Coach, Nadia · S-02 inbox · METHOD v2 §3.5, §10 · P9-T15**
For four weeks Marketing has reported M1 as on track, while M1.1 (target-profile share of leads) has not moved from 44%. The coach notices: "Reported on track, but this key result has not moved within the divergence window." Nadia changes her status to "at risk" and writes why: the target profile changed in January, and her lead scoring has not caught up.
*Test:* Given a goal reported on track for four weekly check-ins while a metric key result is unchanged, when the coach runs, then one divergence message is sent, citing its rule.

**NW-Q1-22 · 26 Feb (W8) · Mei · S-14 drawer · METHOD v2 §2.10, §3.7 · P9-T12, P9-T15**
The auditor is engaged and the observation window starts on 26 February. C3.2, the milestone, is done three days early.
*Test:* Given a milestone due 1 March, when it is marked done on 26 February, then it reads 100% and its pace signal is green.

**NW-Q1-23 · 1 Mar (W9) · Priya, leadership · S-23 monthly review · METHOD v2 §3.6, §3.7 · P9-T15**
Two signals agree that activation is falling behind:
- **The pace-aware signal.** C1.2 is at 54%, which is 43% of the way from 51 to 58. On 1 March, 66% of the quarter has passed, so it is 23 points behind and reads amber. Under the old absolute rule, every key result read red until halfway through, so red in week 9 said nothing.
- **The trend forecast.** It projects 56%, short of 58%, and flags "trending off track".

Elena also learns at this review that C1.3 had dropped to 3 in 10 three weeks earlier (NW-Q1-19), which is the reason for NW-Q2-02. The decision: one engineer moves to the activation checklist for four weeks.
*Test:* Given a key result at 43% progress on 1 March in a quarter starting 1 January, when the signal is computed with pace gaps of 10 and 25, then it reads amber.

**NW-Q1-24 · 3 Mar (W9) · Hugo · S-13 list, target cell · METHOD v2 §2.9, §7.6 · P9-T06, P9-T07a**
Support cost per account (C2.2, a reduce key result) is at $121 against a target of $115.
1. Hugo edits the target to $120 in the list. That eases it toward the baseline, so a reason field opens.
2. Saving without a reason is refused: "Easing a target needs a written reason."
3. He writes "it got hard", then deletes it. The overrun is Northwind's own regression, not a change in the outside world.
4. He restores $115 and escalates instead (NW-Q1-25).

As GitLab puts it, "Iteration does not mean changing or lowering goal posts."
*Test:* Given a target of 115 on a reduce key result, when it is changed to 120 without a reason, then the change is refused with that sentence, and no target change is recorded. Given a change to 110, then it saves with no reason.

**NW-Q1-25 · 8 Mar (W10) · Tomás, Elena · S-15, S-02 · METHOD v2 §3.2, §2.8 · P9-T11**
C2.1 (tickets per account) sits at 2.7 with confidence 4 in 10. It is committed, and below the committed confidence floor of 0.7. The coach says: "A commitment nobody believes in is a risk. Escalate now, or make it aspirational."

Tomás escalates to Elena. She approves two support agents spending three weeks on the reopened-ticket backlog, and the decision is recorded against C2.1. Confidence recovers to 6 in 10.
*Test:* Given a committed key result at confidence 0.4, when the check-in publishes, then the coach's committed-floor message goes to the champion, citing its rule. An aspirational key result at 0.4 receives no such message.

## Closing Q1

**NW-Q1-26 · 15 to 17 Mar (W11) · All champions · S-24 scoring, scorecard · METHOD v2 §3.3 · P9-T14**
Grading runs two weeks before the quarter ends, and each score is computed from progress.
- **One adjustment.** C1.2 reads 55%, which computes to 0.57. The last three days of March's cohort are missing from the warehouse; with them, activation reads 56%. Sara adjusts the score to 0.71 with that reason.
- **Both numbers are kept.** The scorecard shows 0.71, with 0.57 computed beside it. On 22 March the full cohort arrives, and she records 56% as C1.2's last value.

*Test:* Given a computed score of 0.57, when it is adjusted to 0.71 with a reason, then the closed cycle shows 0.71 and the scorecard shows 0.57 beside it as computed.

**NW-Q1-27 · 18 Mar · Priya facilitates; 14 people · S-24 quarterly review, 90 minutes, one session · METHOD v2 §8 · P9-T20**
- **Room pulse:** 3.6, "steady, not euphoric".
- **The scoring reveal:**

| Group | Result |
|---|---|
| Aspirational key results | 18 scored, average **0.68**, a healthy portfolio |
| Committed key results | **6 of 10 met**: C3.1, C3.2, C3.3, E2.1, E3.1, F1.1 |
| Committed misses | C2.1 tickets 2.55 (0.7). C2.2 cost $118 (0.77). C2.3 reopened tickets 6% (0.92). E2.2 time to restore 50 minutes (0.89) |

The scoring stage cannot close until each committed miss has its explanation. The review runs 40 minutes over, which is the reason for NW-Q2-18.
*Test:* Given the Q1 scores, when the reveal completes, then the aspirational average and the committed share met are reported separately. The scoring stage cannot close while a committed miss has no explanation.

**NW-Q1-28 · 18 Mar · Room · S-24 root cause · METHOD v2 §8.4 · P9-T20**
Root causes are asked of every aspirational key result below 0.6 and every committed key result below 1.0:

| Key results | Cause |
|---|---|
| C2.1, C2.2, C2.3 | Other: "the January release regression" |
| E2.2 | Capacity or resourcing, with on-call coverage as its secondary cause |
| M1.1, M1.2 | Wrong key result: lead scoring depends on a profile Sales owns |
| S2.1, S2.2 | Ambition set too high |
| CS1.2 | Capacity or resourcing |

C1.2, adjusted to 0.71, is not asked for a cause.
*Test:* Given an aspirational key result at 0.71 and a committed one at 0.92, when the root-cause stage opens, then only the committed one is listed.

**NW-Q1-29 · 18 Mar, and 2 Apr · Room, then Elena · S-24 process health, S-36 · METHOD v2 §8.5, §11, §12 snapshot · P9-T20, P9-T14**
Process health is scored anonymously.
- **The lowest statement:** 4, "We had few enough OKRs that focus was possible", at 2.6.
- **The improvement action:** owned by Priya, due 5 April: two objectives per team in Q2.
- **The setting change.** On 2 April Elena sets the "Objectives per unit cap" threshold from 3 to 2. The change is audited.
- **Q1 stays as it was.** Q1 closed with every threshold in its snapshot, so its OKR-count warnings stay as they were.

*Test:* Given the cap changed after Q1 closed, when Q1's verdicts are read, then they use the snapshot's cap of 3. Q2 drafting warns at a third objective per unit.

**NW-Q1-30 · 18 Mar · Room · S-24 diagnostic · METHOD v2 §8.6 · P9-T20**
The cycle score is 0.68, at or above 0.6, so the diagnosis is "Results delivered". The question becomes ambition, not effort. The measured rhythm is 81% because of Marketing's late check-ins. It is shown beside process-health statements 2 and 5 as a cross-check.
*Test:* Given a cycle score of 0.68, when the diagnostic is read, then it says results delivered regardless of the rhythm score.

**NW-Q1-31 · 18 Mar · Room · S-24 close decisions, feed-forward · METHOD v2 §8.8, §8.9 · P9-T20**
Every objective gets a close decision:

| Decision | Objectives |
|---|---|
| Achieved | C3, E3, F1 |
| Keep | C1, P1, P2, E1, E2, S1, CS1, SU1 |
| Modify | C2 (re-sliced for Q2), M1 (measure lead quality directly), S2 |

Learnings carried forward include "We learned that a release regression shows in tickets within ten days; watch the reopen rate weekly". Kept and modified objectives pre-fill Q2's drafts, each key result starting from its last recorded value.
*Test:* Given C1 closed as Keep, when Q2's drafting opens, then C1 appears as a pre-filled draft whose C1.2 baseline is 56, its last recorded value, and it still passes Q2's checks before it publishes.

**NW-Q1-32 · 19 Mar · Priya · S-25 minutes · METHOD v2 §8.10 · P9-T20**
The minutes export as a PDF for the board pack:
- the executive summary, with the aspirational average and the committed share met reported separately;
- every stage's record.

*Test:* Given the Q1 review closed, when the minutes are exported, then the PDF's summary holds the aspirational average and the committed share met as two figures, and every stage's record.

---

Previous: [0. Before the year](00-before-the-year.md). Next: [2. Q2: the competitor](02-q2-competitor.md).
