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
| **P9-T22c-c-a** | Q2's plan from the drafts Q1's close left: the redrafts, C3, C4, CS2 and F2, both publish steps with F2's override, Engineering's third objective as an initiative, Yuki following P1, CS2's dependency escalated and confirmed; weeks 1 to 5 and the first monthly review. The helpers for running a quarter, shared by Q1 and Q2 | NW-Q2-01 to NW-Q2-08 |
| **P9-T22c-c-b** | The competitor's moves, the eased target, the leaver, the escalated commitment, the baseline recorded and its target added, the June review, the split review and retrospective, the close, and the mid-year revision of the annual frame | NW-Q2-09 to NW-Q2-23 |
| **P9-T22c-d-a** | Q3's plan: Phase 2's issues, the redrafts, S3 and F3, both steps; the margin recovery C6 launched inside the window with expansion answered by C6.2; weeks 1 to 4 with Sales every two weeks, and July's reading | NW-Q3-01 to NW-Q3-05 |
| **P9-T22c-d-b** | The summer: holidays and leave with delegates, SU1 moved before Support is archived, Mei's handover, the Growth team's G1, the forecast, the milestones and the SOC 2 report; the grading, the split review and the close | NW-Q3-06 to NW-Q3-16 |
| **P9-T22c-e-a** | Q4's plan: the redrafts, C7, C8, CS3 and F4, both steps; Mei's return, the outage answered with "fix it now", November's healthy margin and the dismissed proposal to close C6. Each year test placed on a year whose dates have passed | NW-Q4-01 to NW-Q4-05 |
| **P9-T22c-e-b** | The annual review of 2027, the board's export, 2028's annual objectives; Q4 graded, reviewed and closed with C6 achieved; the scorecard; the department level off; Q1 2028's company set; the archive and the final digest | NW-Q4-06 to NW-Q4-16 |
| **P9-T22c-e-c** | The demo switches to the year: `pnpm db:seed` and the nightly reset build it, `demo:prepare` gives every person in it an account, and README §6 says what a visitor sees in each part of the year | README §6 |

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

| P9-T22c-c-a | Each of Q2's eleven carried drafts is redrafted to the chapter's table: a key result kept is retitled and retargeted, and given Q2's due date and, under a commitment, its capacity verdict again; one Q2 does not measure is removed, and a new one is added | The close carries objectives and key results with their last values and leaves due dates, capacity verdicts and alignment behind for Phase 5 to ask again (§8.9, P9-T20e-b). The chapter's table is what the teams made of those drafts |
| P9-T22c-c-a | C1.2 starts from 56% because the Q2 draft's baseline is moved on 22 March | Sara's 56% arrived after Q1 closed on 18 March, so Q1 keeps its 55% and its adjusted grade, and Q2's starting point is what moves |
| P9-T22c-c-a | C4 is typed by hand | The copilot drafts the same objective, and the seed runs with no provider (the chapter's own "without AI" path) |
| P9-T22c-c-a | Engineering's third objective is drafted on 7 April and moved on 9 April: deleted, with an initiative of the same name linked to E1.2 | The chapter tracks the work under E1; latency is where a build time shows |
| P9-T22c-c-a | Marketing's first title is written on 5 April and renamed on 15 April before the step publishes | The refusal leaves nothing, and the rename is in the objective's history |
| P9-T22c-c-a | The first monthly review gives C3 a trend as well, "improving" | The chapter names three trends, and its test asks one for each company objective |
| P9-T22c-c-a | Where the chapter gives no finish for a Q2 key result, one is chosen | Eight scores are given; the rest are chosen so the aspirational twenty-two average 0.59 with eleven below 0.6, and the five commitments are met, as NW-Q2-19 and NW-Q2-21 have it |

| P9-T22c-c-b | The emergency session of 12 May is a monthly review called early, and it records four decisions against the key results the moves touched | The chapter calls it that, and §7.5 keeps decisions in a monthly review |
| P9-T22c-c-b | C4's stop, C2's change of kind and S2.1's eased target are dated 12 May by the builder's own audited operation, as are A4's eased target and its new key result on 21 June | The product stamps a stop's close, a kind change and a target change with the day they are written, and the close reads all three back ("committed until 12 May"). A kind change's one record is its activity, so that row is dated too; the audit rows still say when the seed ran |
| P9-T22c-c-b | Elena's decision of 17 May is taken in a short leadership session of the monthly kind | A decision belongs to a monthly review (§7.5), and the chapter records it against C3.2 |
| P9-T22c-c-b | Daniel's check-in drafted by his own assistant is a check-in by Daniel; the critical escalations and the coach's committed-floor message are not seeded | The external assistant is not connected to the demo (§5), and the agents send today's messages themselves |
| P9-T22c-c-b | The grades are recorded in the review session on 16 June rather than on 14 and 15 June | A grade is recorded in the review that reveals it; the champions' preparation leaves nothing until then |
| P9-T22c-c-b | Process health reads statement three lowest at 3, not 3.1 | 3.1 is a room's average; the seed submits one person's answers |
| P9-T22c-c-b | Q3 is created on 3 June, four weeks ahead, with its sponsor and facilitator | So Q2's close has somewhere to feed, as Q2 did for Q1 |

| P9-T22c-d-a | Four of Q2's finishes move to where Q3's table starts them (C5.2 at 1, E1.1 at 11, S1.2 at 4.5, CS1.1 at 80), and four free ones move to keep Q2 at 0.59 with eleven below 0.6 | A kept key result starts the next quarter from its last value (§8.9), so Q2's grading has to finish where Q3's table begins. Support cost is the exception: Q3 starts it from June's KPI reading, $109, which arrives after Q2's grading read May's $113 |
| P9-T22c-d-a | C6 is launched from the margin KPI and then shaped: raised to company level, Hugo its champion and Elena its reviewer, aligned to A2, the two double-counted drivers removed and C6.2 and C6.3 added | The launch drafts §6.5's recovery as a team objective championed by whoever launches it. The semantic review that names the double counts needs a provider; the seed makes the change it leads to |
| P9-T22c-d-a | C6.1 and C6.2 read their KPIs, so the monthly readings move them and no check-in writes their values | A recovery's first key result is the KPI it is (P9-T18a), and C6.2 is expansion seats' answer |
| P9-T22c-d-a | Three Q3 key results the chapter leaves free finish where they started: C5.2 at 1, P4.2 at 0.6 and E1.1 at 11 | Every other aspirational figure is fixed by NW-Q3-14 or by Q4's table, and together they already grade 0.66 |

| P9-T22c-d-b | Product's holidays and Sara's leave are marked on 12 July; P4 and P2 check in nothing in the weeks of 9 and 16 August, and Amara posts P4's check-in on 23 August | The chapter has Sara mark both on 12 July. The product leaves holiday weeks out of the measured rhythm and sends a delegate what the person on leave owes |
| P9-T22c-d-b | SU1 moves to Customer Success on 26 July before the frame archives Support last that day; Kofi joins Customer Success and reports to Tomás | A space is archived after its objectives move out (P9-T22c-a's order) |
| P9-T22c-d-b | C5.1's values are drawn flat into August | The forecast that flags it is the product's own; the path is what makes its trend read 41% on 16 August |
| P9-T22c-d-b | The four committed misses each name a root cause as well as their explanation | §8.4 asks a cause of a commitment below 1.0, and the retrospective will not close without one |
| P9-T22c-d-b | The diagnostic reads 87% where the chapter says 86% | The product counts from the cycle's first Monday, so the twenty misses are the Mondays before each set began checking in. Product's holiday weeks would add four more, and the test proves they do not |
| P9-T22c-d-b | A quarter already over on the real calendar is not booked | Booking a quarter a few days after it ends books its missing review for today, which is right for a team booking late and wrong for a seed booking on the scenario's day. Q3's retrospective linked itself to that stray review before this |
| P9-T22c-d-b | Q4 is created on 3 September with its sponsor and facilitator, and no monthly reviews are held in Q3 | Q4's planning opens four weeks ahead (NW-Q4-01), so Q3's close has somewhere to feed; the chapter names no monthly review in the summer |

| P9-T22c-e-a | Every year test places the year on the latest real year whose dates it reads have passed, and builds to them (`year-placement.ts`) | The seed writes what happened by today, so a test reading Q4 in October would read nothing. Placed a year back, Q4 is checked whatever day the suite runs, and nothing writes ahead of the product's own clock |
| P9-T22c-e-a | C2's carried draft is placed in Customer Success at team level on 22 September, before the company step publishes, rather than with the teams | The company step reads the company's drafts, and C2 is not one of the five it publishes |
| P9-T22c-e-a | C6.1 starts Q4 from 10.4% and C8.1 from 158 at the drafting on 22 September | They are September's readings, which the KPIs record on 5 October; the chapter's table starts from them |
| P9-T22c-e-a | December's uptime, 99.4%, is recorded on 3 December, and the failover task is linked to E2.1 | The frame records each month a few days after it ends; the outage is the story's reason to read December early |
| P9-T22c-e-a | The coach's proposal to close C6 and Hugo's dismissal are not seeded | A proposal is an agent's message (§5); the Coach makes it on the running demo, where Hugo can dismiss it |

### Product changes the year found

Building Q1's close against a database meant recording a review after its day,
which no test had done. Four things read the clock where they should read the
record's own day. Each is fixed in the product, with its own test, rather than
worked around in the seed, because a team that writes up its review the
morning after meets the same four. Q2's close found four more, listed after
them.

| Change | Before | After | Test |
|---|---|---|---|
| The diagnostic measures the rhythm as of the review's day | Measured as of the moment it was recorded, so a review written up later counted every check-in due since as missed | As of the session's day once it has passed, and now otherwise | `review-reset.test.ts`, "measures the rhythm as of the review's day" |
| A decision is dated by its session's day | Dated the day it was typed | The session's day once it has passed, and today otherwise | `monthly-review.test.ts`, "a decision's date" |
| An imported check-in that marks a milestone done dates it by the check-in | `done_at` was the day of the import | The check-in's own date, as its values already were | `measured-rhythm.test.ts`, "an imported check-in that marks a milestone done" |
| **A review in the company space covers the whole cycle** | A review decided only the objectives of its own space, so the company's quarterly review could not decide a team's objective | The company space's review covers every objective in the cycle. A team's review still covers only its own | `review-reset.test.ts`, "which objectives a review covers" |

| A review held apart can be scheduled by hand | Only booking a cycle wrote the review and the retrospective, and it books nothing in the past, so a review scheduled late could not be split | `sessions.create` takes a `part`; a retrospective names the review scheduled before it for the same space and cycle, and is refused without one, or where the workspace holds its review in one session | `review-split.test.ts`, "scheduling the halves by hand" |
| Revising the frame keeps its strategies | `frame.set` replaced the strategy list on every call, so revising only the not-doing list gave each strategy a new id and the annual objectives aligned to them lost it | The list is replaced only when it changed, or for a new frame | `annual-revisions.test.ts`, "keeps its strategies" |
| A stopped objective does not hold up the close | Phase 7 asked for every key result in the cycle to be scored, including a stopped objective's, which §2.9 leaves unscored | An objective closed as abandoned before the review is left out of the count | `cycle-close.test.ts`, "closes past an objective stopped mid-cycle" |
| An eased target's original is the published one | The scorecard showed the target a key result had before its first ever change, which for a target set while drafting was the draft's | The first change after the plan published gives the original; one changed only while drafting keeps the old reading | `cycle-close.test.ts`, "shows the target the plan published with" |

| A retrospective names the review before it | A retrospective scheduled by hand named the latest review in its cycle, which could be one booked after it | It names the review scheduled at or before it | `review-split.test.ts`, "names the review scheduled before it" (P9-T22c-d-b) |

| A company objective can be placed in a space | `goals.moveToSpace` moved only an objective a space owned, so C2 could not become Customer Success's CS3 as NW-Q4-01 has it | A company objective moves into a space and becomes the space's, with edit on it and on the space; a person's objective is still refused. Who may see or edit it does not change | `goal-move.test.ts`, "places a company objective in a space" (P9-T22c-e-a) |

**The fourth of Q1's is for Akmal to confirm.** METHOD §8's ninth stage closes every
objective deliberately, and the scenario holds one quarterly review, in the
company space, that decides all fourteen.
The product had no way to do that: each space's review saw only its own
objectives. Widening the company space's review is the smallest change that
matches §8, and it leaves a team's review as it was. If the intent is instead
one review per space, the change comes out and the seed holds fourteen.
