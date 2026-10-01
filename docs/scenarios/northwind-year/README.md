# A year of OKRs at Northwind Labs

How one company runs a full year of OKRs in OpenOKR, from planning the year in November 2026 to closing it in December 2027. There are four quarterly cycles, annual OKRs, and company, department and team OKRs aligned to one another. On the way it meets the events real OKR programmes meet: a rollout, a competitor, a crisis, a reorganisation, a leader on leave, a new team, and a year-end.

This is the reference for four kinds of work:

| Used for | How |
|---|---|
| **Knowing how the product is meant to be used** | Read it straight through. Each quarter is a chapter |
| **Testing the code** | Every step has an ID (`NW-Q2-07`) and a Given / When / Then. End-to-end specs and the manual acceptance workbook cite the ID they prove |
| **Running the demo** | The demo seed can be set to any date in the year. §6 lists the dates worth showing and what must be true on each |
| **Writing the user guide** | Each step names the screen and the practice rule it shows. A guide page explains the steps that cite it |

Written on 2 October 2026, against METHOD.md as revised for Phase 9 ([p9-t00-method-v2.md](../../design/p9-t00-method-v2.md)) and the Phase 9 plan ([p9-t00-adaptable-practice.md](../../design/p9-t00-adaptable-practice.md), [p9-t00-okr-writing.md](../../design/p9-t00-okr-writing.md)). Where a step needs something not built yet, it says which task builds it.

## Chapters

| Chapter | Covers |
|---|---|
| [0. Before the year](00-before-the-year.md) | The pilot in Q4 2026, setting up the workspace, importing last year, planning 2027: the annual frame, annual OKRs and the KPI tree |
| [1. Q1: the rollout](01-q1-rollout.md) | The first company-wide cycle: drafting, coaching, peer review, alignment, publishing, the first weeks of check-ins, a KPI that drops, the first close |
| [2. Q2: the competitor](02-q2-competitor.md) | A rival launches in week 6: stopping and starting objectives mid-cycle, a committed key result at risk, a leaver, setting changes, the mid-year revalidation |
| [3. Q3: the long summer](03-q3-summer.md) | Holidays, a recovery OKR for operating margin, a reorganisation, a leader on leave, a new team formed mid-cycle, the SOC 2 report |
| [4. Q4: renewals and the year-end](04-q4-year-end.md) | Renewal season, an incident, planning 2028, the Q4 close, the annual review and the scorecard |
| [5. Scenario index](05-scenario-index.md) | Every step by ID, the feature coverage matrix, and the status of each step against the code |

## 1. The company

**Northwind Labs** sells a business-to-business software platform to mid-market companies of 200 to 2,000 employees, priced per seat, through a sales team backed by a self-serve trial. It is the company the demo seed builds, scaled up to a realistic size.

| Fact | Value at the start of 2027 | Where it comes from |
|---|---|---|
| People | About 180 | This scenario |
| Accounts | About 1,500 | This scenario, consistent with the seed's revenue per account |
| Revenue per account | $1,334 a month | The seed's KPI |
| Annual recurring revenue | About $24 million | 1,500 × $1,334 × 12 |
| Operating margin | 9.1%, against a target of 15% | The seed's KPI |
| Net revenue retention | 100%, against 110% | The seed's KPI |
| Median time to first value | 9 days, against 5 | The seed's KPI |
| What the company believes | Accounts that reach value inside a month renew; accounts that take longer than 90 days churn | The seed's story (DEMO-SCRIPT) |
| What hurts | Support cost per account has grown faster than revenue per account for three quarters, so it cannot hire its way out | The seed's story |

## 2. The cast

The eight people the demo seed creates carry the story. Six more are added by this scenario, each for a part of it, and the seed should create them when it builds this year (P9-T22).

| Person | Role | Reports to | Time zone | Part in the story | In the seed |
|---|---|---|---|---|---|
| **Elena Marsh** | Chief Executive. The demo's administrator seat | Board | Europe/London | Sponsor of every cycle; champion of the profitability objective | Yes, unnamed |
| **Priya Raman** | Chief Product Officer | Elena | Europe/London | Facilitator of every cycle; champion of the first-week objective | Yes |
| **Daniel Osei** | VP Sales | Elena | America/New_York | Sales objectives; leads the competitive response in Q2 | Yes |
| **Tomás Herrera** | Head of Customer Success | Elena | Europe/Madrid | Renewals; takes over Support in the Q3 reorganisation | Yes |
| **Mei Lin** | Head of Engineering | Priya | Asia/Singapore | Platform and in-product answers; on parental leave August to October | Yes |
| **Sara Nasser** | Product Manager, Onboarding | Priya | Europe/London | Onboarding team; the coordinator of the Product space | Yes |
| **Jonas Weber** | Account Executive | Daniel | Europe/Berlin | Writes Sales' first, task-shaped key results; checks in from Slack | Yes |
| **Amara Diallo** | Data Analyst | Elena | Africa/Dakar | Cohort evidence; establishes the baselines nobody measured | Yes |
| **Hugo Lindqvist** | Chief Financial Officer | Elena | Europe/Stockholm | Finance and operations; champion of the margin recovery | Added |
| **Nadia Rahman** | Head of Marketing | Elena | Europe/London | Marketing; aligns diagonally to Sales | Added |
| **Kofi Asante** | Support Lead | Tomás | Africa/Accra | The Support team until it merges into Customer Success | Added |
| **Leo Martins** | Engineering Manager, Platform | Mei | Europe/Lisbon | Platform team; covers Mei's objectives during her leave | Added |
| **Yuki Tanaka** | Product Manager, Growth | Priya | Europe/London | Joins in April; leads the Growth team formed in Q3 | Added, joins mid-year |
| **Ben Carter** | Account Executive | Daniel | America/Chicago | Leaves in May; his key results are reassigned | Added, leaves mid-year |

The two agent members, the **OKR Coach** and the **OKR Champion**, ship with the workspace and run in the default propose mode all year.

## 3. The organisation in OpenOKR

**Spaces.** Northwind renames "Space" to "Team" in its terminology settings during setup, so the screens say Team. This document keeps the product's word.

| Space | Manager | Coordinator | Headcount | Exists |
|---|---|---|---|---|
| Northwind Labs (company) | Elena | Priya | 180 | All year |
| Product | Priya | Sara | 22 | All year |
| Engineering | Mei, then Leo from August to October | Leo | 58 | All year |
| Sales | Daniel | Jonas | 34 | All year |
| Customer Success | Tomás | Tomás | 18, then 40 after the merger | All year |
| Support | Kofi | Kofi | 22 | Until 26 July, then merged into Customer Success |
| Marketing | Nadia | Nadia | 12 | All year |
| Finance and Operations | Hugo | Hugo | 14 | All year |
| Growth | Yuki | Yuki | 5 | From 9 August |

**Levels.** Company, department and team. Individual OKRs are off, as METHOD.md recommends (§2.7: "Individual OKRs are not for everyone and should never be required"). In Q4 Northwind decides to drop the department level for 2028, following Castro's advice to use as few levels as possible.

## 4. Northwind's practice settings

Northwind starts on the **Recommended** profile and changes six settings during the year. Each change is an audited admin action. None of them rewrites a closed cycle, because each cycle keeps the rules it was graded under (METHOD v2 §12).

| When | Setting | From → To | Why | Step |
|---|---|---|---|---|
| December 2026, setup | Terminology: Space | Space → Team | The word the company already uses | NW-P-06 |
| December 2026, setup | Reviewer per goal | Optional (left), used for company and department objectives | Elena reviews company objectives; department heads review team ones | NW-P-07 |
| April, after Q1 | Objectives per unit cap | 3 → 2 | Q1's lowest process-health statement was "few enough OKRs" | NW-Q1-29 |
| April | Critical confidence escalation | Off → On | In Q1 Elena heard about a committed key result at 4 in 10 only at the monthly review | NW-Q2-02 |
| May | Reason when adding mid-cycle | Optional → Required | The competitive response added an objective and four key results in a week | NW-Q2-12 |
| June | Quarterly review format | One session → Review and retrospective separately | Q1's review ran 40 minutes over | NW-Q2-18 |
| July | Check-in frequency, Sales space | Weekly → Every two weeks | Deal cycles move in fortnights; weekly check-ins were repeating themselves | NW-Q3-02 |
| December, for 2028 | Levels in use | Department off | Two levels were enough by year-end | NW-Q4-13 |

## 5. The year at a glance

Quarters follow the calendar. Weekly check-ins are on Mondays. "W3" means week 3 of the quarter.

| When | What | Chapter |
|---|---|---|
| Oct to Dec 2026 | Pilot cycle with Product and Customer Success | 0 |
| 1 Dec 2026 | Workspace set up for everybody; last year's spreadsheets imported | 0 |
| 16 Nov to 18 Dec 2026 | Annual planning for 2027: Phase 0 offsite on 25 November; annual OKRs published 18 December | 0 |
| 7 to 23 Dec 2026 | Q1 company OKRs drafted and published | 1 |
| 4 to 15 Jan 2027 | Q1 team OKRs drafted, peer-reviewed, aligned and shared | 1 |
| Every Monday | Weekly check-ins; the Champion's digest on Friday | all |
| First Monday of each month | Monthly review: continue, update, start, stop | all |
| 15 to 19 Mar | Q1 graded and reviewed, two weeks before the end | 1 |
| 10 May (Q2 W6) | The competitor launches; the competitive response | 2 |
| 7 Jun | Mid-year revalidation of the annual frame | 2 |
| 14 to 18 Jun | Q2 review, then retrospective, as two sessions | 2 |
| Jul to Aug | Holidays; the margin recovery; the Support merger; Mei on leave; Growth formed | 3 |
| 10 Sep | SOC 2 Type II report issued | 3 |
| 13 to 17 Sep | Q3 graded and reviewed | 3 |
| 19 Nov to 17 Dec | Annual planning for 2028: the annual review of 2027 on 8 December, before any drafting | 4 |
| 3 Dec | A four-hour outage | 4 |
| 13 to 16 Dec | Q4 graded, reviewed and closed; the scorecard | 4 |

## 6. Dates worth showing in the demo

The demo seed is built relative to the day it runs (P8-T13b). P9-T22 makes it able to place "today" at any of these points of the year, with everything before it already true.

| Demo date | What a visitor sees | Steps that must already be true |
|---|---|---|
| Q1 W2 (12 January) | Team drafting in progress: coach warnings on Sales' task-shaped key results, an objective with no parent, Engineering over its cap | NW-P-01 to NW-Q1-11 |
| Q1 W6 (8 February) | A running quarter: a confidence drop, a blocker, a key result added mid-cycle for a KPI that dropped | Up to NW-Q1-19 |
| Q2 W7 (17 May) | The week after the competitor: a stopped objective, a started one, a lowered target with its reason, a committed key result escalated | Up to NW-Q2-14 |
| Q3 W4 (26 July) | The margin recovery running beside its real KPI band; the Support merger; holidays not breaking the streak | Up to NW-Q3-07 |
| 16 December | The year closed: the annual review, the scorecard across four quarters, 2028 planned | The whole year |

## 7. Why this is realistic

This scenario does not invent the shape of an OKR year. Each beat follows a published practice or a documented case. Sources marked *primary* are the company's or the author's own words.

| Beat in the year | What it follows | Source |
|---|---|---|
| Annual goals set before the year, then reviewed every quarter; the board sees them at the turn of each quarter | GitLab's "Yearlies": annual goals "reviewed every quarter", quarterly OKRs "reviewed every month". Atlassian: "set OKRs annually, refresh them each quarter, and track progress monthly" | GitLab handbook, commit-pinned copy, *primary*: gitlab.com/gitlab-com/content-sites/handbook/-/blob/41c68411/content/handbook/company/cadence.md. Atlassian, *primary*: atlassian.com/team-playbook/plays/okrs |
| Company OKRs drafted from about six weeks before the quarter and published before it starts; team OKRs in its first two weeks | GitLab: "Six Mondays before the start of the fiscal quarter, the CEO and Chief of Staff … initiate the OKR process". whatmatters' typical cycle: company OKRs "2 weeks before quarter", teams at the start, contributors a week later. Wodtke: "If you cannot set OKRs in less than two weeks, you will want to examine your priorities" | GitLab, commit-pinned, *primary*: …/handbook/-/blob/f45ba29a/content/handbook/company/okrs/_index.md. whatmatters.com/resources/a-typical-okr-cycle, *primary*. cwodtke.com/the-timing-of-okrs, *primary* |
| A pilot first; expecting maturity only after several cycles | Microsoft's rollout guide: leaders first, managers after a successful first quarter, individuals after another. Doerr: "up to four or five quarterly cycles to fully embrace the system" | learn.microsoft.com/en-us/viva/goals/determine-your-rollout-plan, *primary*. *Measure What Matters*, via a reader's highlight on Goodreads |
| Last year's grades and the new OKRs shown together at the start of the year | Google: "At the start of the year, there is a company-wide meeting where the grades for the prior OKRs are shared and the new OKRs are shared" | rework.withgoogle.com/en/guides/set-goals-with-okrs, *primary* |
| Q1's too-many objectives and task-shaped key results | MyFitnessPal's "cornucopia of company OKRs". GitLab: "Avoid ❌ KR2: Ship 10 components… Instead ✅ KR2: 30% of GitLab users are able to use X" | *Measure What Matters*, via Goodreads. GitLab okrs-basics, commit-pinned, *primary* |
| Committed and aspirational OKRs; a committed key result escalated the same week | Google: "Teams who cannot credibly promise to deliver a 1.0 on a committed OKR must escalate promptly." GitLab: the sponsor and the owner have a "joint obligation to proactively flag the issue" | whatmatters.com/resources/google-okr-playbook, *primary*. GitLab handbook, *primary* |
| Dependencies confirmed before team OKRs are final | GitLab: "KRs with dependencies should not be considered final until other teams have confirmed support", and "It is OK to push back on OKRs" | GitLab handbook, commit-pinned, *primary* |
| The competitor in Q2 week 6, answered within the week | Intel's Operation Crush: "Within a week, the executive staff met… One week after that, a blue-ribbon task force convened." Doerr: "Start: Launch a new OKR mid-cycle, whenever the need arises." Google's and OpenAI's "code red" responses reassigned teams and delayed other work | whatmatters.com/okrs-explained/john-doerr-operation-crush, *primary*. 9to5google.com, 2022, and fortune.com, 2025, both secondary |
| Lowering a target only for a change in the world, never because it got hard | GitLab: "Iteration does not mean changing or lowering goal posts" | GitLab handbook, *primary* |
| A KPI that drops becomes an OKR | GitLab: "If you want to change a KPI in a quarter this typically will be an OKR." Wodtke's weekly check-in protects named health metrics | GitLab handbook, *primary*. cwodtke.com/monday-commitments-and-friday-wins, *primary* |
| The Support merger: the merged team writes new OKRs rather than inheriting both sets | whatmatters: "A new team doesn't automatically inherit old OKRs", and resetting after a reorganisation is "very similar to the end of a cycle" | whatmatters.com/faqs/dear-andy-realign-your-team-with-okrs-after-staff-reductions, *primary* |
| Roughly half of team OKRs proposed bottom-up | "Healthy organizations aim to have half of their goals come from the bottom-up" | whatmatters.com/faqs/bottom-up-okrs-definition-examples, *primary* |
| No individual OKRs; scores kept out of pay | Spotify dropped individual OKRs in 2013. Grove: an OKR "is not a legal document upon which to base a performance review" | Spotify HR blog, 2016, secondary (the page could not be fetched). *Measure What Matters*, via Goodreads |
| Scores improving across the first year | One vendor's benchmark reports completion averaging 51% in cycles 1 and 2 and 79% from cycle 5. The method is undisclosed, so treat it as an indication only | okrstool.com/blog/okr-benchmark-report, vendor |

Two cautions:
- **GitLab's material is from its history, not its live site.** GitLab moved its OKR process out of the public handbook in 2025 and 2026, so its quotes come from commit-pinned copies of the handbook.
- **One widely repeated statistic is left out.** The claim that "70% of companies abandon OKRs within two years" traces to vendor blogs with no stated method, so this scenario does not use it.

## 8. Conventions

| Convention | Meaning |
|---|---|
| `NW-P-01` | Before the year (prelude) |
| `NW-Q1-01` to `NW-Q4-nn` | Steps in each quarter, in date order |
| **Screen** | The UIUX-PLAN screen number and route, for example S-13 `/goals` |
| **Rule** | The METHOD.md section (revised text) the step exercises |
| **Status** | **Today**: works in the product now. **P9-Tnn**: arrives with that Phase 9 task. **Gap**: no task builds it yet; [05-scenario-index.md](05-scenario-index.md) §3 lists every gap |
| Numbers | Every value is consistent across chapters: a key result that ends Q1 at 7 days starts Q2 there |
