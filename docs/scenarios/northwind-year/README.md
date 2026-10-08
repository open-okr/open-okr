# A year of OKRs at Northwind Labs

How one company runs a full year of OKRs in OpenOKR, from a pilot in the autumn of 2026 to closing the year in December 2027. There are four quarterly cycles, annual OKRs, and company, department and team OKRs aligned to one another. On the way it meets the events real OKR programmes meet: a rollout, a competitor, a crisis, a reorganisation, a leader on leave, a new team, and a year-end.

This is the reference for four kinds of work:

| Used for | How |
|---|---|
| **Knowing how the product is meant to be used** | Read it straight through. Each quarter is a chapter |
| **Testing the code** | Every step has an ID (`NW-Q2-07`) and a Given / When / Then. End-to-end specs and manual tests cite the ID they prove |
| **Running the demo** | §6 lists the dates worth showing and what is true on each. The demo seed builds the year as of today, so the public demo moves through them with the calendar |
| **Writing the user guide** | Each step names the screen and the practice rule it shows. A guide page explains the steps that cite it |

Written against [METHOD.md](../../specification/METHOD.md) and the designs it relies on, [adaptable-practice.md](../../design/adaptable-practice.md) and [okr-writing.md](../../design/okr-writing.md).

## Chapters

| Chapter | Covers |
|---|---|
| [0. Before the year](00-before-the-year.md) | The pilot in Q4 2026, the upgrade to 0.2.0, setting up the workspace, importing last year, planning 2027: the annual frame, annual OKRs and the KPI tree |
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
| What the company believes | Accounts that reach value inside a month renew; accounts that take longer than 90 days churn | The seed's story |
| What hurts | Support cost per account has grown faster than revenue per account for three quarters, so it cannot hire its way out | The seed's story |

## 2. The cast

Elena, who registers the workspace, and the seven people the demo seed creates carry the story. Six more are added by this scenario, each for a part of it, and the seed creates them when it builds this year (P9-T22). That is fourteen in all, the cast the manual workbook's "Year" sheet uses.

| Person | Role | Reports to | Time zone | Part in the story | In the seed |
|---|---|---|---|---|---|
| **Elena Marsh** | Chief Executive. Registers the workspace | Board | Europe/London | Sponsor of every cycle; champion of the profitability objective | The registrant's seat, unnamed |
| **Priya Raman** | Chief Product Officer | Elena | Europe/London | Facilitator of every cycle; champion of the first-week objective | Yes |
| **Daniel Osei** | VP Sales | Elena | America/New_York | Sales objectives; leads the competitive response in Q2 | Yes |
| **Tomás Herrera** | Head of Customer Success | Elena | Europe/Madrid | Renewals; takes over Support in the Q3 reorganisation | Yes |
| **Mei Lin** | Head of Engineering | Priya | Asia/Singapore | Platform and in-product answers; on parental leave from 2 August to 25 October | Yes |
| **Sara Nasser** | Product Manager, Onboarding | Priya | Europe/London | Onboarding team; the coordinator of the Product space | Yes |
| **Jonas Weber** | Account Executive | Daniel | Europe/Berlin | Writes Sales' first, task-shaped key results; checks in from Slack | Yes |
| **Amara Diallo** | Data Analyst | Elena | Africa/Dakar | Cohort evidence; establishes the baselines nobody measured | Yes |
| **Hugo Lindqvist** | Chief Financial Officer | Elena | Europe/Stockholm | Finance and operations; champion of the margin recovery | Added |
| **Nadia Rahman** | Head of Marketing | Elena | Europe/London | Marketing; aligns diagonally to Sales | Added |
| **Kofi Asante** | Support Lead | Elena, then Tomás from 26 July | Africa/Accra | The Support team until it merges into Customer Success | Added |
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

**Levels.** Company, department and team. Individual OKRs are off, as METHOD.md recommends (§2.7: "Individual OKRs are not for everyone and should never be required"). In Q4 Northwind decides to drop the department level for 2028, following Castro's advice to use as few levels as possible. P9-T01 declares that setting, and P9-T07a and P9-T16 make the screens read it.

## 4. Northwind's practice settings

Northwind lands on the **Recommended** profile when it upgrades to 0.2.0 (NW-P-07), and makes eight changes during 2027. Each change is an audited admin action. None of them rewrites a closed cycle, because each cycle keeps the rules it was graded under (METHOD §12).

| When | Setting | From → To | Why | Step |
|---|---|---|---|---|
| 25 Nov 2026, setup | Terminology: Space | Space → Team | The word the company already uses | NW-P-06 |
| 2 Dec 2026, setup | Reviewer per goal | Left at Optional; used for company and department objectives, not team ones | Elena reviews company objectives and department heads review department ones; a team's weekly check-in is review enough | NW-P-09 |
| 2 Apr, after Q1 | Objectives per unit cap | 3 → 2 | Q1's lowest process-health statement was "few enough OKRs" | NW-Q1-29 |
| 2 Apr | Critical confidence escalation | Off → On | Elena heard about C1.3 at 3 in 10 only at the monthly review, three weeks late | NW-Q2-02 |
| 2 Apr | OBJ-1, objective starts with a deliverable | Warn → Block | Q1's first drafts were full of deliverables; Elena tries the stricter level for a quarter | NW-Q2-03 |
| 14 May | Reason when adding mid-cycle | Optional → Required | The competitive response added an objective and four key results in a week | NW-Q2-13 |
| 7 Jun | Quarterly review format | One session → Review and retrospective separately | Q1's review ran 40 minutes over | NW-Q2-18 |
| Late June, for Q3 | OBJ-1, objective starts with a deliverable | Block → Warn | In Q2 it cost a week of rewrites and one override, for little gain over the warning | NW-Q3-01 |
| 1 Jul | Check-in frequency, Sales space | Weekly → Every two weeks | Deal cycles move in fortnights; weekly check-ins were repeating themselves | NW-Q3-02 |
| 17 Dec, for 2028 | Levels in use | Department off | Department objectives mostly restated a team's or the company's | NW-Q4-13 |

## 5. The year at a glance

Quarters follow the calendar. Weekly check-ins are on Mondays. "W3" means week 3 of the quarter.

| When | What | Chapter |
|---|---|---|
| 28 Sep 2026 | Elena registers the workspace | 0 |
| 1 Oct to 14 Dec 2026 | Pilot cycle with Product and Customer Success, on 0.1.2; its review on 14 December | 0 |
| 20 Nov to 18 Dec 2026 | Annual planning for 2027: planning opens 20 November; single sign-on, directory sync and Slack 25 November; the upgrade to 0.2.0 on 30 November; the offsite 1 December; 2026 imported 3 December; annual OKRs published 18 December | 0 |
| 4 to 23 Dec 2026 | Q1 planning opens; the company OKRs drafted and published, the first step | 1 |
| 4 to 15 Jan 2027 | Q1 department and team OKRs drafted, peer-reviewed on 12 January, aligned and published, the second step | 1 |
| Every Monday | Weekly check-ins; the Champion's digest on Friday | all |
| First Monday of each month | Monthly review: continue, update, start, stop | all |
| 15 to 18 Mar | Q1 graded, then reviewed and closed in one session, two weeks before the end | 1 |
| 10 May (Q2 W6) | The competitor launches; leadership responds on 12 May | 2 |
| 14 to 18 Jun | Q2 graded; the review on 16 June and the retrospective on 18 June | 2 |
| 21 Jun | Mid-year revalidation of the annual frame | 2 |
| Jul to Aug | The margin recovery; the Support merger on 26 July; Mei on leave from 2 August; Growth formed on 9 August; holiday weeks in August | 3 |
| 10 Sep | SOC 2 Type II report issued | 3 |
| 13 to 16 Sep | Q3 graded, reviewed and closed | 3 |
| 20 Nov to 17 Dec | Annual planning for 2028: the annual review of 2027 on 8 December, before any drafting | 4 |
| 3 Dec | A four-hour outage | 4 |
| 13 to 16 Dec | Q4 graded, reviewed and closed; the scorecard | 4 |
| 17 to 24 Dec | The department level off for 2028; Q1 2028 drafted; the year's archive and final digest | 4 |

## 6. Dates worth showing in the demo

The demo is the year as of today. `pnpm db:seed` places the scenario on the real calendar, its 2027 on the year that holds today and its autumn of 2026 on the year before, each date keeping its distance from its quarter's first Monday so a Monday check-in stays a Monday. Every step dated on or before today is written, and nothing after it, so whatever day a visitor arrives the organisation is exactly as far into its year as the calendar is. The rows below are what a visitor sees when today reaches each point; between them, the year is part of the way from one row to the next. `docs/design/northwind-year-seed.md` records what the seed writes and what it leaves to the running product, such as the agents' messages.

| Demo date | What a visitor sees | Steps that must already be true |
|---|---|---|
| Q1 W2 (11 January) | Team drafting before peer review: coach warnings on Sales' task-shaped key results, Engineering over the cap, a diagonal alignment and a standalone objective with its reason | NW-P-01 to NW-Q1-11 |
| Q1 W6 (8 February) | A running quarter: a key result added mid-cycle for a KPI that dropped, a confidence drop, a blocker with its next action | Up to NW-Q1-19 |
| Q2 W7 (17 May) | The week after the competitor: a stopped objective, a started one, a kind changed openly, an eased target with its reason, a committed key result escalated, a draft check-in from an AI assistant | Up to NW-Q2-15, with NW-Q2-12 under way: Ben's last day is 21 May |
| Q3 W7 (16 August) | The margin recovery beside its real KPI band, Support merged into Customer Success, Leo covering for Mei, the new Growth team, a holiday week with no check-in due, and a trend warning before the status changes | Up to NW-Q3-10, with NW-Q3-05 and NW-Q3-06 under way |
| 24 December | The year closed: the annual review, four quarters on one scorecard, 2028's annual OKRs published and Q1 2028 drafted | The whole year |

## 7. Why this is realistic

This scenario does not invent the shape of an OKR year. Each beat follows a published practice or a documented case. Sources marked *primary* are the company's or the author's own words.

| Beat in the year | What it follows | Source |
|---|---|---|
| Annual goals set before the year, then reviewed every quarter; the board sees them at the turn of each quarter | GitLab's "Yearlies": annual goals "reviewed every quarter", quarterly OKRs "reviewed every month". Atlassian: "set OKRs annually, refresh them each quarter, and track progress monthly" | GitLab handbook, commit-pinned copy, *primary*: gitlab.com/gitlab-com/content-sites/handbook/-/blob/41c68411/content/handbook/company/cadence.md. Atlassian, *primary*: atlassian.com/team-playbook/plays/okrs |
| Planning opened weeks before the quarter, company OKRs published before it starts, team OKRs in its first two weeks | GitLab: "Six Mondays before the start of the fiscal quarter, the CEO and Chief of Staff … initiate the OKR process". whatmatters' typical cycle: company OKRs "2 weeks before quarter", teams at the start, contributors a week later. Wodtke: "If you cannot set OKRs in less than two weeks, you will want to examine your priorities" | GitLab, commit-pinned, *primary*: …/handbook/-/blob/f45ba29a/content/handbook/company/okrs/_index.md. whatmatters.com/resources/a-typical-okr-cycle, *primary*. cwodtke.com/the-timing-of-okrs, *primary* |
| A pilot first; expecting maturity only after several cycles | Microsoft's rollout guide: leaders first, managers after a successful first quarter, individuals after another. Doerr: "up to four or five quarterly cycles to fully embrace the system" | learn.microsoft.com/en-us/viva/goals/determine-your-rollout-plan, *primary*. *Measure What Matters*, via a reader's highlight on Goodreads |
| Last year's grades and the new OKRs shown together at the start of the year | Google: "At the start of the year, there is a company-wide meeting where the grades for the prior OKRs are shared and the new OKRs are shared" | rework.withgoogle.com/en/guides/set-goals-with-okrs, *primary* |
| Q1's too-many objectives and task-shaped key results | MyFitnessPal's "cornucopia of company OKRs". GitLab: "Avoid ❌ KR2: Ship 10 components… Instead ✅ KR2: 30% of GitLab users are able to use X" | *Measure What Matters*, via Goodreads. GitLab okrs-basics, commit-pinned, *primary* |
| Committed and aspirational OKRs; a committed key result escalated the same week | Google: "Teams who cannot credibly promise to deliver a 1.0 on a committed OKR must escalate promptly." GitLab: the sponsor and the owner have a "joint obligation to proactively flag the issue" | whatmatters.com/resources/google-okr-playbook, *primary*. GitLab handbook, *primary* |
| Dependencies confirmed before team OKRs are final | GitLab: "KRs with dependencies should not be considered final until other teams have confirmed support", and "It is OK to push back on OKRs" | GitLab handbook, commit-pinned, *primary* |
| The competitor in Q2 week 6, answered within the week | Intel's Operation Crush: "Within a week, the executive staff met… One week after that, a blue-ribbon task force convened." Doerr: "Start: Launch a new OKR mid-cycle, whenever the need arises." Google's and OpenAI's "code red" responses reassigned teams and delayed other work | whatmatters.com/okrs-explained/john-doerr-operation-crush, *primary*. 9to5google.com, 2022, and fortune.com, 2025, both secondary |
| Easing a target only for a change in the world, never because it got hard | GitLab: "Iteration does not mean changing or lowering goal posts" | GitLab handbook, *primary* |
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
| Numbers | Every value is consistent across chapters: a key result that ends Q1 at 7 days starts Q2 there |
