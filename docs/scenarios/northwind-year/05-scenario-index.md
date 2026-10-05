# 5. Scenario index

Every step in the year, by ID, with whether the product can do it today. Use this page to choose the steps an end-to-end spec, a manual test, a demo or a guide page covers.

Each Phase 9 task card in IMPLEMENTATION-PLAN.md lists the steps it must make true, so this page and the plan check each other: a step's status names a task, and that task's card names the step.

## 1. How to use the IDs

| For | Do this |
|---|---|
| **An end-to-end spec** | Name the steps it proves in its describe block, for example `test.describe("NW-Q2-10: stop, start, re-parent and change kind mid-cycle")`, and assert the step's Then clause. A step marked with a task is that task's acceptance test |
| **The manual workbook** (`docs/testing`) | Add a "Year" sheet whose rows are step IDs, using the cast of fourteen: the seven Northwind personas the workbook already has, Elena in the registrant's seat, and the six this scenario adds |
| **The demo** | Choose one of the dates in the [README](README.md) §6. Everything before that date must be true in the seed |
| **The user guide and handbook** | When a guide page explains a step, link the step's ID from the page, so the guide and the scenario stay in step |

## 2. Every step

**Status**: **Today** means the product does it now. A task name means it arrives with that Phase 9 task. A gap (§3) means no task builds it yet.

### Before the year

| ID | Step | Status |
|---|---|---|
| NW-P-01 | Elena signs up; Priya made an administrator | Today |
| NW-P-02 | The pilot on 0.1.2 must declare a first cycle before drafting | Today |
| NW-P-03 | Pilot check-ins; 0.1.2's same-day escalation at 0.3 | Today |
| NW-P-04 | Annual planning opens; the input pack | Today |
| NW-P-05 | Single sign-on, directory sync, Slack | Today |
| NW-P-06 | "Space" renamed "Team" | Today |
| NW-P-07 | The upgrade to 0.2.0: the recommended profile, nothing lost, the first cycle inferred | P9-T22, P9-T02 |
| NW-P-08 | The annual frame, priorities with 12-month success statements, the not-doing list | Today |
| NW-P-09 | Practice settings at their defaults; reviewers where Northwind wants them | P9-T05, P9-T04 |
| NW-P-10 | Annual objectives drafted, committed and aspirational | P9-T03a, P9-T11 |
| NW-P-11 | 2026 spreadsheets imported, kinds mapped | Today, P9-T12 |
| NW-P-12 | KPI target types and their own thresholds, including a range | P9-T17 |
| NW-P-13 | The pilot's review feeds Q1 | P9-T20 |
| NW-P-14 | The annual set publishes | P9-T03b |
| NW-P-15 | Q1's whole rhythm booked in advance | Today |

### Q1: the rollout

| ID | Step | Status |
|---|---|---|
| NW-Q1-01 | Planning opens four weeks ahead | P9-T19a |
| NW-Q1-02 | Phase 2 after the pilot's review | Today |
| NW-Q1-03 | Quarterly revalidation, no annual-only checks | Today |
| NW-Q1-04 | Company objectives drafted by kind | P9-T11 |
| NW-Q1-05 | The company step publishes | P9-T03b |
| NW-Q1-06 | Adding inline; Escape discards an empty draft | P9-T07b |
| NW-Q1-07 | A baseline key result passes | P9-T12 |
| NW-Q1-08 | Task-shaped key results warn, never refused | P9-T03a |
| NW-Q1-09 | Too many objectives warns | P9-T03a |
| NW-Q1-10 | Aligning across departments by drag; no level-skip message | P9-T10, P9-T16 |
| NW-Q1-11 | Standing alone with a reason | P9-T16 |
| NW-Q1-12 | Peer review: rewrites, two edits at once, a duplicate deleted | Today, P9-T06, P9-T07a |
| NW-Q1-13 | Dependencies confirmed; alignment health | Today, P9-T16 |
| NW-Q1-14 | The team step publishes; an aspirational key result may exceed capacity, a committed one would warn | P9-T03b, P9-T11, P9-T13 |
| NW-Q1-15 | First check-ins; acknowledgements only where a reviewer exists | Today, P9-T04 |
| NW-Q1-16 | A late check-in and its three nudges | Today |
| NW-Q1-17 | A KPI turns unhealthy; a key result added mid-cycle | P9-T17, P9-T18, P9-T13 |
| NW-Q1-18 | The monthly review's decision log | Today, P9-T13 |
| NW-Q1-19 | A confidence drop tells the coordinator, not the sponsor | P9-T19a |
| NW-Q1-20 | A milestone done satisfies a dependency | P9-T12 |
| NW-Q1-21 | Reported health disagrees with the data | P9-T15 |
| NW-Q1-22 | A milestone done early | P9-T12, P9-T15 |
| NW-Q1-23 | The pace-aware signal and the trend forecast | P9-T15 |
| NW-Q1-24 | Easing a reduce target without a reason is refused | P9-T06, P9-T07a |
| NW-Q1-25 | A committed key result below the floor escalates | P9-T11 |
| NW-Q1-26 | A score adjusted with a reason; both numbers kept | P9-T14 |
| NW-Q1-27 | The 90-minute review; committed misses explained before scoring closes | P9-T20 |
| NW-Q1-28 | Root causes by kind | P9-T20 |
| NW-Q1-29 | Process health to an action; a cap changed after close | P9-T20, P9-T14 |
| NW-Q1-30 | The diagnostic reads results delivered | P9-T20 |
| NW-Q1-31 | Close decisions; kept objectives pre-fill with last values | P9-T20 |
| NW-Q1-32 | The minutes, with committed and aspirational reported apart | P9-T20 |

### Q2: the competitor

| ID | Step | Status |
|---|---|---|
| NW-Q2-01 | Kept objectives pre-filled; the copilot drafts one | Today (copilot), P9-T20 |
| NW-Q2-02 | Critical escalation turned on | P9-T05, P9-T19a |
| NW-Q2-03 | OBJ-1 raised to block | P9-T05, P9-T03a, P9-T03b |
| NW-Q2-04 | The cap of two warns at a third | P9-T03a |
| NW-Q2-05 | A new hire provisioned; she follows a goal | Today |
| NW-Q2-06 | The team step refused by OBJ-1; one rewrite, one override | P9-T03b |
| NW-Q2-07 | An unconfirmed dependency escalated | P9-T16 |
| NW-Q2-08 | Monthly review | Today |
| NW-Q2-09 | A check-in at 3 in 10 reaches the sponsor the same day | P9-T19a |
| NW-Q2-10 | Start, stop, re-parent to an annual objective, change kind; both views update | P9-T13, P9-T10, P9-T11 |
| NW-Q2-11 | A target eased with a valid reason; the original kept | P9-T06, P9-T07a |
| NW-Q2-12 | A leaver suspended; their key results reassigned | Today |
| NW-Q2-13 | Reasons for additions made required | P9-T05, P9-T13 |
| NW-Q2-14 | A committed key result escalated twice the same day | P9-T11, P9-T19a |
| NW-Q2-15 | An external AI assistant reads, and saves a draft check-in | Today |
| NW-Q2-16 | A baseline recorded, then its target added | P9-T12, P9-T13 |
| NW-Q2-17 | Monthly review | Today |
| NW-Q2-18 | The review split into two sessions | P9-T05, P9-T20 |
| NW-Q2-19 | Grading: an eased target beside its original; stopped objectives left out | P9-T14 |
| NW-Q2-20 | The review session, stages 1 to 4 | P9-T20 |
| NW-Q2-21 | The retrospective, stages 5 to 11; the diagnostic as a hypothesis; Defer | P9-T20 |
| NW-Q2-22 | Mid-year revalidation: an annual target eased, a not-doing item removed | P9-T13 |
| NW-Q2-23 | The mid-year view of the annual objectives | Today |

### Q3: the long summer

| ID | Step | Status |
|---|---|---|
| NW-Q3-01 | A deferred issue ranked, not lost; OBJ-1 back to warn | Today, P9-T20, P9-T05 |
| NW-Q3-02 | A space checks in every two weeks | Today (frequency), P9-T19a |
| NW-Q3-03 | Two KPIs below their floors for a second month | P9-T17 |
| NW-Q3-04 | Two proposals; a recovery drafted and corrected; a driver as a key result | P9-T18 |
| NW-Q3-05 | Recovery progress beside the real band | P9-T17 |
| NW-Q3-06 | Holidays and a week of leave: no check-in due, no nudge, no broken streak | P9-T19b |
| NW-Q3-07 | Support merges into Customer Success; SU1 moves with it | Today (people), P9-T13a |
| NW-Q3-08 | A leader hands over her roles and marks her leave with a delegate | Today (roles), P9-T19b |
| NW-Q3-09 | A new team's first objective, mid-cycle, aligned with the keyboard | P9-T07b, P9-T10, P9-T12, P9-T13 |
| NW-Q3-10 | The trend forecast warns before the status changes | P9-T15 |
| NW-Q3-11 | A key result added mid-cycle is live once complete, a draft if not | P9-T12, P9-T13 |
| NW-Q3-12 | Two milestones done | P9-T12 |
| NW-Q3-13 | The SOC 2 report issued early | P9-T12 |
| NW-Q3-14 | Grading; four committed misses explained | P9-T14 |
| NW-Q3-15 | The review session | P9-T20 |
| NW-Q3-16 | The retrospective; holiday weeks out of the measured rhythm | P9-T20, P9-T19b |

### Q4: renewals and the year-end

| ID | Step | Status |
|---|---|---|
| NW-Q4-01 | Planning at the company cap; objectives moved between levels by close decision | P9-T19a, P9-T20, P9-T03b |
| NW-Q4-02 | A leader returns; roles handed back | Today |
| NW-Q4-03 | Annual planning for 2028 opens | Today |
| NW-Q4-04 | An outage: a range KPI, a maintain key result, "fix it now", a committed check-in at 3 | P9-T12, P9-T17, P9-T18, P9-T11, P9-T19a |
| NW-Q4-05 | A recovery's KPI turns healthy; closing proposed once and dismissed | Today |
| NW-Q4-06 | The annual review, before any 2028 drafting | P9-T20 |
| NW-Q4-07 | The scorecard as CSV and the minutes for the board; a milestone done | Today, P9-T12 |
| NW-Q4-08 | 2028 annual objectives drafted and published | Today, P9-T03b |
| NW-Q4-09 | Q4 graded; two committed misses explained | P9-T14 |
| NW-Q4-10 | The review session; no "too safe" note | P9-T20 |
| NW-Q4-11 | The retrospective; the recovery closed; carry-forward proposed | P9-T20, P9-T18 |
| NW-Q4-12 | The scorecard, each column from its own snapshot | P9-T14 |
| NW-Q4-13 | The department level turned off for cycles from 2028 | P9-T05, P9-T07a, P9-T16 |
| NW-Q4-14 | Q1 2028 drafted from what was kept | P9-T20 |
| NW-Q4-15 | The year's workspace archive | Today |
| NW-Q4-16 | The year's final digest names the wins | P9-T19a |

## 3. Gaps the year found

Four things a realistic year needed that no task built. Akmal agreed on 2 October 2026 where each belongs, and they joined the plan in P9-T01's commit. A fifth, G-5, was found while building P9-T12c-a on 5 October 2026 and waits for a decision on where it belongs. The table stays as the record of why those tasks grew.

| Gap | What was missing | Steps | Now built by |
|---|---|---|---|
| G-1 | **Moving a goal to another space.** A reorganisation moves people between spaces today, but their goals cannot follow: `goals.update` changes the level, never the space | NW-Q3-07 | P9-T13a, with METHOD v2 §2.9's "When the organisation changes" |
| G-2 | **A member on leave.** Nothing holds a person's nudges, routes their reviews or covers their check-ins while they are away. Quiet hours cover a day, not eleven weeks | NW-Q3-06, NW-Q3-08 | P9-T19b, with METHOD v2 §7.4's leave and delegate |
| G-3 | **The "levels in use" setting.** P9-T01 declares it, but no task makes the level picker, OBJ-5 or the alignment score read it | NW-Q4-13 | P9-T07a for the picker, with §2.7's first sentence, and P9-T16 for alignment |
| G-4 | **A seed that can place the demo at any date of this year.** P9-T22 seeds a current story; this scenario needs every step before a chosen date to be true, including closed cycles graded under their own snapshots | All steps, README §6 | P9-T22 |
| G-5 | **A dependency that knows the key result providing it.** The register records the providing space and whether it confirmed, not which key result delivers, so nothing can show a dependency as delivered when a milestone is done. Found at P9-T12c-a, which proves the milestone half of the step and leaves this for a human to place | NW-Q1-20 | Unplanned: needs a decision |

## 4. Coverage

Every capability the year exercises, and the steps that exercise it.

| Capability | Steps |
|---|---|
| Upgrading an existing workspace | NW-P-02, NW-P-07 |
| Practice settings and profiles | NW-P-09, NW-Q1-29, NW-Q2-02, NW-Q2-03, NW-Q2-13, NW-Q2-18, NW-Q3-01, NW-Q3-02, NW-Q4-13 |
| Writing at any time; the first cycle inferred | NW-P-07, NW-Q1-06 |
| The planning phases | NW-P-04, NW-P-08, NW-Q1-01 to NW-Q1-03, NW-Q4-03 |
| Publishing in two steps; gates and an override | NW-P-14, NW-Q1-05, NW-Q1-14, NW-Q2-06 |
| Committed and aspirational OKRs, including a change of kind | NW-P-10, NW-Q1-04, NW-Q1-25, NW-Q1-27, NW-Q2-10, NW-Q2-14, NW-Q4-04 |
| Baseline key results | NW-Q1-07, NW-Q2-16, NW-Q3-09, NW-Q3-11 |
| Milestone key results | NW-Q1-20, NW-Q1-22, NW-Q3-12, NW-Q3-13, NW-Q4-07 |
| Maintain key results | E2.1 in every quarter, C3.3 in Q1, C3.1 in Q2, C7.2 in Q4; NW-Q4-04 |
| Coaching on drafts | NW-P-10, NW-Q1-08, NW-Q1-09, NW-Q1-12, NW-Q2-04 |
| Inline editing in the list, concurrent edits, deleting with undo | NW-Q1-06, NW-Q1-12, NW-Q1-24, NW-Q2-11 |
| Editing on the diagram, by pointer and by keyboard; annual parents | NW-Q1-10, NW-Q2-10, NW-Q3-09 |
| Alignment across levels and spaces; standalone goals; dependencies | NW-Q1-10 to NW-Q1-13, NW-Q2-07, NW-Q2-10 |
| Continue, update, start, stop | NW-Q1-17, NW-Q2-10, NW-Q2-16, NW-Q3-04, NW-Q3-09, NW-Q3-11 |
| Target changes, easing and its reasons, on quarterly and annual objectives | NW-Q1-24, NW-Q2-11, NW-Q2-22, NW-Q3-11 |
| Check-ins, private votes, acknowledgements, Slack | NW-P-03, NW-Q1-15 |
| Nudges and escalation ladders | NW-Q1-16, NW-Q1-19, NW-Q2-09, NW-Q2-14, NW-Q4-04 |
| Holidays and leave | NW-Q3-06, NW-Q3-08, NW-Q3-16 |
| Reorganising: moving an objective between spaces | NW-Q3-07 |
| Blockers | NW-Q1-19, NW-Q1-20 |
| Monthly review | NW-Q1-18, NW-Q1-23, NW-Q2-08, NW-Q2-10, NW-Q2-17 |
| Pace, trend and divergence signals | NW-Q1-21, NW-Q1-23, NW-Q3-10 |
| KPIs, thresholds, ranges and recovery | NW-P-12, NW-Q1-17, NW-Q3-03 to NW-Q3-05, NW-Q4-04, NW-Q4-05, NW-Q4-11 |
| Quarterly grading, review and close, in one session and split | NW-P-13, NW-Q1-26 to NW-Q1-31, NW-Q2-19 to NW-Q2-21, NW-Q3-14 to NW-Q3-16, NW-Q4-09 to NW-Q4-11 |
| Annual frame, annual OKRs and the annual review | NW-P-04, NW-P-08, NW-P-10, NW-P-14, NW-Q2-22, NW-Q2-23, NW-Q4-03, NW-Q4-06, NW-Q4-08 |
| Scorecard and cycle snapshots | NW-Q1-26, NW-Q1-29, NW-Q3-01, NW-Q4-12 |
| People, access and directory sync | NW-P-01, NW-P-05, NW-Q2-05, NW-Q2-12, NW-Q3-08, NW-Q4-02 |
| The two agents | Champion: NW-P-04, NW-Q1-01, NW-Q1-16, NW-Q4-16. Coach: NW-Q1-21, NW-Q1-25, NW-Q3-04, NW-Q4-05 |
| AI assists and external agents | NW-Q2-01, NW-Q2-15, NW-Q1-12 and NW-Q3-04 (semantic review) |
| Imports, exports and minutes | NW-P-11, NW-Q1-32, NW-Q4-07, NW-Q4-15 |
| Terminology | NW-P-06 |

## 5. With the AI provider off

Every step runs with AI off, except three parts, which degrade as the product promises:
- **NW-Q2-01.** The copilot's draft is not offered; the objective is written by hand and checked the same way.
- **NW-Q1-12 and NW-Q3-04.** The semantic review's duplicate and double-count flags need the provider. Without it, Sara and Hugo find the duplicates themselves.

Everything that decides practice is deterministic and identical with AI off: the policy, the checks, the gates, the scores, the signals, the KPI bands and the diagnostic.

## 6. What this year does not exercise

Northwind runs the recommended profile, with tweaks. A second scenario should cover the rest:

| Not exercised | Why it belongs elsewhere | Where it is tested instead |
|---|---|---|
| The governed, lightweight, Google-style and Radical Focus profiles; binding phases; the planning window; drafts approved by a reviewer | Each is a different organisation, not a different month at Northwind | P9-T02's profile matrix and P9-T05's per-profile end-to-end spec (robustness rule R8) |
| Hundreds of objectives in one cycle | Northwind has about 25 | P9-T09's measurement on the large dataset (U10) |
| Individual OKRs | Off at Northwind all year | The profile matrix |
