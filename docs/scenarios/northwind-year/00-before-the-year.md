# 0. Before the year: pilot, upgrade, setup and planning 2027

September to December 2026. Northwind has run OKRs in spreadsheets since 2025, with the usual result: objectives written in January and last updated in week four. In September 2026 Elena decides to move the practice into OpenOKR.

She starts with a pilot rather than a rollout, as Wodtke advises ("start with a pilot program"). Microsoft's own rollout guide makes the same point: it brought leaders in first, managers after a successful first quarter, and everyone else after another.

The pilot starts on OpenOKR 0.1.2, the release available that September. On 30 November the workspace upgrades to 0.2.0, the release Phase 9 produces. The company-wide rollout runs on 0.2.0.

Step format: **ID · date · who · screen · rule · status**, then what happens, then the test.

---

## The pilot, on 0.1.2

**NW-P-01 · 28 Sep 2026 · Elena · S-34 `/welcome`, S-33 · METHOD v2 §12 · Today**
Elena signs up on the managed cloud and names the workspace "Northwind Labs". The person who registers holds full access, as the demo seed's chief executive does. She makes Priya an administrator, because Priya will run the practice. The onboarding steps are all skippable.
*Test:* Given a new registration, when it completes, then the registrant holds full access, both agents are members, and making a second member an administrator is recorded in the audit log.

**NW-P-02 · 1 Oct 2026 · Priya · S-04 `/cycle` · METHOD §2.3 as it stands today · Today**
The pilot runs with two spaces, Product and Customer Success. Priya invites Sara, Mei, Amara and Tomás, and Q4 2026 is created.
- **Drafting is refused at first.** On 0.1.2, drafting is refused until Phase 2 is complete, and Phase 2 needs the prior cycle scored or a first cycle declared.
- **Priya declares a first cycle.** Drafting then opens.

On 0.2.0 that box is no longer needed (NW-P-07).
*Test:* Given 0.1.2 and no earlier cycle, when Sara drafts an objective on the cycle screen, then she is refused with the reason. Once Priya declares the cycle a first cycle, the same draft succeeds.

**NW-P-03 · Oct to Nov 2026 · Sara, Tomás · S-15 `/check-in`, S-22 · METHOD §7.2 as it stands today · Today**
The pilot spaces check in every Monday, and the Champion reminds anyone who has not by the anchor day. In week 5, Tomás's confidence on renewals flagged 90 days out falls from 7 to 3. On 0.1.2, confidence at 0.3 or below escalates to management the same day, so Elena hears that evening.
*Test:* Given 0.1.2 and a key result checked in at 0.3, when the check-in publishes, then the same-day escalation is recorded, citing its rule.

## Planning opens, and the upgrade

**NW-P-04 · 20 Nov 2026 · Champion, Priya · S-04 `/cycle?phase=1` · METHOD v2 §2.6, §11 planning-open lead · Today**
Annual planning for 2027 opens six weeks before the year. The Champion tells Elena, the sponsor, and Priya, the facilitator. Priya gathers the input pack:

| # | Item | What Northwind put in it |
|---|---|---|
| 1 | Mission, vision, strategy | The 2026 to 2028 strategy |
| 2 | Prior OKRs and scores | 2026's spreadsheets (imported in NW-P-11) and the pilot's progress so far |
| 3 | KPI baseline | The KPI grid (NW-P-12) |
| 4 | Customer and market signals | Churn interviews; a rumour that a competitor, Brightline, is building self-serve onboarding |
| 5 | Financial constraints | Hugo's 2027 budget: headcount flat, support headcount frozen |
| 6 | Committed projects | SOC 2 Type II, which three enterprise prospects require |
| 7 | Open risks and dependencies | The bulk import API Engineering owes Product |

The pack is distributed on 26 November, three working days before the offsite on 1 December.
*Test:* Given all seven items gathered and the pack distributed on 26 November, when Phase 1 is evaluated for a session on 1 December, then it is complete.

**NW-P-05 · 25 Nov 2026 · Elena, Priya · S-36 `/admin/sso`, `/admin/directory`, `/admin/channels` · Today**
Elena prepares for the company-wide rollout:
- **Sign-in.** Single sign-on through the company's identity provider.
- **People.** Directory sync provisions about 180 people as members, and the leaders are added to their spaces.
- **Channels.** Slack is connected for Sales and Customer Success; everyone else uses email. Each member's quiet hours default from their time zone.

*Test:* Given directory sync on, when a person is added to the identity provider's "Northwind" group, then they appear as a member with standard access within the sync interval, and their first sign-in uses single sign-on.

**NW-P-06 · 25 Nov 2026 · Priya · S-36 `/admin/rhythm` (terminology) · Today**
Northwind calls its teams "teams", so Priya renames "Space" to "Team" in terminology. Every screen, email and Slack message now says Team. Bahasa Melayu readers keep their own word, because a rename is the organisation's word, not a translation.
*Test:* Given the label "Team" for Space, when any screen lists spaces, then it says "Teams", and the API keeps the stored name `space`.

**NW-P-07 · 30 Nov 2026 · Elena · upgrade, S-36 practice settings · METHOD v2 §12 · P9-T22, P9-T02**
Northwind's workspace moves to OpenOKR 0.2.0.
- **The recommended profile.** The release notes name every change in practice. The workspace lands on the recommended profile with nothing lost.
- **The pilot cycle.** It keeps its history, its declared first cycle and its check-ins.
- **The lock is gone.** The drafting refusal of NW-P-02 no longer exists by default.
- **A first cycle is inferred.** A workspace created now would have its first cycle inferred, because no earlier cycle exists.

*Test:* Given a workspace on 0.1.2 with a pilot cycle, when the instance upgrades to 0.2.0, then the workspace reads the recommended profile, every goal, key result and check-in is intact, and drafting needs no declaration. Given a new workspace on 0.2.0 with no earlier cycle, then Phase 2's prior-cycle condition holds without anything being declared.

## Planning 2027

**NW-P-08 · 1 Dec 2026 · Elena and the leadership team · S-04 `/cycle?phase=0`, `?phase=3` · METHOD v2 §2.1, §2.3 phases 0 and 3 · Today**
At the offsite, the frame and the year's priorities are written down:

| Part | Northwind 2027 |
|---|---|
| Mission | Help mid-market teams get value from their software from the first week |
| Vision | The platform a mid-market company never has to think about replacing |
| Horizon | 2026 to 2028 (kept from the seed) |
| Strategy 1 | Own the mid-market segment we already win in |
| Strategy 2 | Make the product prove itself in the first thirty days |
| Strategy 3 | Turn support load into product change instead of headcount |
| Strategy 4 (new) | Earn the trust of enterprise security teams without custom work |
| Priority, with its 12-month success | "New accounts reach value in their first week": the median under 4 days by December |
| Priority, with its 12-month success | "Margins we can run on": operating margin at 15% by December |
| Priority, with its 12-month success | "An approved vendor": a SOC 2 Type II report in customers' hands by October |
| Not doing in 2027 | No custom enterprise deployments. No partner marketplace. No new regions. No pricing rebuild before July. No individual OKRs |

Leadership agreement on the frame is recorded.
*Test:* Given four strategies, three priorities each with a 12-month success statement, a written not-doing list and recorded agreement, when Phase 3 of the annual cycle is evaluated, then it is complete, and CY-4 and CY-5 pass.

**NW-P-09 · 2 Dec 2026 · Elena · S-36 practice settings · METHOD v2 §2.5, §12 · P9-T05, P9-T04**
Elena keeps the recommended profile. She decides how Northwind uses reviewers:
- **Company objectives** are reviewed by Elena.
- **Department objectives** are reviewed by the department head.
- **Team objectives** have no reviewer. The team's own weekly check-in is review enough.

The reviewer setting stays at "Optional", which allows exactly that. Strict mode stays off, phase enforcement stays guided, and anybody can write at any time.
*Test:* Given the recommended profile, when the practice settings screen opens, then it shows every setting at its default with no "differs from profile" marker. Given the reviewer at Optional, then a team objective can be created without one.

**NW-P-10 · 2 to 11 Dec 2026 · Leadership · S-09 drafting, with the coach · METHOD v2 §2.8, §3.2, §4.1 · P9-T03a, P9-T11**
Four annual objectives are drafted, two committed and two aspirational. These are the company's promises for the year. The quarterly company OKRs will take slices of them.

| # | Objective | Kind | Champion | Key results (baseline → year-end target) |
|---|---|---|---|---|
| A1 | New accounts reach value in their first week | Aspirational | Priya | Median time to first value 9 → 3 days (metric, reduce, lagging). 30-day activation 51% → 70% (metric). 90-day logo retention 89% → 95% (metric) |
| A2 | Grow profitably from the customers we keep | Committed | Elena | Operating margin 9.1% → 15% (metric, reads the KPI). Net revenue retention 100% → 108% (metric). Support cost per account $128 → $95 a month (metric, reduce) |
| A3 | Enterprise security teams approve us without a fight | Committed | Mei | SOC 2 Type II report issued by 30 September (milestone). Security questionnaire turnaround 10 → 2 working days (metric, reduce). Uptime held at or above 99.9% every month (maintain, band 99.9 to 100) |
| A4 | Win the mid-market deals we should win | Aspirational | Daniel | Mid-market win rate 26% → 35% (metric). Median sales cycle 55 → 40 days (metric, reduce) |

The coach's comments while drafting:
- **A3's first draft, "Ship SOC 2 Type II".** OBJ-1 warns, because it starts with a deliverable. OBJ-2 warns too, because of the digit. The team keeps SOC 2 as a milestone key result under a rewritten objective, the pattern METHOD v2 §4.6 shows for a committed delivery.
- **A1, drafted at an average confidence of 0.92.** The coach asks whether A1 is a commitment. The team says it is a stretch and lowers its confidence honestly to 6 in 10.
- **A2 and A3.** Each committed key result is drafted at 7 in 10 or above, so the committed floor raises nothing.

*Test:* Given "Ship SOC 2 Type II" typed as an objective, then OBJ-1 warns with the deliverable prompt and OBJ-2 warns on the digit, and publishing would still be allowed. Given A1 aspirational at an average draft confidence of 0.92, then the coach suggests marking it committed or raising the targets.

**NW-P-11 · 3 Dec 2026 · Amara · S-36 `/admin/imports` · Today and P9-T12**
Amara imports the 2026 spreadsheets: three quarters of objectives and key results with their final values. She runs a dry run first.
- **Three rows name an owner who has left.** She maps them to Priya.
- **The spreadsheet has no kind columns.** The importer writes each objective as aspirational and each key result as a metric, and the report says so.

The history becomes context in the 2027 input pack.
*Test:* Given the 2026 spreadsheet, when the dry run reports three rows with unknown owners and they are mapped, then the real run writes exactly what the dry run reported, every objective arrives aspirational and every key result as a metric, and a second run changes nothing.

**NW-P-12 · 7 Dec 2026 · Hugo, Amara · S-20 `/kpis`, S-18 `/kpis/trees` · METHOD v2 §6.2, §6.4 · P9-T17**
These are the health metrics, watched every month whether or not they are OKRs. In December none is past its red boundary, so no recovery is proposed.

| KPI | Target type | Green / red | Value, Dec 2026 | State |
|---|---|---|---|---|
| Operating margin | Increase to 15% | Green ≥ 13.5, red < 8, the lender's covenant floor | 9.1% | Watch |
| Net revenue retention | Increase to 110% | Green ≥ 103, red < 97 | 100% | Watch |
| Expansion seats added | Increase to 220 a month | Green ≥ 200, red < 130 | 138 | Watch |
| Support cost per account | Decrease to $90 | Green ≤ $100, red > $135 | $128 | Watch |
| Support tickets per account | Decrease to 2.0 | Green ≤ 2.2, red > 3.2 | 2.9 | Watch |
| Self-serve deflection | Increase to 35% | Green ≥ 30, red < 15 | 17% | Watch |
| Median time to first value | Decrease to 5 days | Green ≤ 6, red > 10 | 9 | Watch |
| 30-day activation | Increase to 65% | Green ≥ 60, red < 45 | 51% | Watch |
| 90-day logo retention | Stay at or above 92% | Green ≥ 92, red < 88 | 89% | Watch |
| Uptime | Stay within 99.9 to 100% | The range is green; red below 99.5 | 99.95% | Healthy |
| Onboarding NPS | Increase to 40 | None set | No data | No data |

There are two driver trees from the seed: Unit economics, rooted at operating margin, and Growth, rooted at net revenue retention.
- **Thresholds in the KPI's own units.** Each KPI is judged by its own thresholds. Uptime at 95% is unhealthy here, where the old ratio-to-target rule called it healthy.
- **Onboarding NPS has no data.** That is why Q1 writes a baseline key result to establish it (NW-Q1-07).

*Test:* Given uptime with the range 99.9 to 100 and red below 99.5, when 99.7 is recorded, then it reads watch. When 99.4 is recorded, it reads unhealthy.

**NW-P-13 · 14 Dec 2026 · Priya, Tomás, Sara · S-24 `/session/[id]` · METHOD v2 §8 · P9-T20**
The pilot closes with a 90-minute review. The pilot scores 0.55. The room's two learnings:
- "We learned that four key results per objective was too many to discuss in thirty minutes."
- "We learned that the weekly session is where the value is, not the dashboard."

Both feed Q1's input pack.
*Test:* Given the pilot cycle reviewed, when Q1 2027's Phase 1 and Phase 2 open, then the pilot's scores and learnings appear in its input pack and its prior-cycle scoring list.

**NW-P-14 · 18 Dec 2026 · Elena · S-10 publish, all-hands · METHOD v2 §4.5 · P9-T03b**
The annual set publishes. Gates 1 and 2 are green: every objective has a title, a champion and key results with targets, dates and owners. Gate 3 has nothing to warn about. Gate 5 asks about capacity: A3 is committed, and Engineering marks its SOC 2 milestone "tight", not "exceeds", after cutting the partner marketplace.

Elena presents the annual OKRs at the all-hands on 18 December, as Google does at the start of its year. The whole company can read them.
*Test:* Given the four annual objectives complete, when the set is published, then every member can read them, and the cuts recorded appear on the capacity record.

**NW-P-15 · 21 Dec 2026 · Priya, coordinators · S-22, S-23, S-24 scheduling · METHOD v2 §7.1, CY-8 · Today**
The whole of Q1's rhythm is booked before the quarter starts:
- a 30-minute Monday check-in in every space;
- a monthly review on the first Monday of February and March;
- the Q1 review on 18 March, two weeks before the quarter ends.

*Test:* Given every weekly, monthly and quarterly session booked for Q1, when CY-8 is evaluated, then it passes.

---

Next: [1. Q1: the rollout](01-q1-rollout.md).
