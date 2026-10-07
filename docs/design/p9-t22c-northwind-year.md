# P9-T22c: the Northwind year as a seed

Design for the Northwind year seed (gap G-4), written at P9-T22c-a. The story is
[the Northwind year scenario](../scenarios/northwind-year/README.md); this page
says how a seed tells it.

## 1. The decision it rests on

Akmal chose on 7 October 2026 that the demo follows the real clock
([p9-t00-adaptable-practice.md](p9-t00-adaptable-practice.md), "Two decisions").

| | |
|---|---|
| **What a visitor sees** | Northwind as of today. Every step dated before today is true, and nothing after it exists |
| **How it moves** | By itself. The demo instance rebuilds every night, so in May it shows the competitor, in August the summer, in December the close |
| **What it does not do** | Pretend today is another day. The product reads the real clock everywhere, and the database stamps its own times |

## 2. The calendar

The scenario is written for 2027. The seed places it in the real year that
holds today, and its "before the year" chapter in the year before.

**Each scenario date keeps its distance from its quarter's first Monday.** A
step on Monday of week 3 lands on Monday of week 3 in any year, so the weekly
rhythm, the anchor day and every "W6" in the story stay true. A date that would
land past its quarter's end is held on the last day of the quarter.

| Scenario date | Its quarter's first Monday | Days after | In 2026 | Lands on |
|---|---|---|---|---|
| Mon 4 Jan 2027 | 4 Jan 2027 | 0 | 5 Jan 2026 | Mon 5 Jan 2026 |
| Mon 10 May 2027 | 5 Apr 2027 | 35 | 6 Apr 2026 | Mon 11 May 2026 |
| Fri 24 Dec 2027 | 4 Oct 2027 | 81 | 5 Oct 2026 | Fri 25 Dec 2026 |
| Tue 1 Dec 2026 | 5 Oct 2026 | 57 | 6 Oct 2025 | Tue 2 Dec 2025 |

Cycles are calendar quarters, so they need no mapping: the seed asks
`cycles.create` for the quarter that holds a mapped date.

## 3. The timeline

The seed is a list of dated **events**, each a function that writes what one
moment of the story leaves behind. It runs every event whose mapped date is on
or before today, **in date order**, so a setting changed on 2 April is changed
after Q1 closed on 18 March and before Q2 publishes, and each closed cycle's
snapshot holds the rules it was graded under (METHOD.md §12). Events on one
day run in the order they are listed.

**Steps and events are different things.** A step is a scenario ID, NW-Q1-17,
with the dates the scenario gives it; `yearStepsAsOf` says which are done,
under way or not yet, with no database, so the five README dates are tested
without a clock. An event writes rows. Most steps have one event, some have
several, and a few have none (§5).

## 4. The five parts

| Part | Builds | Steps |
|---|---|---|
| **P9-T22c-a** | The calendar, the step list, the timeline runner and `pnpm db:seed --year`. The fourteen people, with the dates they join and leave; the nine spaces, with Support and Growth on their own dates; "Team" in terminology; the year's practice settings changes; the eleven KPIs with their target types, thresholds and monthly readings, and the two driver trees; the 2027 annual frame and the four annual objectives, published | NW-P-01, NW-P-06, NW-P-08 to NW-P-10, NW-P-12, NW-P-14, and the settings and people rows of later steps |
| **P9-T22c-b-a** | The pilot quarter, its check-ins, review and close. Q1's plan: planning, Phase 2 and 3, the rhythm booked, the company and team sets in two steps with the peer review's changes | NW-P-02 to NW-P-04, NW-P-13, NW-P-15, NW-Q1-01 to NW-Q1-14 |
| **P9-T22c-b-b** | Q1's twelve weeks: the weekly check-ins, the mid-cycle key result, the blocker, the milestones, the monthly reviews; and the review graded and closed | NW-Q1-15 to NW-Q1-32 |
| **P9-T22c-c** | Q2: the competitor's moves, the leaver, the new hire, the split review and the close, and the mid-year revision of the annual frame | NW-Q2-01 to NW-Q2-23 |
| **P9-T22c-d** | Q3: the recovery, the holidays and the leave, the merger, the new team, the milestones, and the close | NW-Q3-01 to NW-Q3-16 |
| **P9-T22c-e** | Q4, the annual review, 2028's annual objectives and Q1 2028's drafts. The demo switches to the year: `pnpm db:seed` and the nightly reset build it, `demo:prepare` gives the added people accounts, and README §6 says what a visitor sees in each part of the year | NW-Q4-01 to NW-Q4-16 |

## 5. What a seed reproduces, and what it does not

The seed writes **the state a step leaves**: the rows a visitor reads. It does
not replay what left no row behind.

| Kind of step | Seeded | Why |
|---|---|---|
| People, spaces, settings, frames, objectives, key results, values, check-ins, blockers, KPIs and readings, sessions with their records, grades, closes and snapshots | Yes | It is what every screen reads |
| A refusal (NW-P-02's lock, NW-Q1-24's eased target without a reason, NW-Q2-06's gate), a conflicting edit (NW-Q1-12), an undo | No | It left nothing. The steps' own tests prove the behaviour |
| Single sign-on, directory sync, Slack, the 2026 import, an external AI assistant, a workspace archive (NW-P-05, NW-P-11, NW-Q2-15, NW-Q4-15) | No | Each needs a system the demo instance is not connected to |
| Nudges, escalations, the coach's messages and digests | No | The two agents run on the demo every night and send the ones today's state calls for |
| The pilot running on 0.1.2 (NW-P-02, NW-P-03) | Its result only | The instance is on the current release. The pilot is a closed quarter with its check-ins and review |

**Timestamps.** Every row the story dates by its meaning carries the mapped
date: a check-in's publication, a value's period, a KPI reading's month, a
mid-cycle mark, a leave, a holiday, a cycle. A row whose date the product
stamps as it writes, an activity or an audit entry, says when the seed ran,
because forging the audit trail is the one thing a demo must not do.

## 6. Acceptance

Given today's date, when the seed builds the Northwind year, then every step
dated before today is true, and nothing dated after it exists.

Each part proves its own steps against a database as of the real today, and
`yearStepsAsOf` proves the five README dates with no database:

| README date | Done at that date | Not yet |
|---|---|---|
| Q1 W2, 11 January | NW-P-01 to NW-Q1-11 | NW-Q1-12 |
| Q1 W6, 8 February | Up to NW-Q1-19 | NW-Q1-20 |
| Q2 W7, 17 May | Up to NW-Q2-15, with NW-Q2-12 under way: Ben's last day is 21 May | NW-Q2-16 |
| Q3 W7, 16 August | Up to NW-Q3-10, with NW-Q3-05 and NW-Q3-06 under way | NW-Q3-11 |
| 24 December | The whole year | |

## 7. As built

| Part | What the seed does that the story does not say | Why |
|---|---|---|
| P9-T22c-a | The company space is the workspace's first space, renamed nothing, with Priya its coordinator | The product reads the first space as the company's (P9-T19a); creating another would leave the real one unused |
| P9-T22c-a | KPI readings carry six months of history from the day the KPIs are set up, and every later month appears on the day it is recorded | The scenario gives only the figures it needs; the months between are drawn to join them, and every stated figure is kept |
| P9-T22c-b-a | The pilot's two objectives and their values | The scenario names the pilot's spaces, people, score and learnings, not its objectives. These end where Q1's baselines begin and grade to 0.55 |
| P9-T22c-b-a | Check-ins are written through `goals.importCheckIn`, under a `csv` legacy key named `northwind-year:` | It is the one action that publishes a check-in on its own date, through the Operation pipeline, with its values and their history on that date. The key is what makes it idempotent |
| P9-T22c-b-a | Jonas's rewrite of S2 removes the two activity key results and adds the two outcomes | A different measure is not an eased target, and §2.9 asks a reason of any easing, published or not |
| P9-T22c-b-a | "P1 depends on E3, and Mei confirms it" is a dependency of P1.1 on Engineering, confirmed, beside the link between the two objectives | Confirmation belongs to a key result's dependency on a space (§5.4); a link between two objectives has nothing to confirm |
| P9-T22c-b-b | Each key result's weekly values are a path the scenario does not give: a straight line from the baseline to where it finished, or a drawn path where the story says how it moved (C1.2 behind pace, C2.1 up after the January release and back down, M1.1 flat) | The scenario gives where each one started and finished and the weeks that matter. The grades are the scores §2.10 computes from the finish, so the scorecard's one adjustment is C1.2's, as the story has it |
| P9-T22c-b-b | Q2 is created on 4 March, four weeks before it starts, with Elena its sponsor and Priya its facilitator | A close feeds the next quarter that exists. Without Q2 it would feed the quarter provisioning made for today, and the eleven kept and modified objectives would land a year away |
| P9-T22c-b-b | C2.3's mid-cycle mark is set to 1 February by the builder's own audited operation, and a key result's first value is dated the day it was added | The product stamps both with the day they are written, which for a quarter long over is today. The audit row says the builder did it |
| P9-T22c-b-b | The monthly reviews, the weekly session holding the blocker and the quarter's review are all in the company space | The story holds them as company rituals, and the product needs a session to hold a decision and a blocker |

### Four product changes the year found

Building Q1's close against a database meant recording a review after its day,
which no test had done. Four things read the clock where they should read the
record's own day. Each is fixed in the product, with its own test, rather than
worked around in the seed, because a team that writes up its review the
morning after meets the same four.

| Change | Before | After | Test |
|---|---|---|---|
| The diagnostic measures the rhythm as of the review's day | Measured as of the moment it was recorded, so a review written up later counted every check-in due since as missed | As of the session's day once it has passed, and now otherwise | `review-reset.test.ts`, "measures the rhythm as of the review's day" |
| A decision is dated by its session's day | Dated the day it was typed | The session's day once it has passed, and today otherwise | `monthly-review.test.ts`, "a decision's date" |
| An imported check-in that marks a milestone done dates it by the check-in | `done_at` was the day of the import | The check-in's own date, as its values already were | `measured-rhythm.test.ts`, "an imported check-in that marks a milestone done" |
| **A review in the company space covers the whole cycle** | A review decided only the objectives of its own space, so the company's quarterly review could not decide a team's objective | The company space's review covers every objective in the cycle. A team's review still covers only its own | `review-reset.test.ts`, "which objectives a review covers" |

**The fourth is for Akmal to confirm.** METHOD §8's ninth stage closes every
objective deliberately, and the scenario holds one quarterly review, in the
company space, that decides all fourteen.
The product had no way to do that: each space's review saw only its own
objectives. Widening the company space's review is the smallest change that
matches §8, and it leaves a team's review as it was. If the intent is instead
one review per space, the change comes out and the seed holds fourteen.
