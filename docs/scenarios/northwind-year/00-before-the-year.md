# 0. Before the year: pilot, setup and planning 2027

October to December 2026. Northwind has run OKRs in spreadsheets since 2025, with the usual result: objectives written in January and last updated in week four. In September 2026 Elena decides to move the practice into OpenOKR. She starts with a pilot rather than a rollout, as Wodtke advises ("start with a pilot program"). Then she plans 2027 in the product.

Step format: **ID · date · who · screen · rule · status**, then what happens, then the test.

---

## The pilot (Q4 2026)

**NW-P-01 · 28 Sep 2026 · Priya · S-34 `/welcome` · METHOD v2 §12 · Today**
Priya signs up on the managed cloud and names the workspace "Northwind Labs". Registering is the whole of setup. The workspace starts on the recommended profile with every default in force, and the onboarding steps are all skippable.
*Test:* Given a new registration, when it completes, then the workspace exists, the founder holds full access, both agents are members, and no setting needs choosing before the first objective can be written.

**NW-P-02 · 1 Oct 2026 · Priya · S-04 `/cycle`, S-13 `/goals` · METHOD v2 §2.3, §2.9 · P9-T02**
The pilot runs with two spaces only, Product and Customer Success. Priya invites Sara, Mei, Amara and Tomás. Q4 2026 is created automatically.
- **No earlier cycle exists**, so Phase 2's "prior cycle scored" is met by inference. Nobody has to tick a box.
- **Writing is open at once.** Sara writes the Onboarding team's objective in the first week of the quarter.
*Test:* Given a workspace with no earlier cycle, when Phase 2 is evaluated, then "first cycle" holds without being declared, and a member can create an objective in Q4 2026 on day one.

**NW-P-03 · Oct to Nov 2026 · Sara, Tomás · S-15 `/check-in`, S-22 · METHOD v2 §7.2, §3.2 · Today; the low-band alert is P9-T19**
The pilot spaces check in every Monday. Confidence is given as "x in 10". The Champion reminds anyone who has not checked in by the anchor day, and posts the weekly digest. In week 5 Tomás's confidence on renewals flagged 90 days out falls from 7 to 4. He writes one line on why, and names a next action due by the following Monday.
*Test:* Given a pilot key result checked in at 7 in 10, when the next check-in records 4 in 10, then the coordinator is told that it fell into the low band, and the check-in asks for a next action due by the next check-in.

**NW-P-04 · 14 Dec 2026 · Priya, Tomás, Sara · S-24 `/session/[id]` · METHOD v2 §8 · Today**
The pilot closes with a quarterly review. The pilot scores 0.55. The room's two learnings:
- "We learned that four key results per objective was too many to discuss in thirty minutes."
- "We learned that the weekly session is where the value is, not the dashboard."

Both feed Q1's input pack.
*Test:* Given the pilot cycle closed, when Q1 2027's Phase 1 is opened, then the pilot's scores and learnings appear in its input pack and its prior-cycle scoring list.

## Setting up for everybody

**NW-P-05 · 1 Dec 2026 · Elena, Priya · S-36 `/admin/sso`, `/admin/directory`, `/admin/channels` · Today**
Elena connects single sign-on to the company's identity provider and turns on directory sync. Directory sync provisions about 180 people as members, and the leaders are added to their spaces. Slack is connected for Sales and Customer Success; everyone else uses email. Each member's quiet hours default from their time zone.
*Test:* Given directory sync on, when a person is added to the identity provider's "Northwind" group, then they appear as a member with standard access within the sync interval, and their first sign-in uses single sign-on.

**NW-P-06 · 1 Dec 2026 · Priya · S-36 `/admin/rhythm` (terminology) · Today**
Northwind calls its teams "teams". Priya renames "Space" to "Team" in terminology. Every screen, email and Slack message now says Team. Bahasa Melayu readers keep their own word, because a rename is the organisation's word, not a translation.
*Test:* Given the label "Team" for Space, when any screen lists spaces, then it says "Teams", and the API keeps the stored name `space`.

**NW-P-07 · 2 Dec 2026 · Elena · S-36 practice settings · METHOD v2 §12 · P9-T05**
Elena keeps the recommended profile. She looks at the reviewer setting, which is "Optional" by default, and decides to use reviewers on company and department objectives only: she reviews company objectives, and department heads review their teams'. Strict mode stays off, phase enforcement stays guided, and anybody can write at any time.
*Test:* Given the recommended profile, when the practice settings screen opens, then it shows every setting at its default, with no "differs from profile" markers, and the audit log holds no practice change yet.

**NW-P-08 · 3 Dec 2026 · Amara · S-36 `/admin/imports` · Today**
Amara imports the 2026 spreadsheets: three quarters of objectives and key results with their final values. She runs a dry run first. Three rows name an owner who has left. She maps them to Priya and runs it for real. The report reconciles every row. The history becomes context in Q1's input pack, item 2, "Prior cycle OKRs with scores".
*Test:* Given the 2026 spreadsheet, when the dry run reports three rows with unknown owners and they are mapped, then the real run writes exactly what the dry run reported, and a second run changes nothing.

## Planning 2027

Annual planning opens six weeks before the year (METHOD v2 §11, "Planning-open lead"). Northwind follows the annual timeline in METHOD v2 §2.4.

**NW-P-09 · 16 Nov 2026 · Champion agent, Priya · S-04 `/cycle?phase=1` · METHOD v2 §2.6 · Today**
The Champion opens the 2027 annual cycle and tells Elena (sponsor) and Priya (facilitator) that planning is open. Priya gathers the input pack:

| # | Item | What Northwind put in it |
|---|---|---|
| 1 | Mission, vision, strategy | The 2026 to 2028 strategy |
| 2 | Prior OKRs and scores | 2026's imported OKRs and the pilot's review |
| 3 | KPI baseline | The KPI grid (NW-P-13) |
| 4 | Customer and market signals | Churn interviews; a rumour that a competitor, Brightline, is building self-serve onboarding |
| 5 | Financial constraints | Hugo's 2027 budget: headcount flat, support headcount frozen |
| 6 | Committed projects | SOC 2 Type II, which three enterprise prospects require |
| 7 | Open risks and dependencies | The bulk import API Engineering owes Product |

The pack is distributed on 20 November, three working days before the offsite.
*Test:* Given all seven items marked gathered and the pack distributed on 20 November, when Phase 1 is evaluated for a session on 25 November, then it is complete.

**NW-P-10 · 25 Nov 2026 · Elena and the leadership team · S-04 `/cycle?phase=0` · METHOD v2 §2.1, §2.3 phase 0 · Today**
At the offsite, the frame is written down:

| Part | Northwind 2027 |
|---|---|
| Mission | Help mid-market teams get value from their software from the first week |
| Vision | The platform a mid-market company never has to think about replacing |
| Horizon | 2026 to 2028 (kept from the seed) |
| Strategy 1 | Own the mid-market segment we already win in |
| Strategy 2 | Make the product prove itself in the first thirty days |
| Strategy 3 | Turn support load into product change instead of headcount |
| Strategy 4 (new) | Earn the trust of enterprise security teams without custom work |
| Not doing in 2027 | No custom enterprise deployments. No partner marketplace. No new regions. No pricing rebuild before July. No individual OKRs |

*Test:* Given the frame with four strategies and a written not-doing list, when Phase 0 is evaluated after the annual OKRs are published (NW-P-12), then it is complete.

**NW-P-11 · 30 Nov to 11 Dec 2026 · Leadership · S-09 drafting, with the coach · METHOD v2 §2.8, §4 · P9-T03 and P9-T11**
Four annual objectives are drafted, two committed and two aspirational. These are the company's promises for the year. The quarterly company OKRs will take slices of them (§1 below).

| # | Objective | Kind | Champion | Key results (baseline → year-end target) |
|---|---|---|---|---|
| A1 | New accounts reach value in their first week | Aspirational | Priya | Median time to first value 9 → 3 days (metric, reduce, lagging). 30-day activation 51% → 70% (metric). 90-day logo retention 89% → 95% (metric) |
| A2 | Grow profitably from the customers we keep | Committed | Elena | Operating margin 9.1% → 15% (metric, reads the KPI). Net revenue retention 100% → 108% (metric). Support cost per account $128 → $95 a month (metric, reduce) |
| A3 | Enterprise security teams approve us without a fight | Committed | Mei | SOC 2 Type II report issued by 30 September (milestone). Security questionnaire turnaround 10 → 2 working days (metric, reduce). Uptime held at or above 99.9% every month (maintain, band 99.9 to 100) |
| A4 | Win the mid-market deals we should win | Aspirational | Daniel | Mid-market win rate 26% → 35% (metric). Median sales cycle 55 → 40 days (metric, reduce) |

The coach's comments while drafting:
- **On A3's first draft, "Get SOC 2":** OBJ-1 warns, because it starts with a deliverable. The team keeps SOC 2 as a milestone key result under a rewritten objective. That is the pattern METHOD v2 §4.6 shows for a committed delivery.
- **On A1's draft confidence of 9 in 10:** the coach asks whether A1 is a commitment. The team says it is a stretch and lowers its confidence honestly to 6 in 10.
- **On A2, a committed set averaging 7 in 10:** no comment. High confidence is right for a commitment.

*Test:* Given A3 drafted as "Get SOC 2 Type II", when it is typed, then OBJ-1 warns with the deliverable prompt, and publishing would still be allowed. Given A1 marked aspirational with an average draft confidence of 0.9, then the coach suggests marking it committed or raising the targets.

**NW-P-12 · 18 Dec 2026 · Elena · S-10 publish · METHOD v2 §4.5 · P9-T03**
The annual set publishes. Gates 1 and 2 are green: every objective has a title, a champion and key results with targets, dates and owners. Gate 3 warns about nothing. Gate 5 asks about capacity: A3 is committed, and Engineering marks its SOC 2 milestone "tight", not "exceeds", after cutting the partner marketplace. Elena presents the annual OKRs at the all-hands on 18 December. The whole company can read them; transparency is the default.
*Test:* Given the four annual objectives complete, when the set is published, then every member can read them, and the cuts recorded in Phase 5 appear on the capacity record.

**NW-P-13 · Dec 2026 · Hugo, Amara · S-20 `/kpis`, S-18 `/kpis/trees` · METHOD v2 §6 · P9-T17**
The health metrics that are watched every month whether or not they are OKRs.

| KPI | Target type | Green / red | Value, Dec 2026 | State |
|---|---|---|---|---|
| Operating margin | Increase to 15% | Green ≥ 13.5, red < 8 (the lender's covenant floor) | 9.1% | Watch |
| Net revenue retention | Increase to 110% | Green ≥ 103, red < 97 | 100% | Watch |
| Support cost per account | Decrease to $90 | Green ≤ $100, red > $120 | $128 | Unhealthy |
| Support tickets per account | Decrease to 2.0 | Green ≤ 2.2, red > 2.8 | 2.9 | Unhealthy |
| Self-serve deflection | Increase to 35% | Green ≥ 30, red < 15 | 17% | Watch |
| Median time to first value | Decrease to 5 days | Green ≤ 6, red > 10 | 9 | Watch |
| 30-day activation | Increase to 65% | Green ≥ 60, red < 45 | 51% | Watch |
| 90-day logo retention | Stay at or above 92% | Green ≥ 92, red < 88 | 89% | Watch |
| Uptime | Stay within 99.9 to 100% | The band | 99.95% | Healthy |
| Onboarding NPS | Increase to 40 | None set | No data | No data |

There are two driver trees from the seed: Unit economics, rooted at operating margin, and Growth, rooted at net revenue retention.
- **Thresholds in the KPI's own units.** Each KPI is judged by its own thresholds. Uptime at 95% is unhealthy here, where the old ratio-to-target rule called it healthy.
- **Onboarding NPS has no data.** That is why Q1 writes a baseline key result to establish it (NW-Q1-05).

*Test:* Given uptime with the band 99.9 to 100%, when 99.5% is recorded, then the KPI reads unhealthy, not 99.6% of target.

**NW-P-14 · 21 Dec 2026 · Priya, coordinators · S-22, S-23, S-24 scheduling · METHOD v2 §7.1, CY-8 · Today**
The whole of Q1's rhythm is booked before the quarter starts:
- a Monday 30-minute check-in in every space;
- a monthly review on the first Monday of February and March;
- the Q1 review on 18 March, two weeks before the quarter ends.

"Set and forget" is the failure this prevents.
*Test:* Given every weekly, monthly and quarterly session booked for Q1, when CY-8 is evaluated, then it passes.

---

Next: [1. Q1: the rollout](01-q1-rollout.md).
