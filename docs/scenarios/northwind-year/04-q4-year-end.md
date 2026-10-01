# 4. Q4 2027: renewals and the year-end

1 October to 31 December 2027. Week 1 starts on Monday 4 October. Renewal season meets year-end. The margin recovery finishes, expansion comes back, and an outage tests a commitment. The year is reviewed before 2028 is drafted, and 2028 is planned on the evidence of the four cycles before it.

KPIs are recorded monthly, a few days after each month ends. Grading in December uses November's readings; December's arrive in January.

---

## The plan

### Company OKRs for Q4

Drafted 17 to 24 September, after Q3's retrospective, and published 27 September. There are five, the company cap.

| # | Objective | Kind | Champion · reviewer | Aligns to | Key results (baseline → Q4 target), owner |
|---|---|---|---|---|---|
| C1 | New accounts reach value in their first week (kept) | Aspirational | Priya · Elena | A1 | C1.1 Median time to first value 4.4 → 3.5 days (reduce), Sara. C1.2 30-day activation 63% → 68%, Sara |
| C5 | Mid-market buyers choose us over Brightline (kept) | Aspirational | Daniel · Elena | A4 | C5.1 Win rate against Brightline 43% → 50%, Daniel |
| C6 | Margins we can run the business on again (recovery, kept) | Committed | Hugo · Elena | A2 | C6.1 Operating margin 10.4% → 13.5%, Hugo. C6.2 Average renewal discount 7% → 6% (reduce), Daniel |
| C7 | No customer is surprised by their own renewal (raised from CS1, achieved in Q3, to company level for renewal season) | Committed | Tomás · Elena | A2 | C7.1 Renewals flagged 90 days out 95% → 100%, Tomás. C7.2 Gross revenue retention held at or above 92% every month (maintain), Tomás |
| C8 | Expansion comes from accounts that reached value (returned from CS2, deferred in Q2) | Aspirational | Tomás · Priya | A2 | C8.1 Expansion seats added 158 → 200 a month, Tomás. C8.2 Net revenue retention 101% → 104%, Hugo |

### Department and team OKRs for Q4

Published 14 October.

| # | Objective | Space | Kind | Aligns to | Key results (baseline → target), owner |
|---|---|---|---|---|---|
| P4 | The first session shows value without a call (kept) | Product | Aspirational | C1 | P4.1 Setup completed in the first session 55% → 65%, Sara |
| G1 | Trials turn into customers without a sales call (kept) | Growth | Aspirational | C1 | G1.2 Self-serve trial-to-paid conversion 5.2% → 7%, Yuki |
| E1 | Take the repeated questions out of the product (modified) | Engineering | Aspirational | C7 | E1.1 Renewal and billing questions answered in the product 2 → 8, Leo, then Mei |
| E2 | Keep the platform standing (kept) | Engineering | Committed | A3 | E2.1 Uptime held at or above 99.9% every month (maintain), Leo. E2.2 Mean time to restore 38 → 35 minutes (reduce), Leo |
| CS3 | Support costs less per account, run from Customer Success (modified from C2) | Customer Success | Committed | A2 | CS3.1 Support cost per account $101 → $95 (reduce), Hugo. CS3.2 Self-serve deflection 31% → 35%, Kofi |
| S3 | Win the late-stage deals against Brightline (kept) | Sales | Aspirational | C5 | S3.1 Late-stage win rate against Brightline 46% → 55%, Jonas |
| F4 | Plan 2028 on numbers the board trusts | Finance | Committed | Stands alone: "Annual planning cadence" | F4.1 Board-approved 2028 plan by 9 December (milestone), Hugo |

---

## The quarter, in date order

**NW-Q4-01 · 3 to 27 Sep · Leadership · S-04 to S-10 · METHOD v2 §2.4, §8.9 · P9-T19a, P9-T20, P9-T03**
Q4 planning opens four weeks ahead, on 3 September. Phase 2 follows Q3's retrospective on 16 September:
- **C8.** CS2's deferred expansion work becomes C8, now first on the issue list.
- **CS3.** C2 becomes the merged team's committed objective in Customer Success.
- **C7.** CS1 rises to company level for renewal season.

Five company objectives sit at the cap, and OBJ-5 is silent. The company step publishes on 27 September.
*Test:* Given C2 closed as Modify in Q3, when Q4's drafting opens, then it is offered as a pre-filled draft that can be placed in Customer Success at team level. Given five company objectives, then OBJ-5 does not warn.

**NW-Q4-02 · 25 Oct (W4) · Mei, Leo · S-14 roles · Today**
Mei returns from leave. Leo hands E1 back, and the reassignment is recorded. C3 was achieved in Q3, so it stays closed under Leo's name, which is where the record of who delivered it belongs.
*Test:* Given E1's champion reassigned from Leo back to Mei, then the activity holds both reassignments in order, and C3's close record still names Leo.

**NW-Q4-03 · 20 Nov to 1 Dec · Champion, leadership · S-04 `/cycle?phase=0`, `?phase=1` · METHOD v2 §2.1, §2.4, §2.6 · Today**
Annual planning for 2028 opens on 20 November, six weeks before the year.
- **24 November.** The input pack is distributed: 2027's scores to date, the scorecard, the learnings and the KPI trends.
- **1 December, the offsite.** Mission and vision hold. Strategy 4, "Earn the trust of enterprise security teams", is achieved, and is replaced by "Grow expansion from the accounts that reached value". Three 2028 priorities are written, each with its 12-month success statement.

*Test:* Given the 2028 annual cycle, when the Champion runs on 20 November, then the sponsor and the facilitator each receive one planning-open message.

**NW-Q4-04 · 3 Dec (W9) · Leo, Elena · S-20 KPI grid, S-15, S-28 · METHOD v2 §2.10 maintain, §6.4, §6.5, §3.2 · P9-T12, P9-T17, P9-T18, P9-T11, P9-T19a**
A database failover fails, and the platform is down for four hours. Uptime for December reads 99.4%, below the red boundary of 99.5.
- **The KPI.** Uptime turns unhealthy. Leo chooses the first of the three responses, "fix it now", which creates a task with him as owner and 17 December as its date: the failover runbook and a tested replica. It is a defect, not a strategy, so it gets no recovery OKR.
- **The maintain key result.** E2.1 drops below 100%, showing the distance back to the band.
- **The check-in.** Leo checks in on E2 at 3 in 10, honest about December. E2 is committed, so the coach's committed-floor message reaches him, and critical escalation reaches Elena.

*Test:* Given uptime with a red boundary of 99.5, when 99.4 is recorded, then the KPI is unhealthy, the maintain key result's progress is below 100%, and choosing "fix it now" creates a task with an owner and a date and drafts no recovery OKR. Given Leo's check-in at 0.3 on a committed key result, then both messages are sent.

**NW-Q4-05 · 6 Dec (W10) · Hugo, Coach · S-21 KPI detail, S-02 · METHOD v2 §6.5 · Today**
November's operating margin is recorded: 13.6%, inside the healthy band for the first time since 2026. October had read 12.2%, in watch.
- **The coach.** It proposes closing C6, once.
- **Hugo.** He dismisses the proposal for now: one healthy month is not a trend, and he will decide at the Q4 retrospective.
- **The record.** Dismissing it is recorded, and the proposal is not sent again.

*Test:* Given a KPI under recovery whose reading enters the healthy band, when the reading is recorded, then the coach proposes closing the recovery once. Given the proposal dismissed, then the dismissal is recorded and the proposal is not repeated.

**NW-Q4-06 · 8 Dec · Priya facilitates; leadership · S-24 review of the 2027 annual cycle · METHOD v2 §8 · P9-T20**
The annual review of 2027 is held before a word of 2028 is drafted. It runs as the same review a quarter gets, over the annual objectives, graded on their latest readings:

| Annual objective | Kind | Key results: latest value and score | Close decision |
|---|---|---|---|
| A1 New accounts reach value in their first week | Aspirational | Time to first value 3.8 days (0.87). Activation 66% (0.79). Logo retention 93% (0.67) | Modify: the 2028 target for time to first value is 2 days |
| A2 Grow profitably from the customers we keep | Committed | Operating margin 13.6% (0.76). Net revenue retention 104% (0.5). Support cost per account $97 (0.94) | Keep. The explanation of the miss: Brightline's price pressure cost two quarters of margin |
| A3 Enterprise security teams approve us without a fight | Committed | SOC 2 report issued (1.0). Questionnaire turnaround 2 days (1.0). Uptime in band in 11 of 12 months (0.92) | Achieved, with the December failover recorded as the explanation for its one miss |
| A4 Win the mid-market deals we should win | Aspirational | Win rate 31% against the eased 32%, with the original 35% shown beside it (0.83). Win rate against Brightline 47% (0.84). Sales cycle 46 days (0.6) | Keep |

The aspirational annual key results average 0.77. Committed: 2 of 6 annual key results were met in full, both under A3.
*Test:* Given the 2027 annual cycle, when its review runs, then it uses the same stages as a quarterly review, and the eased target shows its original beside it.

**NW-Q4-07 · 9 Dec · Elena, Hugo, the board · S-25 minutes, scorecard export · METHOD v2 §2.10 · Today, P9-T12**
- **For the board.** Elena exports the year's scorecard as CSV and the minutes of the Q1 to Q3 reviews as PDFs.
- **F4.1.** The board approves the 2028 plan, and Hugo ticks F4.1 done that afternoon.

*Test:* Given four cycles scored, when the scorecard is exported, then the CSV has a row per cycle with its averages.

**NW-Q4-08 · 9 to 17 Dec · Leadership · S-09 drafting, S-10 publish · METHOD v2 §2.4 · Today, P9-T03**
The 2028 annual objectives are drafted from the annual review's decisions and the new strategy, and published on 17 December. Phase 2 of the 2028 cycle lists 2027's scored annual key results as its prior-cycle scoring.
*Test:* Given the 2027 annual review completed on 8 December, when the 2028 annual cycle's Phase 2 is evaluated, then the prior cycle reads as scored.

**NW-Q4-09 · 13 to 14 Dec (W11) · Champions · S-24 scoring · METHOD v2 §3.3 · P9-T14**
Q4 is graded early, before the holidays begin on 20 December. Across all scored aspirational key results the average is **0.71**. Committed results: **7 of 9 met**.
- **Met:** C6.1 margin 13.6%, C6.2 discount 6%, C7.1 renewals flagged 100%, C7.2 retention held every month, E2.2 restore time 34 minutes, CS3.2 deflection 35%, F4.1.
- **Missed:** E2.1, uptime, held in two of three months (0.67), explained by the 3 December failover. CS3.1, support cost per account $97 against $95 (0.67), explained by the merger's double-running costs in October.

*Test:* Given the two committed misses, when the scoring stage runs, then it closes only once both have their explanations.

**NW-Q4-10 · 15 Dec · Priya facilitates · S-24 review session, 60 minutes · METHOD v2 §8.3 · P9-T20**
The review session holds stages 1 to 4. The scoring reveal shows no "too safe" note: a quarter of the aspirational key results scored 1.0, below the three-quarters pattern.
*Test:* Given a quarter of the aspirational key results at 1.0, when the reveal completes, then no "too safe" note appears.

**NW-Q4-11 · 16 Dec · Priya facilitates · S-24 retrospective, 45 minutes · METHOD v2 §8.5, §8.6, §8.8, §8.9, §6.5 · P9-T20, P9-T18**
- **The diagnostic.** The cycle score is 0.71 and the measured rhythm 91%, so it reads "Results delivered".
- **Process health.** The lowest statement scores 3.6, the highest "lowest" of the year.
- **The recovery closes.** The room closes C6, the recovery, as **Achieved**: both key results met their targets, and November's reading is healthy. December's reading, 14.1% recorded on 6 January, later confirms it. The KPI leaves the recovery board and stays in the grid as the health metric it always was.
- **Close decisions:**

| Decision | Objectives |
|---|---|
| Achieved | C6, C7, F4 |
| Keep | C1, CS3, P4, G1, E2, S3 |
| Keep, proposed by default | C5 (Brightline) and C8 (expansion). Both are aspirational and unfinished, and the room accepts |
| Modify | E1 |

- **Learnings carried into 2028:**
  - "We learned that a competitor's launch is a reason to change OKRs within the week, not at the next cycle."
  - "We learned that marking holidays is what kept the summer's rhythm honest."

*Test:* Given an unfinished aspirational objective with the carry-forward setting at its default, when the close decision opens, then Keep is preselected and the objective pre-fills the next cycle's draft.

**NW-Q4-12 · 16 Dec · Elena · S-01, scorecard · METHOD v2 §3.4, §12 · P9-T14**
The year in one table, each column read from that cycle's own snapshot:

| | Q1 | Q2 | Q3 | Q4 |
|---|---|---|---|---|
| Aspirational average | 0.68 | 0.59 | 0.66 | 0.71 |
| Committed key results met | 6 of 10 | 5 of 5 | 7 of 11 | 7 of 9 |
| Measured rhythm (check-ins on time) | 81% | 84% | 86% | 91% |
| Lowest process-health statement | 2.6 | 3.1 | 3.2 | 3.6 |
| Added mid-cycle | 1 key result | 1 objective, 4 key results | 1 objective, 2 key results | none |
| Eased targets | none | 1 (S2.1) | none | none |

Several settings changed during the year:
- in April, the objectives-per-unit cap, critical escalation and OBJ-1 at block;
- in May, reasons for mid-cycle additions;
- in June, the review format and OBJ-1 back to warn.

None of these changes moves an earlier column. Q2's committed column reads 5 of 5 because C2 changed kind openly on 12 May, and the scorecard says so beside it.
*Test:* Given four closed cycles graded under different settings, when the scorecard renders, then each column matches that cycle's snapshot, and it shows the mid-cycle additions, eased targets and kind changes it counts.

**NW-Q4-13 · 17 Dec · Elena · S-36 practice settings · METHOD v2 §2.7, §12 · P9-T05, plus gap G-3**
Department objectives had mostly restated a team's or the company's, so two levels are enough. Elena turns the department level off for cycles starting in 2028. 2027's cycles keep the levels they were graded under. The setting is declared at P9-T01, but no task yet makes the screens read it (gap G-3).
*Test (once G-3 is built):* Given the department level turned off, when a 2028 cycle is drafted, then department is not offered as a level, and 2027's department objectives stay readable as they were.

**NW-Q4-14 · 20 to 22 Dec · Leadership · S-09 drafting · METHOD v2 §2.4, §8.9 · P9-T20**
Q1 2028's company objectives are drafted from the kept objectives, including C5 and C8, and from the new annual frame. They publish on 22 December. Team objectives follow in the first two weeks of January, as they did a year earlier.
*Test:* Given C5 and C8 kept, when Q1 2028 drafting opens, then both are pre-filled with their key results' last values as baselines.

**NW-Q4-15 · 23 Dec · Priya · S-36 workspace export · Today**
Before the holiday, Priya takes a workspace archive for the year: every cycle, check-in, review and decision. The export is recorded in the audit log.
*Test:* Given the workspace, when an archive is exported, then the audit log records who exported it and when.

**NW-Q4-16 · 24 Dec · Champion · digest, every channel · METHOD v2 §7.2 · P9-T19a**
The Champion's final digest of the year names the wins, as the weekly digests have since P9-T19a:
- the SOC 2 report;
- margin back over 13.5%;
- the Growth team's first conversion target;
- 91% of check-ins on time.

*Test:* Given wins recorded in the week's sessions, when the digest is assembled, then it lists them.

---

Previous: [3. Q3: the long summer](03-q3-summer.md). Next: [5. Scenario index](05-scenario-index.md).
