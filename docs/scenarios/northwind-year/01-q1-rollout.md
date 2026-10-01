# 1. Q1 2027: the rollout

1 January to 31 March 2027. Week 1 starts on Monday 4 January. The first cycle the whole company runs in OpenOKR, and it makes the mistakes first cycles make:
- too many objectives;
- key results that are task lists;
- an objective with no parent;
- a status reported green that the data does not support.

The product coaches through all four and refuses none of them. Doerr warns that an organisation "may need up to four or five quarterly cycles to fully embrace the system". Q1 is the first.

---

## The plan

### Company OKRs for Q1

Drafted 7 to 22 December and published 23 December. Each quarterly company objective takes the quarter's slice of an annual one.

| # | Objective | Kind | Champion · reviewer | Aligns to | Key results (baseline → Q1 target), owner |
|---|---|---|---|---|---|
| C1 | New accounts reach value in their first week | Aspirational | Priya · Elena | A1 | C1.1 Median time to first value 9 → 6 days (reduce, lagging), Sara. C1.2 30-day activation 51% → 58% (lagging), Sara. C1.3 Guided setup completed by 63% → 75% of new accounts (leading), Sara |
| C2 | Support stops growing with the customer count | Committed | Tomás · Elena | A2 | C2.1 Support tickets per account 2.9 → 2.4 a month (reduce, leading), Kofi. C2.2 Support cost per account $128 → $115 a month (reduce, lagging), Hugo |
| C3 | Be ready for the SOC 2 audit | Committed | Mei · Elena | A3 | C3.1 SOC 2 controls implemented 60% → 100% (leading), Leo. C3.2 Audit observation window started by 1 March (milestone), Mei. C3.3 Uptime held at or above 99.9% every month (maintain), Leo |

### Department and team OKRs for Q1

Drafted 4 to 13 January and shared on 15 January, inside the two-week team publication window.

| # | Objective | Level · space | Kind | Champion · reviewer | Aligns to | Key results (baseline → target), owner |
|---|---|---|---|---|---|---|
| P1 | Onboarding runs without us in the room | Team · Product | Aspirational | Sara · Priya | C1 | P1.1 Manual setup calls per new account 1.2 → 0.6 (reduce, lagging), Sara. P1.2 Establish an onboarding NPS baseline (baseline), Amara. P1.3 Bulk import available to every new account by 15 February (milestone), Mei |
| P2 | Prove the onboarding change with cohort evidence | Team · Product | Aspirational | Amara · Priya | C1 | P2.1 Weekly cohort report published 0 → 12 of 13 weeks (leading), Amara |
| E1 | Take the twelve repeated questions out of the product | Department · Engineering | Aspirational | Mei · Priya | C2.1 (a key result) | E1.1 In-product answers shipped 5 → 12 (leading), Mei. E1.2 p95 setup API latency 610 → 400 ms (reduce, leading), Leo |
| E2 | Keep the platform standing | Team · Engineering | Committed | Leo · Mei | C3 | E2.1 Uptime held at or above 99.9% every month (maintain), Leo. E2.2 Mean time to restore 90 → 45 minutes (reduce), Leo |
| E3 | New accounts bring their data in one step | Team · Engineering | Committed | Mei · Priya | P1 | E3.1 Bulk import generally available by 15 February (milestone), Mei |
| S1 | Sell to accounts that can onboard themselves | Department · Sales | Aspirational | Daniel · Elena | C1 | S1.1 New deals inside the target profile 68% → 80% (leading), Jonas. S1.2 Days from signature to kickoff 7 → 4 (reduce, lagging), Jonas |
| S2 | Fill the pipeline with accounts that fit | Team · Sales | Aspirational | Jonas · Daniel | S1 | S2.1 Call-to-meeting conversion 8% → 12% (leading), Jonas. S2.2 Qualified mid-market pipeline $2.1M → $3.0M (lagging), Ben |
| CS1 | No customer is surprised by their own renewal | Department · Customer Success | Aspirational | Tomás · Elena | A2 (annual) | CS1.1 Accounts over $10k with a health reading under 30 days old 81% → 100% (leading), Tomás. CS1.2 Renewals flagged 90 days out 55% → 90% (lagging), Tomás |
| SU1 | Answer once, in the product | Team · Support | Aspirational | Kofi · Tomás | C2.1 | SU1.1 Self-serve deflection 17% → 25% (leading), Kofi. SU1.2 Tickets answered with a help-centre link 30% → 50% (leading), Kofi |
| M1 | Bring in accounts that fit | Department · Marketing | Aspirational | Nadia · Elena | S1 (diagonal) | M1.1 Marketing-qualified leads inside the target profile 40% → 60% (leading), Nadia. M1.2 Target-profile trials started 120 → 180 a month, Nadia |
| F1 | Close the books in five days | Department · Finance | Committed | Hugo · Elena | Stands alone (reason given) | F1.1 Month-end close 9 → 5 working days (reduce), Hugo |

Of the eleven team and department objectives, six were proposed by the teams themselves (P2, E3, S2, SU1, M1, F1). That is close to the "roughly half bottom-up" Doerr describes. Aligned or standing alone with a reason: 11 of 11.

---

## Planning Q1

**NW-Q1-01 · 4 Dec 2026 · Champion, Priya · S-04 `/cycle` · METHOD v2 §2.4, §11 planning-open lead · Today**
Planning for Q1 opens four weeks before the quarter. The Champion tells the sponsor and facilitator. Phase 1 is a light refresh of the annual pack.
*Test:* Given Q1 starting 1 January and a planning-open lead of four weeks, when the Champion runs on 4 December, then Elena and Priya each receive one planning-open message citing its rule.

**NW-Q1-02 · 7 Dec 2026 · Priya, leadership · S-05 `/cycle?phase=2` · METHOD v2 §2.3 phase 2 · Today**
Phase 2: diagnose. The prior cycle is the pilot, already scored at 0.55. Baseline health is recorded from the KPI grid. Four strategic issues are ranked:
- onboarding speed (impact 5);
- support cost (5);
- audit readiness (4);
- deal fit (3).

*Test:* Given the pilot scored, baseline health recorded and four issues ranked, when Phase 2 is evaluated, then it is complete.

**NW-Q1-03 · 9 Dec 2026 · Leadership · S-06 `/cycle?phase=3` · METHOD v2 §2.3 phase 3 · Today**
Phase 3: the annual frame is revalidated in 40 minutes. It holds. The focus areas for the quarter are the first week, support load and audit readiness.
*Test:* Given a quarterly cycle, when the revalidation is recorded as "holds" with focus areas chosen, then Phase 3 is complete without priorities or a not-doing list, which are annual-only (CY-4, CY-5).

**NW-Q1-04 · 10 to 22 Dec 2026 · Leadership · S-09 drafting · METHOD v2 §2.8, §3.2 · P9-T11**
The three company objectives above are drafted.
- **C2 and C3 are committed.** Their drafted confidence averages 7.5 in 10, and the coach says nothing: high confidence is right for a commitment.
- **C1 is aspirational.** It is drafted at 5 in 10 to 6 in 10, the sweet spot.

*Test:* Given C1 aspirational with key results at 0.5, 0.6 and 0.6, when the draft set is judged, then it reads "the sweet spot", and C2 at 0.75 raises no near-certain warning, because it is committed.

**NW-Q1-05 · 14 Dec 2026 · Amara · S-14 goal detail · METHOD v2 §2.10 · P9-T12**
Nobody measures onboarding NPS (NW-P-13). Amara writes P1.2, "Establish an onboarding NPS baseline", as a baseline key result. It passes KR-2. Under the old rules it failed KR-2 and KR-3, and gate 2 blocked the set.
*Test:* Given a key result of the baseline kind with no numbers, when it is checked, then KR-2 and KR-3 pass, and the set can be published.

**NW-Q1-06 · 23 Dec 2026 · Elena · S-10 publish · METHOD v2 §4.5, §5.5 · P9-T03**
The company set publishes. On gate 5, Engineering marks E1.1, the in-product answers, as "exceeds", and the facilitator asks what was cut. Mei records "the knowledge-base rewrite". E1 is aspirational, so "exceeds" warns and does not block. C3's audit work is committed, and it "fits".
*Test:* Given an aspirational key result at "exceeds" and a committed one at "fits", when the set is published, then gate 5 shows a warning naming the aspirational key result and publishing succeeds.

## Teams draft, in the list and on the diagram

**NW-Q1-07 · 4 Jan · Sara · S-13 OKRs list · design okr-writing §4.3 · P9-T07b**
Sara opens OKRs, picks the Product team, and clicks "+ Add objective". She types "Onboarding runs without us in the room" and presses Enter. A draft key result row is already waiting under it. She types P1.1, presses Tab to the target, types 0.6, then Tab to the owner. Each row saves on Enter. Nothing was written before her first Enter.
*Test:* Given an empty Product team in Q1, when Sara adds P1 and three key results from the list using only the keyboard, then all four exist after a reload, and the audit log shows no record before her first commit.

**NW-Q1-08 · 5 Jan · Jonas · S-13 OKRs list · METHOD v2 §4.2 KR-5, §4.6 · P9-T03**
Jonas drafts the Sales team's objective with "Make 300 cold calls" and "Hold 40 demos". KR-5 warns beside each cell: "This measures activity volume. Ask why…". The strength score shows amber, 52%. Nothing is refused; the draft is saved.
*Test:* Given the key result "Make 300 cold calls", when it is typed, then KR-5 warns with its prompt and the draft saves.

**NW-Q1-09 · 6 Jan · Mei · S-13 OKRs list · METHOD v2 OBJ-5 · P9-T03**
Engineering drafts five objectives. OBJ-5 warns: "a unit with more than 3 objectives". Mei leaves it for the peer review.
*Test:* Given a fourth and a fifth objective in the Engineering space, when they are saved, then OBJ-5 warns on the space, and both save.

**NW-Q1-10 · 7 Jan · Nadia · OKRs diagram · METHOD v2 AL-1, §5.1 · P9-T10**
Nadia drafts M1 with no parent. AL-1 warns: "which priority does this move forward?" She switches to the diagram and drags M1's handle onto Sales' S1. The edge moves at once and the save is confirmed. An undo toast shows for six seconds. Marketing aligns diagonally, to another department, which METHOD v2 allows.
*Test:* Given M1 with no parent, when it is dragged onto S1 in the diagram, then M1's parent is S1, AL-1 passes, and the list shows M1 indented under S1.

**NW-Q1-11 · 7 Jan · Hugo · S-14 drawer · METHOD v2 AL-1 · P9-T16**
Finance's "Close the books in five days" supports no 2027 strategy. Hugo marks it as standing alone, with the reason "Finance operating cadence the board relies on". AL-1 passes, and it counts as aligned in the alignment score.
*Test:* Given F1 with no parent and a standalone reason of more than three words, when the alignment score is computed, then F1 counts as aligned.

**NW-Q1-12 · 12 Jan · Facilitator Priya, all teams · S-09 peer review · METHOD v2 §9 phase 4 · Today**
In the peer review, each team reads another team's drafts:
- **Marketing reads Sales.** Nadia asks Jonas what the 300 calls are for. Jonas rewrites S2 as conversion (leading) and qualified pipeline (lagging). KR-5 passes.
- **Product reads Engineering.** Engineering cuts five objectives to three, E1 to E3, and moves the other two to initiatives under E1.

The strength score for the set rises to green, 81%.
*Test:* Given the rewritten S2 key results, when they are checked, then KR-5 passes on both, and OBJ-5 no longer warns on Engineering.

**NW-Q1-13 · 13 Jan · Priya, Mei, Kofi · S-16 diagram, dependency register · METHOD v2 §5.2, §5.4 · Today and P9-T16**
Dependencies are declared and confirmed:
- P1.3 (bulk import) depends on Engineering's E3, and Mei confirms it.
- SU1.1 (deflection) depends on E1's in-product answers, and Mei confirms that too.

Alignment health reads 100%: every goal below company level is aligned or stands alone with a reason. This follows GitLab's rule: "KRs with dependencies should not be considered final until other teams have confirmed support."
*Test:* Given every dependency confirmed and every goal aligned or standing alone, when the alignment score is read, then it is healthy, with no gaps listed.

**NW-Q1-14 · 15 Jan · All teams · OKRs list and diagram · METHOD v2 §2.9 · P9-T02 and P9-T13**
Team OKRs are shared. They were created inside the team publication window, two weeks from the cycle start, so none is marked "added mid-cycle". The diagram shows the whole tree from the Q1 root, with key results stacked under each objective.
*Test:* Given objectives created on 4 to 13 January in a cycle starting 1 January, when the list renders, then none carries the added-mid-cycle mark.

## Running Q1

**NW-Q1-15 · 18 Jan (W3) · All spaces · S-22 weekly session, Slack · METHOD v2 §7.2 · Today**
The first company-wide Monday check-ins take place:
- **Sales.** Jonas checks in from Slack with the one-tap check-in, and his narrative and confidence land on the goal.
- **Product.** The team votes on confidence privately, and the votes reveal together with the average.
- **Acknowledgement.** Department objectives have reviewers, so Elena and the department heads find acknowledgements waiting in their review inbox.

*Test:* Given a check-in posted from Slack, when it publishes, then the goal shows it with its confidence, and the reviewer's inbox lists one acknowledgement owed.

**NW-Q1-16 · 25 to 29 Jan (W4) · Champion, Nadia · S-02 review inbox, email · METHOD v2 §11 ladders · Today**
Marketing misses Monday's check-in.
1. **Monday, at due:** the Champion nudges Nadia.
2. **Tuesday:** it nudges her again.
3. **Wednesday:** Nadia checks in, inside the three-day grace.

M1 never reads "outdated". On Friday the Champion's digest goes out to every space.
*Test:* Given a weekly goal due Monday and checked in Wednesday, when health is read on Thursday, then it is not outdated, and Nadia received exactly two nudges.

**NW-Q1-17 · 1 Feb (W5) · Tomás, Kofi · S-20 KPI grid, S-19 recovery board · METHOD v2 §6.5, §2.9 · P9-T17, P9-T18, P9-T13**
A January release broke the export button, and tickets per account rose from 2.9 to 3.3. The KPI crosses its red boundary of 2.8 and turns unhealthy. OpenOKR offers three responses:
- fix it now;
- add a key result;
- launch a recovery OKR.

Tomás adds a key result to C2: "C2.3 Reopened tickets from the January release 18% → 5%". It is marked "added mid-cycle". Because the reason when adding mid-cycle is optional, he writes one anyway: "January release regression".
*Test:* Given tickets per account at 3.3 with a red boundary of 2.8, when the reading is recorded, then the KPI is unhealthy, the three responses are offered, and a key result added on 1 February is marked added mid-cycle.

**NW-Q1-18 · 1 Feb · Priya, leadership · S-23 monthly review · METHOD v2 §7.5 · Today and P9-T13**
At the first monthly review, the trends are recorded: C1 is flat, C2 is declining, and C3 is improving. The decision log records C2.3's addition against C2. Continue for everything else.
*Test:* Given a monthly review, when a decision is recorded, then it names the key result it affects, and the review lists the mid-cycle addition.

**NW-Q1-19 · 8 Feb (W6) · Sara · S-15 check-in, S-22 · METHOD v2 §3.2, §7.3 · P9-T19**
Bulk import, E3, slips two weeks. Sara's confidence on C1.3, guided setup, drops from 7 to 3.
- **The coordinator hears.** The drop crosses into the low band, so Sara, as the Product coordinator, is told, along with Priya.
- **The next action.** It is due by the next check-in: "Mei confirms the new date on Thursday".
- **The blocker.** Type Dependency, owner Mei.

Nobody is escalated to the sponsor. That is off by default.
*Test:* Given confidence falling from 0.7 to 0.3, when the check-in publishes, then the coordinator is told the same day, the blocker's next action is due by the next check-in, and no sponsor escalation is recorded.

**NW-Q1-20 · 12 to 15 Feb (W6 to W7) · Mei · S-14 drawer · METHOD v2 §2.10 · P9-T12**
Bulk import ships on 12 February. Mei ticks E3.1 done. The milestone goes to 100%, and so does P1.3, which tracks the same delivery from Product's side. The blocker closes. Sara's confidence returns to 6.
*Test:* Given a milestone key result, when its owner marks it done, then its progress is 100%, and the blocker that named it can be closed.

**NW-Q1-21 · 22 Feb (W8) · Coach, Nadia · S-02 inbox · METHOD v2 §3.5, §10 · P9-T15**
For four weeks, Marketing has reported M1 as on track, while M1.1 (target-profile share of leads) has not moved from 44%. The coach notices: "Reported on track, but this key result has not moved within the divergence window." Nadia changes her status to "at risk" and writes why: the target profile changed in January and her lead scoring has not caught up.
*Test:* Given a goal reported on track for four weekly check-ins while a metric key result is unchanged, when the coach runs, then one divergence message is sent, citing its rule.

**NW-Q1-22 · 26 Feb (W8) · Mei · S-14 drawer · METHOD v2 §2.10 · P9-T12**
The auditor is engaged and the observation window starts on 26 February. C3.2, the milestone, is done three days early.
*Test:* Given a milestone due 1 March, when it is marked done on 26 February, then it reads 100% and its pace signal is green.

**NW-Q1-23 · 1 Mar (W9) · Priya, leadership · S-23 monthly review · METHOD v2 §3.6, §3.7 · P9-T15**
Two signals agree that activation is falling behind:
- **The pace-aware signal** shows C1.2 (activation) amber: 54% at week 9 is 14 points behind the progress expected by now. Under the old absolute rule every key result read red until halfway through, so a signal at week 9 meant nothing.
- **The trend forecast** projects 56%, short of the 58% target, and flags "trending off track".

The decision: one engineer moves to the activation checklist for four weeks.
*Test:* Given a key result at 43% progress in week 9 of 13, when the signal is computed with pace gaps of 10 and 25, then it is amber, not red.

**NW-Q1-24 · 3 Mar (W9) · Hugo · S-13 list, target cell · METHOD v2 §2.9, §7.6 · P9-T06**
Support cost per account (C2.2) is at $121 against a target of $115. Hugo edits the target to $120 in the list. A reason field opens, and saving without one is refused: "Lowering a target needs a written reason." He writes "it got hard", then deletes it. The cost overrun is Northwind's own regression, not a change in the outside world. He restores $115 and escalates instead (NW-Q1-25). As GitLab puts it, "Iteration does not mean changing or lowering goal posts."
*Test:* Given a target of 115 on a reduce key result, when it is changed to 120 without a reason, then the change is refused with that sentence, and no target change is recorded.

**NW-Q1-25 · 8 Mar (W10) · Tomás, Elena · S-15, S-02 · METHOD v2 §3.2 committed rule, §2.8 · P9-T11**
C2.1 (tickets per account) sits at 2.7 with confidence 4 in 10. It is committed, and below the committed confidence floor of 0.7. The coach says: "A commitment nobody believes in is a risk. Escalate now, or make it aspirational." Tomás escalates to Elena. She approves two support agents spending three weeks on the reopened-ticket backlog. The decision is recorded against C2.1, and confidence recovers to 6.
*Test:* Given a committed key result at confidence 0.4, when the check-in publishes, then the coach's committed-floor message is sent to the champion, citing its rule, and an aspirational key result at 0.4 receives no such message.

## Closing Q1

**NW-Q1-26 · 15 to 17 Mar (W11) · All champions · S-24 scoring · METHOD v2 §3.3 · P9-T14**
Grading runs two weeks before the quarter ends, and each score is computed from progress.
- **One adjustment.** Sara's C1.2 (activation) computes 0.57. The March cohort's last three days are not yet in the warehouse, and the partial cohort reads 56%. She adjusts the score to 0.6 with that reason, and both numbers are kept.

*Test:* Given a computed score of 0.57, when it is adjusted to 0.6 with a reason, then the closed cycle shows 0.6, and the scorecard keeps 0.57 as the computed value beside it.

**NW-Q1-27 · 18 Mar · Priya facilitates; 14 people · S-24 quarterly review, 90 minutes · METHOD v2 §8 · P9-T20**
The Q1 review:
- **Room pulse:** 3.6, "steady, not euphoric".
- **The scoring reveal:**

| Group | Result |
|---|---|
| Aspirational key results | 19 scored, average **0.69**, a healthy portfolio |
| Committed key results | 10, of which **6 were met**: C3's three, E2.1, E3.1, F1.1 |
| Committed misses, each with its explanation | C2.1 tickets 2.55 (0.7), C2.2 cost $118 (0.77), C2.3 reopened tickets 6% (0.92), E2.2 time to restore 50 minutes (0.89) |

The review runs 40 minutes over. That is the reason for the setting change in NW-Q2-24.
*Test:* Given the Q1 scores, when the reveal completes, then the aspirational average and the committed share met are reported separately, and each committed miss has an explanation before the stage can close.

**NW-Q1-28 · 18 Mar · Room · S-24 root cause · METHOD v2 §8.4 · P9-T20**
Root causes are asked of every aspirational key result below 0.6 and every committed key result below 1.0:

| Key result | Cause | Note |
|---|---|---|
| C2.1, C2.2, C2.3 | Other | "The January release regression" |
| E2.2 | Capacity or resourcing | On-call coverage, secondary cause |
| M1.1 | Wrong key result | Lead scoring depends on a profile Sales owns |
| S2.1 | Ambition set too high | |

C1.2 at 0.6 is not asked for a cause.
*Test:* Given an aspirational key result at 0.6 and a committed one at 0.92, when the root-cause stage opens, then only the committed one is listed.

**NW-Q1-29 · 18 Mar · Room, then Priya and Elena · S-24 process health, S-36 · METHOD v2 §8.5, §11 · P9-T20**
Process health is scored anonymously. The lowest statement is 4, "We had few enough OKRs that focus was possible", at 2.6. It becomes an improvement action owned by Priya, due 5 April: two objectives per team in Q2. On 2 April Elena sets the "Objectives per unit cap" threshold from 3 to 2. The change is audited, and Q1's closed snapshot is untouched.
*Test:* Given the threshold changed after Q1 closed, when Q1's verdicts are read, then they use the snapshot taken at close, and Q2 drafting warns at a third objective per unit.

**NW-Q1-30 · 18 Mar · Room · S-24 diagnostic · METHOD v2 §8.6 · P9-T20**
The cycle score is 0.69, at or above 0.6, so the diagnosis is "Results delivered". The question becomes ambition, not effort. The measured rhythm, the share of check-ins published on time, is 81% because of Marketing's misses. It is shown beside process-health statements 2 and 5 as a cross-check.
*Test:* Given a cycle score of 0.69, when the diagnostic is read, then it says results delivered regardless of the rhythm score.

**NW-Q1-31 · 18 Mar · Room · S-24 close decisions, feed-forward · METHOD v2 §8.8, §8.9 · P9-T20**
Every objective gets a close decision:

| Decision | Objectives |
|---|---|
| Achieved | C3, E3, F1 |
| Keep | C1, P1, P2, E1, S1, CS1, SU1 |
| Modify | C2 (re-sliced for Q2), M1 (measure lead quality directly), S2 |
| Keep (committed, continuing) | E2 |

Learnings carried forward include "We learned that a release regression shows in tickets within ten days; watch the reopen rate weekly". Kept objectives pre-fill Q2's drafts.
*Test:* Given C1 closed as Keep, when Q2's drafting opens, then C1 appears as a pre-filled draft that still passes Q2's checks before it publishes.

**NW-Q1-32 · 19 Mar · Priya · S-25 minutes · METHOD v2 §8.10 · Today**
The minutes export as a PDF for the board pack:
- the executive summary, with the aspirational average and the committed share met;
- every stage's record.

*Test:* Given the Q1 review closed, when the minutes are exported, then the PDF holds the executive summary and every stage, and the export is recorded in the audit log.

---

Previous: [0. Before the year](00-before-the-year.md). Next: [2. Q2: the competitor](02-q2-competitor.md).
