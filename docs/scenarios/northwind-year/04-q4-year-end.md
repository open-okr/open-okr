# 4. Q4 2027: renewals and the year-end

1 October to 31 December 2027. Week 1 starts on Monday 4 October. Renewal season meets year-end. The margin recovery finishes, expansion comes back, and an outage tests a commitment. The year is reviewed before 2028 is drafted, and 2028 is planned on the evidence of the four cycles before it.

KPIs are recorded monthly, a few days after each month ends. Grading in December uses November's readings; December's arrive in January.

---

## The plan

### Company OKRs for Q4

Drafted 6 to 24 September and published 27 September. There are five, which is the company cap.

| # | Objective | Kind | Champion · reviewer | Aligns to | Key results (baseline → Q4 target), owner |
|---|---|---|---|---|---|
| C1 | New accounts reach value in their first week (kept) | Aspirational | Priya · Elena | A1 | C1.1 Median time to first value 4.4 → 3.5 days (reduce), Sara. C1.2 30-day activation 63% → 68%, Sara |
| C5 | Mid-market buyers choose us over Brightline (kept) | Aspirational | Daniel · Elena | A4 | C5.1 Win rate against Brightline 43% → 50%, Daniel |
| C6 | Margins we can run the business on again (recovery, kept) | Committed | Hugo · Elena | A2 | C6.1 Operating margin 10.4% → 13.5%, Hugo. C6.2 Average renewal discount 7% → 6% (reduce), Daniel |
| C7 | No customer is surprised by their own renewal | Committed | Tomás · Elena | A2 | C7.1 Renewals flagged 90 days out 95% → 100%, Tomás. C7.2 Gross revenue retention held at or above 92% every month (maintain), Tomás |
| C8 | Expansion comes from accounts that reached value | Aspirational | Tomás · Priya | A2 | C8.1 Expansion seats added 168 → 210 a month, Tomás. C8.2 Net revenue retention 101% → 104%, Hugo |

### Department and team OKRs for Q4

| # | Objective | Space | Kind | Aligns to | Key results (baseline → target), owner |
|---|---|---|---|---|---|
| P4 | The first session shows value without a call (kept) | Product | Aspirational | C1 | P4.1 Setup completed in the first session 55% → 65%, Sara |
| G1 | Trials turn into customers without a sales call (kept) | Growth | Aspirational | C1 | G1.2 Self-serve trial-to-paid conversion 5.2% → 7%, Yuki |
| E1 | Take the repeated questions out of the product (modified) | Engineering | Aspirational | C7 | E1.1 Renewal and billing questions answered in the product 2 → 8, Leo, then Mei |
| E2 | Keep the platform standing (kept) | Engineering | Committed | A3 | E2.1 Uptime held at or above 99.9% every month (maintain), Leo. E2.2 Mean time to restore 38 → 35 minutes (reduce), Leo |
| CS3 | Answer once, in the product, from Customer Success | Customer Success | Aspirational | C7 | CS3.1 Self-serve deflection 31% → 35%, Kofi |
| S3 | Win the late-stage deals against Brightline (kept) | Sales | Aspirational | C5 | S3.1 Late-stage win rate against Brightline 46% → 55%, Jonas |
| F4 | Plan 2028 on numbers the board trusts | Finance | Committed | Stands alone: "Annual planning cadence" | F4.1 Board-approved 2028 plan by 9 December (milestone), Hugo |

---

## The quarter, in date order

**NW-Q4-01 · 3 to 27 Sep · Leadership · S-04 to S-10 · METHOD v2 §2.4 · Today and P9-T03**
Q4 planning opens four weeks ahead, on 3 September. CS2's deferred expansion work becomes C8, now first on the issue list (NW-Q3-16). Five company objectives sit at the cap, and OBJ-5 is silent. The set publishes on 27 September.

**NW-Q4-02 · 25 Oct (W4) · Mei, Leo · S-14 roles · Today**
Mei returns from leave. Leo hands E1 back, and the reassignment is recorded. C3 was achieved in Q3, so it stays closed under Leo's name, which is where the record of who delivered it belongs.

**NW-Q4-03 · 19 Nov to 1 Dec · Champion, leadership · S-04 `/cycle?phase=0`, `?phase=1` · METHOD v2 §2.1, §2.4, §2.6 · Today**
Annual planning for 2028 opens six weeks ahead, on 19 November.
- **24 November.** The input pack is distributed: 2027's scores to date, the scorecard, the learnings and the KPI trends.
- **1 December, the offsite.** Mission and vision hold. Strategy 4, "Earn the trust of enterprise security teams", is achieved, and is replaced by "Grow expansion from the accounts that reached value".

**NW-Q4-04 · 3 Dec (W9) · Leo, Elena · S-20 KPI grid, S-15, S-28 · METHOD v2 §2.10 maintain, §6.5 · P9-T12 and P9-T17**
A database failover fails, and the platform is down for four hours. Uptime for December so far reads 99.4%, below the 99.9% band.
- **The maintain key result.** E2.1 drops below 100%, showing the distance back to the band.
- **The KPI.** Uptime turns unhealthy. Leo picks the first of the three responses, "fix it now": he is the owner, and the date is 17 December, for the failover runbook and a tested replica. It is a defect, not a strategy, so it gets no recovery OKR.
- **Escalation.** E2 is committed, so the coach's committed-floor message reaches Leo, and critical escalation reaches Elena.

*Test:* Given a maintain key result with the band 99.9 to 100, when 99.4 is recorded, then its progress is below 100%. Given the KPI unhealthy and "fix it now" chosen, then a task with an owner and a date exists, and no recovery OKR is drafted.

**NW-Q4-05 · 6 Dec (W10) · Hugo, Coach · S-21 KPI detail, S-02 · METHOD v2 §6.5 · P9-T18**
November's operating margin is recorded: 13.6%, inside the healthy band for the first time since 2026. October had read 12.2%, in watch.
- **The coach.** It proposes closing C6.
- **Hugo.** He declines for now: one healthy month is not a trend, and he will decide at the Q4 review.
- **The record.** Declining is recorded, and the coach does not repeat the proposal that day.

*Test:* Given a KPI under recovery whose real reading enters the healthy band, when the reading is recorded, then the coach proposes closing the recovery. Given the proposal declined, then the decline is recorded and the proposal is not re-sent that day.

**NW-Q4-06 · 8 Dec · Priya facilitates; leadership · S-24 annual review · METHOD v2 §8, §8.8 · P9-T20**
The annual review of 2027 is held before a word of 2028 is drafted. The annual objectives are graded on their latest readings:

| Annual objective | Kind | Key results: latest value and score | Close decision |
|---|---|---|---|
| A1 New accounts reach value in their first week | Aspirational | Time to first value 3.8 days (0.87). Activation 66% (0.79). Logo retention 93% (0.67) | Modify: the 2028 target for time to first value is 2 days |
| A2 Grow profitably from the customers we keep | Committed | Operating margin 13.6% (0.76). Net revenue retention 104% (0.5). Support cost per account $97 (0.94) | Keep. The explanation of the miss: Brightline's price pressure cost two quarters of margin |
| A3 Enterprise security teams approve us without a fight | Committed | SOC 2 report issued (1.0). Questionnaire turnaround 2 days (1.0). Uptime in band in 11 of 12 months (0.92) | Achieved, with the December failover recorded as the explanation for its one miss |
| A4 Win the mid-market deals we should win | Aspirational | Win rate 31% against the revised 32% (0.83). Win rate against Brightline 47% (0.84). Sales cycle 46 days (0.6) | Keep |

The aspirational annual key results average 0.77. Committed: 2 of 6 annual key results were met in full, both under A3.

**NW-Q4-07 · 9 Dec · Elena, Hugo, the board · S-25 exports, scorecard · METHOD v2 §2.10 · Today and P9-T12**
- **For the board.** Elena exports the scorecard and the minutes of the Q1 to Q3 reviews as PDFs.
- **F4.1.** The board approves the 2028 plan, and Hugo ticks F4.1 done that afternoon.

**NW-Q4-08 · 9 to 17 Dec · Leadership · S-09 drafting, S-10 publish · METHOD v2 §2.4 · Today and P9-T03**
The 2028 annual objectives are drafted from the annual review's decisions and the new strategy. They are published on 17 December. Phase 2 of the 2028 cycle lists 2027's scored annual key results as its prior-cycle scoring.
*Test:* Given the 2027 annual review completed on 8 December, when the 2028 annual cycle's Phase 2 is evaluated, then the prior cycle reads as scored.

**NW-Q4-09 · 13 to 14 Dec (W11) · Champions · S-24 scoring · METHOD v2 §3.3 · P9-T14**
Q4 is graded early, before the holidays begin on 20 December. Across all scored aspirational key results, the average is **0.71**. Committed results: **6 of 7 met**.
- **Met:** C6.1 margin 13.6%, C6.2 discount 6%, C7.1 renewals flagged 100%, C7.2 retention held every month, E2.2 restore time 34 minutes, F4.1.
- **Missed:** E2.1, uptime, which held in two of the three months (0.67). The explanation is the 3 December failover.

**NW-Q4-10 · 15 Dec · Priya facilitates · S-24 review, 60 minutes · METHOD v2 §8.3, §8.6, §6.5 · P9-T20 and P9-T18**
The diagnostic reads "Results delivered": the cycle score is 0.71 and the measured rhythm is 91%. No "too safe" note appears: a quarter of the aspirational key results scored 1.0, below the three-quarters pattern.

The room closes C6, the recovery, as **Achieved**. Both of its key results met their targets, and November's reading is healthy. December's reading, 14.1% recorded on 6 January, later confirms it. The KPI leaves the recovery board and stays in the grid as the health metric it always was.

**NW-Q4-11 · 16 Dec · Priya facilitates · S-24 retrospective, 45 minutes · METHOD v2 §8.5, §8.8, §8.9 · P9-T20**
- **Process health.** The lowest statement scores 3.6, the highest "lowest" of the year.
- **Close decisions:**

| Decision | Objectives |
|---|---|
| Achieved | C6, C7, F4 |
| Keep | C1, P4, G1, E2, S3 |
| Keep, proposed by default | C5 (Brightline) and C8 (expansion). Both are aspirational and unfinished, and the room accepts |
| Modify | E1, CS3 |

- **Learnings carried into 2028:**
  - "We learned that a competitor's launch is a reason to change OKRs within the week, not at the next cycle."
  - "We learned that marking holidays is what kept the summer's rhythm honest."

*Test:* Given an unfinished aspirational objective with the carry-forward setting at its default, when the close decision opens, then Keep is preselected, and the objective pre-fills the next cycle's draft.

**NW-Q4-12 · 16 Dec · Elena · S-01, scorecard · METHOD v2 §3.4, §12 · P9-T14**
The year in one table, each column read from that cycle's own snapshot:

| | Q1 | Q2 | Q3 | Q4 |
|---|---|---|---|---|
| Aspirational average | 0.69 | 0.55 | 0.66 | 0.71 |
| Committed key results met | 6 of 10 | 4 of 6 | 7 of 11 | 6 of 7 |
| Measured rhythm (check-ins on time) | 81% | 84% | 86% | 91% |
| Lowest process-health statement | 2.6 | 3.1 | 3.2 | 3.6 |
| Added mid-cycle | 1 key result | 1 objective with 4 key results | 1 objective (Growth) | none |

Several settings changed during the year:
- the objectives-per-unit cap, in April;
- critical escalation, in April;
- reasons for mid-cycle additions, in May;
- the review format, in June.

None of these changes moves an earlier column.
*Test:* Given four closed cycles graded under different settings, when the scorecard renders, then each column matches that cycle's snapshot.

**NW-Q4-13 · 17 Dec · Elena · S-36 practice settings · METHOD v2 §2.7, §12 · P9-T05**
Department objectives had mostly restated a team's or the company's, so two levels are enough. Elena turns the department level off for cycles starting in 2028. 2027's cycles keep the levels they were graded under.
*Test:* Given the department level turned off, when a 2028 cycle is drafted, then department is not offered as a level, and 2027's department objectives remain readable as they were.

**NW-Q4-14 · 20 to 22 Dec · Leadership · S-09 drafting · METHOD v2 §2.4, §8.9 · Today**
Q1 2028's company objectives are drafted from the kept objectives, including C5 and C8, and from the new annual frame. They are published on 22 December. Team objectives follow in the first two weeks of January, as they did a year earlier.

**NW-Q4-15 · 23 Dec · Priya · S-36 workspace export · Today**
Before the holiday, Priya takes a workspace archive for the year: every cycle, check-in, review and decision. The export is recorded in the audit log.

**NW-Q4-16 · 24 Dec · Champion · digest, every channel · METHOD v2 §7.2 · Today**
The Champion's final digest of the year names the wins, as the weekly digests did all year:
- the SOC 2 report;
- margin back over 13.5%;
- the Growth team's first conversion target;
- 91% of check-ins on time.

---

Previous: [3. Q3: the long summer](03-q3-summer.md). Next: [5. Scenario index](05-scenario-index.md).
