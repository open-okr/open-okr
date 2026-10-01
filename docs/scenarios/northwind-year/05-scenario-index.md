# 5. Scenario index

Every step in the year, by ID, with what it proves and whether the product can do it today. Use this page to choose the steps an end-to-end spec, a manual test, a demo or a guide page covers.

## 1. How to use the IDs

| For | Do this |
|---|---|
| **An end-to-end spec** | Name the steps it proves in its describe block, for example `test.describe("NW-Q2-09: stop, start and re-parent mid-cycle")`, and assert the step's Then clause. A step marked P9-Tnn is the acceptance test for that task |
| **The manual workbook** (`docs/testing`) | Add a "Year" sheet whose rows are step IDs, using the seven Northwind personas the workbook already has, plus the six this scenario adds |
| **The demo** | Choose one of the dates in the [README](README.md) §6. Everything before that date must be true in the seed |
| **The user guide and handbook** | When a guide page explains a step, link the step's ID from the page, so the guide and the scenario stay in step |

## 2. Every step

**Status** is either **Today** (the product does it now), a Phase 9 task (it arrives with that task), or a gap (§3).

### Before the year

| ID | Step | Status |
|---|---|---|
| NW-P-01 | Sign up; every default in force | Today |
| NW-P-02 | The pilot cycle; first cycle inferred; writing open on day one | P9-T02 |
| NW-P-03 | Pilot check-ins; a drop into the low band tells the coordinator | Today; the alert is P9-T19 |
| NW-P-04 | The pilot's review feeds Q1's input pack | Today |
| NW-P-05 | Single sign-on, directory sync, Slack | Today |
| NW-P-06 | "Space" renamed "Team" | Today |
| NW-P-07 | The practice settings screen at its defaults | P9-T05 |
| NW-P-08 | 2026 spreadsheets imported, dry run first | Today |
| NW-P-09 | Annual planning opens; the input pack | Today |
| NW-P-10 | The annual frame and not-doing list | Today |
| NW-P-11 | Annual objectives drafted, committed and aspirational | P9-T03, P9-T11 |
| NW-P-12 | The annual set publishes; capacity recorded | P9-T03 |
| NW-P-13 | KPI target types and their own thresholds | P9-T17 |
| NW-P-14 | Q1's whole rhythm booked in advance | Today |

### Q1: the rollout

| ID | Step | Status |
|---|---|---|
| NW-Q1-01 | Planning opens four weeks ahead | Today |
| NW-Q1-02 | Phase 2 with the pilot's scores | Today |
| NW-Q1-03 | Quarterly revalidation, no annual-only checks | Today |
| NW-Q1-04 | Company objectives drafted by kind | P9-T11 |
| NW-Q1-05 | A baseline key result passes | P9-T12 |
| NW-Q1-06 | Gate 5 warns on aspirational "exceeds" | P9-T03, P9-T11 |
| NW-Q1-07 | Adding objectives and key results inline | P9-T07b |
| NW-Q1-08 | Task-shaped key results warn, never refused | P9-T03 |
| NW-Q1-09 | Too many objectives warns | P9-T03 |
| NW-Q1-10 | Aligning diagonally by dragging in the diagram | P9-T10 |
| NW-Q1-11 | Standing alone with a reason | P9-T16 |
| NW-Q1-12 | Peer review rewrites the drafts | Today |
| NW-Q1-13 | Dependencies confirmed; alignment health | Today, P9-T16 |
| NW-Q1-14 | Team OKRs in the window are not marked mid-cycle | P9-T13 |
| NW-Q1-15 | First check-ins: Slack, private votes, acknowledgements | Today |
| NW-Q1-16 | A missed check-in and its nudges | Today |
| NW-Q1-17 | A KPI turns unhealthy; a key result added mid-cycle | P9-T17, P9-T18, P9-T13 |
| NW-Q1-18 | The monthly review's decision log | Today |
| NW-Q1-19 | Confidence drops; a blocker due by the next check-in | P9-T19 |
| NW-Q1-20 | A milestone done closes a blocker | P9-T12 |
| NW-Q1-21 | Reported health disagrees with the data | P9-T15 |
| NW-Q1-22 | A milestone done early | P9-T12 |
| NW-Q1-23 | The pace-aware signal and the trend forecast | P9-T15 |
| NW-Q1-24 | Lowering a target without a reason is refused | P9-T06 |
| NW-Q1-25 | A committed key result below the floor escalates | P9-T11 |
| NW-Q1-26 | A score adjusted with a reason | P9-T14 |
| NW-Q1-27 | The 90-minute review; committed and aspirational reported apart | P9-T20 |
| NW-Q1-28 | Root causes by kind | P9-T20 |
| NW-Q1-29 | Process health to an action; a threshold changed after close | P9-T20, P9-T14 |
| NW-Q1-30 | The diagnostic reads results delivered | P9-T20 |
| NW-Q1-31 | Close decisions; kept objectives pre-fill the next cycle | P9-T20 |
| NW-Q1-32 | The minutes as a PDF | Today |

### Q2: the competitor

| ID | Step | Status |
|---|---|---|
| NW-Q2-01 | Kept objectives pre-filled; the copilot drafts one | Today (copilot), P9-T20 (pre-fill) |
| NW-Q2-02 | Critical escalation turned on | P9-T05, P9-T19 |
| NW-Q2-03 | The cap of two warns at a third | P9-T03 |
| NW-Q2-04 | A new hire provisioned by directory sync | Today |
| NW-Q2-05 | Team OKRs inside the window | P9-T13 |
| NW-Q2-06 | An unconfirmed dependency escalated | P9-T16 |
| NW-Q2-07 | Monthly review | Today |
| NW-Q2-08 | A check-in at 3 in 10 reaches the sponsor the same day | P9-T19 |
| NW-Q2-09 | Stop, start and re-parent mid-cycle | P9-T13, P9-T10 |
| NW-Q2-10 | A target lowered with a valid reason; the original kept | P9-T06 |
| NW-Q2-11 | A leaver suspended; their key results reassigned | Today |
| NW-Q2-12 | Reasons for additions made required | P9-T05, P9-T13 |
| NW-Q2-13 | A committed key result escalated twice the same day | P9-T11, P9-T19 |
| NW-Q2-14 | An external AI assistant reads and proposes | Today |
| NW-Q2-15 | A baseline recorded, then its target added | P9-T12, P9-T13 |
| NW-Q2-16 | Monthly review | Today |
| NW-Q2-17 | Mid-year revalidation changes an annual target | Today |
| NW-Q2-18 | The review split into two sessions | P9-T20 |
| NW-Q2-19 | Grading, with a lowered target shown beside the original | P9-T14 |
| NW-Q2-20 | The diagnostic as a hypothesis | P9-T20 |
| NW-Q2-21 | Retrospective; Defer sends an objective to the issue list | P9-T20 |
| NW-Q2-22 | The mid-year view of the annual objectives | Today |

### Q3: the long summer

| ID | Step | Status |
|---|---|---|
| NW-Q3-01 | A deferred issue ranked, not lost | Today, P9-T20 |
| NW-Q3-02 | A space checks in every two weeks | Today (frequency), P9-T19 (streak and ladders) |
| NW-Q3-03 | The margin KPI below its floor | P9-T17 |
| NW-Q3-04 | The recovery proposed, drafted and corrected | P9-T18. The double-count flag needs the AI provider on |
| NW-Q3-05 | Recovery progress beside the real band | P9-T17 |
| NW-Q3-06 | Holidays do not break the streak | P9-T19. Personal leave is gap G-2 |
| NW-Q3-07 | Support merges into Customer Success | Gap G-1 |
| NW-Q3-08 | A leader hands over her roles before leave | Today. Leave itself is gap G-2 |
| NW-Q3-09 | A new team's first objective, mid-cycle, aligned by drag | P9-T07b, P9-T10, P9-T12, P9-T13 |
| NW-Q3-10 | A baseline, then a target | P9-T06, P9-T12 |
| NW-Q3-11 | The trend forecast warns before the status changes | P9-T15 |
| NW-Q3-12 | Two milestones done | P9-T12 |
| NW-Q3-13 | The SOC 2 report issued | P9-T12 |
| NW-Q3-14 | Grading; committed misses explained | P9-T14 |
| NW-Q3-15 | Holiday weeks excluded from the measured rhythm | P9-T20 |
| NW-Q3-16 | Retrospective and close | P9-T20 |

### Q4: renewals and the year-end

| ID | Step | Status |
|---|---|---|
| NW-Q4-01 | Planning at the company cap | Today, P9-T03 |
| NW-Q4-02 | A leader returns; roles handed back | Today |
| NW-Q4-03 | Annual planning for 2028 opens | Today |
| NW-Q4-04 | An outage breaks a maintain key result; "fix it now" | P9-T12, P9-T17 |
| NW-Q4-05 | A recovery's KPI turns healthy; closing proposed and declined | P9-T18 |
| NW-Q4-06 | The annual review, before any 2028 drafting | P9-T20 |
| NW-Q4-07 | Board exports; a milestone done | Today, P9-T12 |
| NW-Q4-08 | 2028 annual objectives drafted and published | Today, P9-T03 |
| NW-Q4-09 | Q4 graded | P9-T14 |
| NW-Q4-10 | The recovery closed as achieved | P9-T20, P9-T18 |
| NW-Q4-11 | Unfinished aspirational objectives proposed as Keep | P9-T20 |
| NW-Q4-12 | The scorecard, each column from its own snapshot | P9-T14 |
| NW-Q4-13 | The department level turned off for 2028 | P9-T05. Gap G-3 |
| NW-Q4-14 | Q1 2028 drafted from what was kept | Today |
| NW-Q4-15 | The year's workspace archive | Today |
| NW-Q4-16 | The year's final digest | Today |

## 3. Gaps the year found

Things a realistic year needs that no task builds yet. Each should become a Phase 9 task or a decision before the scenario is complete in the product.

| Gap | What is missing | Steps | Suggested home |
|---|---|---|---|
| G-1 | **Moving a goal to another space.** A reorganisation moves people between spaces today, but their goals cannot follow; `goals.update` changes the level, never the space | NW-Q3-07 | A new task beside P9-T13, since it is a mid-cycle change. It must move check-ins, dependencies and alignment together, and record the move |
| G-2 | **A member on leave.** Nothing holds a person's nudges, routes their reviews or reassigns their check-ins while they are away. Quiet hours cover a day, not eleven weeks | NW-Q3-06, NW-Q3-08 | P9-T19, as part of the escalation and cadence work |
| G-3 | **The "levels in use" setting.** P9-T01 declares it in the registry, but no task makes the level picker, OBJ-5 or the alignment score read it | NW-Q4-13 | P9-T07a for the picker, P9-T16 for alignment |
| G-4 | **A seed that can place the demo at any date of this year.** P9-T22 seeds a current story; this scenario needs every step before a chosen date to be true, including closed cycles graded under their own snapshots | All steps, README §6 | Extend P9-T22 |

## 4. Coverage

Every capability the year exercises, and the steps that exercise it.

| Capability | Steps |
|---|---|
| Practice settings and profiles | NW-P-07, NW-Q1-29, NW-Q2-02, NW-Q2-12, NW-Q2-18, NW-Q3-02, NW-Q4-13 |
| Writing at any time; first cycle inferred | NW-P-02, NW-Q1-07 |
| The planning phases | NW-P-09, NW-P-10, NW-Q1-01 to NW-Q1-03, NW-Q4-03 |
| Committed and aspirational OKRs | NW-P-11, NW-Q1-04, NW-Q1-25, NW-Q1-27, NW-Q2-13, NW-Q4-04 |
| Baseline key results | NW-Q1-05, NW-Q2-15, NW-Q3-09, NW-Q3-10 |
| Milestone key results | NW-Q1-20, NW-Q1-22, NW-Q3-12, NW-Q3-13, NW-Q4-07 |
| Maintain key results | C3.3 and E2.1 through every quarter; NW-Q4-04 |
| Coaching on drafts | NW-P-11, NW-Q1-08, NW-Q1-09, NW-Q1-12, NW-Q2-03 |
| Inline editing in the list | NW-Q1-07, NW-Q1-24, NW-Q2-10 |
| Editing on the diagram | NW-Q1-10, NW-Q2-09, NW-Q3-09 |
| Alignment, standalone goals, dependencies | NW-Q1-10 to NW-Q1-13, NW-Q2-06, NW-Q2-09 |
| Publish gates | NW-P-12, NW-Q1-06 |
| Continue, update, start, stop | NW-Q1-17, NW-Q2-09, NW-Q2-15, NW-Q3-04, NW-Q3-09 |
| Target changes and their reasons | NW-Q1-24, NW-Q2-10, NW-Q2-17, NW-Q3-10 |
| Check-ins, private votes, acknowledgements, Slack | NW-P-03, NW-Q1-15 |
| Nudges and escalation ladders | NW-Q1-16, NW-Q1-19, NW-Q2-08, NW-Q2-13, NW-Q4-04 |
| Blockers | NW-Q1-19, NW-Q1-20 |
| Monthly review | NW-Q1-18, NW-Q1-23, NW-Q2-07, NW-Q2-09, NW-Q2-16 |
| Pace, trend and divergence signals | NW-Q1-21, NW-Q1-23, NW-Q3-11 |
| KPIs, thresholds and recovery | NW-P-13, NW-Q1-17, NW-Q3-03 to NW-Q3-05, NW-Q4-04, NW-Q4-05, NW-Q4-10 |
| Quarterly grading, review and close | NW-P-04, NW-Q1-26 to NW-Q1-31, NW-Q2-19 to NW-Q2-21, NW-Q3-14 to NW-Q3-16, NW-Q4-09 to NW-Q4-11 |
| Annual frame, annual OKRs and the annual review | NW-P-09 to NW-P-12, NW-Q2-17, NW-Q2-22, NW-Q4-03, NW-Q4-06, NW-Q4-08 |
| Scorecard and cycle snapshots | NW-Q1-29, NW-Q4-12 |
| People, access and directory sync | NW-P-05, NW-Q2-04, NW-Q2-11, NW-Q3-08, NW-Q4-02 |
| The two agents | Champion: NW-Q1-01, NW-Q1-16, NW-Q4-16. Coach: NW-Q1-21, NW-Q1-25, NW-Q3-04, NW-Q4-05 |
| AI assists and external agents | NW-Q2-01, NW-Q2-14, NW-Q3-04 |
| Imports, exports and minutes | NW-P-08, NW-Q1-32, NW-Q4-07, NW-Q4-15 |
| Terminology | NW-P-06 |

## 5. With the AI provider off

Every step runs with AI off, except two parts, which degrade as the product promises:
- **NW-Q2-01.** The copilot's draft is not offered; the objective is written by hand and checked the same way.
- **NW-Q3-04.** The semantic review's double-count flag needs the provider. Without it, Hugo removes the duplicate driver himself.

Everything that decides practice, including the policy, the checks, the gates, the scores, the signals, the KPI bands and the diagnostic, is deterministic and identical with AI off.
