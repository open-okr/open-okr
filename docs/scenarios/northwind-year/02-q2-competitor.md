# 2. Q2 2027: the competitor

1 April to 30 June 2027. Week 1 starts on Monday 5 April. Q2 starts as a steadier second cycle, with two objectives per team and the mistakes of Q1 behind it. In week 6 a competitor launches into Northwind's segment.

The response follows the pattern Doerr tells in *Measure What Matters* about Intel's Operation Crush in 1979 and 1980. When Motorola's 68000 threatened the 8086, Intel did not wait for the next planning cycle: "Within a week, the executive staff met… One week after that, a blue-ribbon task force convened." It set new objectives and drove them through every level. Northwind does the same thing in OpenOKR:
- it stops what no longer matters;
- it starts what does;
- it lowers one target with an honest reason;
- it escalates a commitment the same day it slips.

---

## The plan

### Company OKRs for Q2

Drafted 19 to 26 March and published 29 March. Every baseline is where Q1 ended.

| # | Objective | Kind | Champion · reviewer | Aligns to | Key results (baseline → Q2 target), owner |
|---|---|---|---|---|---|
| C1 | New accounts reach value in their first week (kept) | Aspirational | Priya · Elena | A1 | C1.1 Median time to first value 7 → 5 days (reduce, lagging), Sara. C1.2 30-day activation 56% → 62% (lagging), Sara |
| C2 | Support cost per account falls while we grow (modified) | Committed | Tomás · Elena | A2 | C2.1 Support tickets per account 2.55 → 2.3 (reduce, leading), Kofi. C2.2 Support cost per account $118 → $108 (reduce, lagging), Hugo |
| C3 | Pass the SOC 2 observation window clean | Committed | Mei · Elena | A3 | C3.1 Open control exceptions held at zero at every month-end (maintain), Leo. C3.2 Security questionnaire turnaround 10 → 4 working days (reduce), Mei |
| C4 | Expansion comes from accounts that reached value | Aspirational | Elena · Priya | A2 | C4.1 Expansion seats added 138 → 170 a month, Tomás. C4.2 Net revenue retention 100% → 103%, Hugo |

### Department and team OKRs for Q2

Two per unit at most: the cap Elena lowered after Q1 (NW-Q1-29).

| # | Objective | Space | Kind | Aligns to | Key results (baseline → target), owner |
|---|---|---|---|---|---|
| P1 | Onboarding runs without us in the room (kept) | Product | Aspirational | C1 | P1.1 Guided setup completed by 72% → 80% of new accounts (leading), Sara. P1.2 Manual setup calls per new account 0.8 → 0.5 (reduce), Sara |
| E1 | Take the twelve repeated questions out of the product (kept) | Engineering | Aspirational | C2.1 | E1.1 In-product answers shipped 10 → 12, Mei. E1.2 p95 setup API latency 450 → 380 ms (reduce), Leo |
| E2 | Keep the platform standing (kept) | Engineering | Committed | C3 | E2.1 Uptime held at or above 99.9% every month (maintain), Leo. E2.2 Mean time to restore 50 → 45 minutes (reduce), Leo |
| S1 | Sell to accounts that can onboard themselves (kept) | Sales | Aspirational | C1 | S1.1 New deals inside the target profile 76% → 82%, Jonas. S1.2 Days from signature to kickoff 5 → 4 (reduce), Jonas |
| S2 | Fill the pipeline with accounts that fit (modified) | Sales | Aspirational | S1 | S2.1 Qualified mid-market pipeline $2.6M → $3.4M, Ben. S2.2 Call-to-meeting conversion 10% → 12%, Jonas |
| CS1 | No customer is surprised by their own renewal (kept) | Customer Success | Aspirational | A2 | CS1.1 Renewals flagged 90 days out 74% → 90%, Tomás. CS1.2 Accounts over $10k with a health reading under 30 days old 96% → 100%, Tomás |
| CS2 | Accounts that reached value grow with us | Customer Success | Aspirational | C4 | CS2.1 Expansion pipeline from value-reached accounts $0.4M → $0.8M, Tomás |
| SU1 | Answer once, in the product (kept) | Support | Aspirational | C2.1 | SU1.1 Self-serve deflection 22% → 30%, Kofi |
| M1 | Leads that turn into deals (modified) | Marketing | Aspirational | S1 | M1.1 Target-profile lead to sales-qualified conversion 18% → 25%, Nadia |
| F2 | Budget owners see their spend every week | Finance | Committed | Stands alone: "Finance operating cadence" | F2.1 Budget owners with a weekly spend view 0 → 12 of 12 (metric), Hugo |

---

## Planning Q2

**NW-Q2-01 · 19 to 29 Mar · Leadership · S-09 drafting, copilot · METHOD v2 §8.9, §2.8 · Today and P9-T11**
- **Kept objectives arrive pre-filled.** Q1's kept objectives come back as drafts. C1 keeps its wording and gets new targets from where Q1 ended.
- **C4 is new.** Elena types an ambition, "grow from the customers who got value", into the copilot's "draft an objective". The draft shows as a preview with Apply and Dismiss buttons. She applies it, then edits the key results. The coach checks C4 like any other objective.
- **Without AI.** With the AI provider off, the same objective is written by hand, and every check still runs.

*Test:* Given a kept Q1 objective, when Q2 drafting opens, then it is pre-filled with Q1's ending values as its baselines. Given AI off, when C4 is typed by hand, then the same checks fire.

**NW-Q2-02 · 2 Apr · Elena · S-36 practice settings · METHOD v2 §3.2, §12 · P9-T05 and P9-T19**
In Q1, Elena heard about C2.1's low confidence only at the monthly review. She wants to hear the same day when any key result falls to 3 in 10 or below. She turns "Critical confidence escalation" on. The change is audited.
*Test:* Given critical confidence escalation on, when a key result's confidence falls to 0.3, then the sponsor is told the same day, and the audit log shows who turned the setting on and when.

**NW-Q2-03 · 5 to 15 Apr · Teams · OKRs list · METHOD v2 OBJ-5 · P9-T03 and P9-T07b**
Engineering drafts a third objective. OBJ-5 now warns at three, because the cap is two. Mei moves the third, "Halve the build time", into an initiative under E1, where the work is tracked without being an objective.
*Test:* Given the objectives-per-unit cap at 2, when a third Engineering objective is saved, then OBJ-5 warns and the save succeeds.

**NW-Q2-04 · 12 Apr · Directory sync, Yuki · S-33 `/people`, OKRs list · Today**
Yuki Tanaka joins as Product Manager, Growth. Directory sync creates her as a member on her first morning. She reads the Company tab of OKRs, opens C1 in the drawer, and is added as a contributor to P1. Individual OKRs are off, so she writes none.
*Test:* Given a person added to the identity provider's group, when directory sync runs, then they are a member with standard access, and can read every company OKR on their first sign-in.

**NW-Q2-05 · 15 Apr · All teams · OKRs list · METHOD v2 §2.9 · P9-T13**
Team OKRs are shared inside the publication window, so none is marked as added mid-cycle.

**NW-Q2-06 · 19 Apr (W3) · Tomás, Elena · S-16 dependency register · METHOD v2 AL-5, §5.4 · P9-T16**
CS2 depends on Product shipping in-app expansion prompts, and Product has not confirmed. AL-5 warns. Tomás escalates the unconfirmed dependency to Elena. She decides Product delivers the prompts by week 8, and Priya confirms.
*Test:* Given an unconfirmed dependency, when it is escalated, then the sponsor's inbox lists it, and confirming it clears AL-5.

**NW-Q2-07 · 3 May (W5) · Leadership · S-23 monthly review · Today**
Every objective continues. Trends: C1 is improving; C2 and C4 are flat.

## Week 6: the competitor

**NW-Q2-08 · 10 May (W6) · Daniel · S-15 check-in · METHOD v2 §3.2 · P9-T19**
Brightline launches self-serve onboarding into the mid-market, priced 30% below Northwind. Within the week, three of Daniel's late-stage deals stall. His check-in on S1 says so plainly, with confidence 3 in 10. Critical escalation is on, so Elena hears that evening (NW-Q2-02).
*Test:* Given critical escalation on and a key result checked in at 0.3, when the check-in publishes, then the sponsor receives one escalation the same day.

**NW-Q2-09 · 12 May · Leadership, Priya facilitating · S-23 monthly review (called early), OKRs list and diagram · METHOD v2 §2.9 · P9-T13 and P9-T10**
An emergency leadership session takes the four mid-cycle moves:

| Move | What | Recorded as |
|---|---|---|
| Start | C5, "Mid-market buyers choose us over Brightline", aspirational, champion Daniel, aligned to A4 | Marked added mid-cycle, with Daniel's reason |
| Start | Key results C5.1 "Establish our win rate against Brightline" (baseline), Amara. C5.2 "Late-stage deals lost to Brightline 3 → 0 a month" (reduce), Daniel. C5.3 "Competitive battlecard used in 0% → 80% of mid-market opportunities" (leading), Nadia | Each marked added mid-cycle |
| Stop | C4, "Expansion comes from accounts that reached value" | Closed as abandoned: "Capacity moves to the competitive response; expansion returns as a strategic issue for Q3" |
| Update | M1 re-parented from S1 to C5 by dragging it in the diagram; CS2 re-parented from C4 to the annual A2 | A dated change on each, with undo for six seconds |

*Test:* Given C4 stopped with a reason, when the list renders, then C4 shows as abandoned with the reason, and CS2, its child, appears under A2 after the re-parent. Given C5 created on 12 May in a cycle whose publication window closed on 15 April, then C5 is marked added mid-cycle.

**NW-Q2-10 · 12 May · Ben, Daniel · S-13 list, target cell · METHOD v2 §2.9, §7.6 · P9-T06**
Brightline's launch removed about $0.5 million of late-stage pipeline. Ben lowers S2.1's target from $3.4M to $2.9M. The reason field opens, and he writes: "Brightline's launch on 10 May removed $0.5M of late-stage deals; the market price point moved." The change is a verifiable change in the outside world, so it is a valid reason. The original $3.4M stays on record and will show at the close.
*Test:* Given a target lowered with a reason, when the key result is read, then it shows the new target, and its history holds 3.4 → 2.9 with the reason, the actor and the date.

**NW-Q2-11 · 13 to 21 May · Ben, Daniel, Elena · S-33 people, S-14 roles · Today**
Ben resigns, and his last day is 21 May. Daniel reassigns S2.1 to Jonas, and the reassignment is recorded in the activity. On 21 May directory sync suspends Ben. A suspended member is excluded from every read and gets no nudges. His check-in history stays on the goals.
*Test:* Given Ben suspended, when the Champion runs, then Ben receives no nudge, S2.1's owner is Jonas, and Ben's past check-ins remain readable on S2.

**NW-Q2-12 · 14 May · Elena · S-36 practice settings · METHOD v2 §12 · P9-T05 and P9-T13**
Four objectives and key results were added in one week. Elena changes "Reason when adding mid-cycle" from Optional to Required, so the next addition must say why. The change is audited, and does not reach back to the additions already made.
*Test:* Given the setting at Required, when a key result is added mid-cycle without a reason, then it is refused with the sentence naming the setting. Given additions made before the change, then they are untouched.

**NW-Q2-13 · 17 May (W7) · Mei, Elena · S-15 check-in, S-02 · METHOD v2 §3.2, §2.8 · P9-T11 and P9-T19**
Brightline also sends more security questionnaires Northwind's way, as prospects compare vendors: 12 a week instead of 5. C3.2 (questionnaire turnaround, committed) reads 7 days, with confidence 3 in 10.
- **Two messages, the same day.** The coach sends its committed-floor message, and critical escalation reaches Elena.
- **Elena's decision.** One sales engineer moves to questionnaires for six weeks, and a trust-centre page goes up as an initiative under C3.

The commitment stays a commitment. Confidence recovers to 6 in 10.
*Test:* Given a committed key result at 0.3 with critical escalation on, when the check-in publishes, then the champion gets the committed-floor message and the sponsor gets the escalation. Both cite their rules, and the decision is recorded against C3.2.

**NW-Q2-14 · 17 May · Daniel, his own AI assistant · `/api/mcp` · Today**
Before his Monday forecast call, Daniel asks the AI assistant he already uses, connected to OpenOKR over MCP, a question: "Which committed key results are at risk this week, and why?" The answer comes only from what Daniel himself can read. He then asks it to draft his check-in on S1. The draft arrives in his review inbox as a proposal, and he edits and publishes it himself. The agent writes nothing directly.
*Test:* Given Daniel's MCP connection with read and propose scopes, when it asks for at-risk committed key results, then it returns only goals Daniel can read. Given a drafted check-in, then it appears as a proposal in his inbox and nothing is published until he applies it.

**NW-Q2-15 · 31 May (W9) · Amara · S-14 drawer · METHOD v2 §2.10, §2.9 · P9-T12 and P9-T13**
- **The baseline.** Amara finishes the analysis and records the win rate against Brightline: 31%. C5.1, the baseline key result, is done.
- **The target.** She adds C5.4, "Win rate against Brightline 31% → 45%". Reasons are now required (NW-Q2-12), so she writes: "Baseline established on 31 May; this is the target C5.1 was for."

*Test:* Given a baseline key result, when its value is recorded, then it reads done. Given the reason setting at Required, when C5.4 is added with a reason, then it saves, marked added mid-cycle.

**NW-Q2-16 · 31 May · Leadership · S-23 monthly review · METHOD v2 §7.5 · Today**
The second monthly review records the decision log for 12 May against each key result it touched. Every other objective continues.

## Mid-year

**NW-Q2-17 · 7 Jun (W10) · Leadership · S-06 `/cycle?phase=3` for Q3 · METHOD v2 §2.1 · Today**
At the mid-year revalidation, the frame holds, with two documented changes:
- **Annual objective A4.** Its win-rate key result is lowered from 35% to 32%, with the reason "Brightline's entry into the segment on 10 May". A new key result is added: "Win rate against Brightline 31% → 50% by year-end".
- **The not-doing list.** "No pricing rebuild before July" is removed, with the reason "Competitive price point; the pricing review starts in Q3".

*Test:* Given the annual frame revalidated with a documented change, when Phase 3 is evaluated, then it is complete, and the annual objective's history shows the lowered target with its reason.

**NW-Q2-18 · 7 Jun · Elena · S-36 practice settings · METHOD v2 §8, §12 · P9-T20**
Q1's review ran 40 minutes over. Elena sets "Quarterly review format" to "Review and retrospective separately".

## Closing Q2

**NW-Q2-19 · 14 to 15 Jun (W11) · Champions · S-24 scoring · METHOD v2 §3.3 · P9-T14**
Grading runs two weeks before the end. The headline results:

| Key result | Result | Score |
|---|---|---|
| C1.1 Time to first value | 5.5 days | 0.75 |
| C1.2 Activation | 59% | 0.5 |
| C5.1 Baseline | Done | 1.0 |
| C5.2 Losses to Brightline | 1 a month | 0.67 |
| C5.3 Battlecard use | 65% | 0.81 |
| C5.4 Win rate against Brightline | 38% | 0.5 |
| S2.1 Pipeline against the lowered $2.9M target | $2.7M | 0.33, with the original $3.4M shown beside it |
| CS2.1 Expansion pipeline | $0.5M | 0.25 |

Across all scored aspirational key results, the average is **0.55**.

Committed results: **4 of 6 met** (C3.1, C3.2, E2.1, E2.2).
- **C2.1 missed.** Tickets per account reached 2.32 (0.92). The explanation: the support headcount freeze delayed the tooling.
- **C2.2 missed.** Support cost per account reached $109 against $108 (0.9). The explanation: the questionnaire surge pulled two support agents into security work for three weeks.

**NW-Q2-20 · 16 Jun · Priya facilitates · S-24 review, 60 minutes · METHOD v2 §8.3, §8.6 · P9-T20**
The review session covers acts 1 and 2 only. The format is now split.
- **The diagnostic.** The cycle score is 0.55, below 0.6. The measured rhythm is 84%, at or above 75%. So the diagnosis reads "Likely a strategy or OKR-quality problem".
- **The room tests that hypothesis.** It holds: the strategy changed in week 6.
- **Root causes.** "Priority shifted mid-cycle" on four key results. "External or market change" on two.

*Test:* Given a cycle score of 0.55 and a measured rhythm of 84%, when the diagnostic is read, then it says "Likely a strategy or OKR-quality problem" and presents itself as a hypothesis.

**NW-Q2-21 · 18 Jun · Priya facilitates · S-24 retrospective, 45 minutes · METHOD v2 §8.5, §8.7, §8.8 · P9-T20**
The retrospective session covers acts 3 and 4.
- **Management retro.** Leadership answers the four questions out loud. On "Where did alignment break down?" the answer is that Marketing learned of the Brightline launch from a customer, not from Sales.
- **Process health.** The lowest statement is 3, "Our key results measured outcomes, not activity", at 3.1. It becomes an improvement action: Sales and Marketing pair their key results on outcomes in Q3.
- **Close decisions:**

| Decision | Objectives |
|---|---|
| Keep | C1, C5, E1, E2, S1, CS1, SU1, M1 |
| Modify | C2, S2 |
| Defer | CS2. It goes to the strategic issue list at impact 4, where it competes on its merits |
| Achieved | C3, P1, F2 |

*Test:* Given CS2 closed as Defer, when Q3's Phase 2 opens, then CS2 appears on the strategic issue list at impact 4 and not as a pre-filled draft.

**NW-Q2-22 · 18 Jun · Elena · S-01 overview, annual objectives · METHOD v2 §2.1 · Today**
The mid-year view of the annual objectives:
- **A1, first-week value:** on pace.
- **A2, profitability:** off track. Brightline's price pressure forced discounts on renewals. Operating margin fell to 7.8% in May and 7.6% in June, below its red boundary of 8%.
- **A3, enterprise trust:** on pace. The observation window is clean, and the report is due in September.
- **A4, winning:** revised (NW-Q2-17).

The operating margin KPI has now been unhealthy for two consecutive months. The coach's recovery proposal arrives when June's reading is recorded, in the first week of Q3 (NW-Q3-04).

---

Previous: [1. Q1: the rollout](01-q1-rollout.md). Next: [3. Q3: the long summer](03-q3-summer.md).
