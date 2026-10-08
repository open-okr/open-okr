# @openokr/core

## 0.2.0

### Minor Changes

- [#110](https://github.com/open-okr/open-okr/pull/110) [`fecd1c1`](https://github.com/open-okr/open-okr/commit/fecd1c18556e938627c4f5094b22a751297aedca) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Stage 9 of the quarterly review is "Keep, modify, abandon or defer"
  (METHOD.md §8.8). An objective now closes as one of five decisions:
  achieved, keep, modify, defer or abandon, each with its meaning on the
  screen. An unfinished aspirational objective shows "Proposed: Keep" where
  the workspace carries forward, and the room still chooses.
  
  A deferred objective is fed forward to the next cycle's issue list when the
  cycle is archived, at the carry-forward impact, once.
  
  Migration 0136 widens the close decision on goals and on review decisions.
  Every stored decision stays valid.

- [#110](https://github.com/open-okr/open-okr/pull/110) [`bf256ef`](https://github.com/open-okr/open-okr/commit/bf256eff36f8e8b601559bc381c624b2fa2ad9eb) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Closing a cycle carries every kept or modified objective into the next one
  as a draft (METHOD.md §8.9). Each key result starts from the last value it
  recorded, with the same target. A milestone already done stays behind, and
  a measured baseline comes back as a metric with its target to set. The
  draft is an ordinary objective: it passes Phase 4's checks and Phase 5's
  gates like any other, and one somebody deletes stays deleted. An objective
  whose champion has left is named on the closed cycle instead of carried.
  
  A deferred objective reaches the issue list whether it was deferred at the
  review or from its own page, whichever was decided later. The lowest
  process-health statement is now called the next cycle's improvement action
  in phase 3.
  
  Stage 10 of the quarterly review is "Learnings". The minutes report the
  committed key results met apart from the cycle score, on the screen and in
  both exports.
  
  Migration 0137 adds `goals.carried_from_goal_id`, nullable, with a unique
  index per cycle. `cycles.feedForward` and `cycles.close` report `drafts`
  and `notCarried`, and `workflow.read`'s closure reports `carriedDrafts` and
  `notCarried`. `sessions.minutes` reports `summary.committed`.

- [#110](https://github.com/open-okr/open-okr/pull/110) [`fa5b9d2`](https://github.com/open-okr/open-okr/commit/fa5b9d2d03e12d93b22014facd8adb3d5de4d1d7) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - METHOD.md is the revised method in full. The facilitator notes on every
  phase follow its §9, and a nudge for a situation METHOD.md §10 names now
  carries the coach's line under its headline, in the document's own words:
  a stale check-in says "This goal is stale. It cannot quietly stay green."
  
  The terminology card offers "Owner" beside "Champion". It fills both fields
  and saves only when the card is saved. The terms' explanations follow the
  revised method.
  
  `packages/method` exports `COACH_LINES`, `coachLineFor`, `coachSentence`
  and `suggestedTerm`, and the conformance suite now compares §9's guidance
  and §10's lines with the package, both ways.

- [#110](https://github.com/open-okr/open-okr/pull/110) [`a3bf087`](https://github.com/open-okr/open-okr/commit/a3bf0873f72572a82a51b3caf73977f21b3729d0) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The demo is now Northwind Labs' year. `pnpm db:seed` builds the scenario in
  `docs/scenarios/northwind-year` as of today: every step dated before today
  has happened and nothing after it exists, so a public demo moves through the
  year with the calendar. `pnpm db:seed --quarter` builds the smaller
  one-quarter demo the walkthrough follows. `pnpm demo:prepare` and the
  demo sign-in page now offer twelve people, the year adding Hugo, Nadia,
  Kofi, Leo and Yuki to the original seven.

- [#110](https://github.com/open-okr/open-okr/pull/110) [`1aaf715`](https://github.com/open-okr/open-okr/commit/1aaf715b768d646ce6a0c3fce52ad0f763651dab) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - `pnpm db:seed --year` now closes the year. 2028's planning opens in
  November and its offsite replaces the achieved strategy; the annual review
  of 2027 runs before 2028 is drafted, grades the annual objectives on their
  latest values with A4's eased target beside its original, and closes the
  year into 2028, whose annual set publishes in December. Q4 is graded,
  reviewed and closed with the margin recovery achieved, and Q1 2028's
  company set is drafted from what was kept and published.
  
  A KPI's recovery now follows its objective across a cycle's close: kept,
  the recovery continues in the next cycle's draft; closed as achieved,
  abandoned or deferred, it ends and the KPI leaves the recovery board.

- [#110](https://github.com/open-okr/open-okr/pull/110) [`8ff439e`](https://github.com/open-okr/open-okr/commit/8ff439e5cf01c77503d89f387f6218e02d3e758c) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - `pnpm db:seed --year` now runs Q1 and closes it. Every objective checks in
  weekly from the teams' publication to the week before the review, Marketing
  once on a Wednesday, inside the grace. Tickets per account turns unhealthy
  and C2.3 is added for it on 1 February as the KPI's answer. Two monthly
  reviews each record a decision, a blocker on guided setup is raised and
  resolved, and both milestones are ticked done on their own days. The review
  on 18 March grades every key result, with one adjustment, names the causes,
  reads "results delivered", decides all fourteen objectives and closes Q1
  with eleven drafts in Q2.
  
  A review recorded after its day now reads that day. The diagnostic measures
  the rhythm as of the review's day rather than when it was written up, so the
  check-ins due since are not counted as missed. A decision is dated by its
  session's day. A milestone that an imported check-in marks done is dated by
  that check-in.
  
  The quarterly review in the company space now covers every objective in the
  cycle, so one review can decide them all, as METHOD §8 has it. A team's
  review still covers only its own.

- [#110](https://github.com/open-okr/open-okr/pull/110) [`a0319a9`](https://github.com/open-okr/open-okr/commit/a0319a96071d699ca29ddd304de190f69b867806) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - `pnpm db:seed --year` now runs Q2 to its close. Brightline launches in week
  6; two days later a leadership session starts C5, stops C4, moves CS2 and
  M1, makes C2 aspirational and eases S2.1, each with its reason and its day.
  Ben leaves and S2.1 moves to Jonas, the questionnaires meet a decision and a
  trust-centre page, and C5.1 finds the win rate C5.4 aims from. The review and
  the retrospective are held two days apart, the diagnostic reads a strategy
  or OKR-quality problem at 0.59 with the rhythm kept, and Q3's revalidation
  eases A4's win rate and revises the not-doing list.
  
  `sessions.create` takes a `part`, so a review held in two sessions can be
  scheduled by hand as booking schedules it. Revising the annual frame keeps
  its strategies, and the objectives aligned to them, when the strategies did
  not change. A stopped objective's key results no longer hold up a cycle's
  close, and the scorecard shows an eased target beside the target the plan
  published with rather than a draft's.

- [#110](https://github.com/open-okr/open-okr/pull/110) [`2df3862`](https://github.com/open-okr/open-okr/commit/2df386225b3c25704dffe531e743eca74cdc0d72) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - `pnpm db:seed --year` now plans Q4 and runs it to December. Expansion comes
  back first on the issue list as C8, CS1 rises to company level as C7 for
  renewal season, and C2 becomes Customer Success's CS3; both steps publish.
  Mei returns and takes E1 back, the failover outage of 3 December turns
  uptime unhealthy and is answered with a task rather than a recovery, and
  November's margin reads healthy with the recovery still open.
  
  A company objective can now be moved into a space, where it becomes that
  space's objective, as a modified objective carried to the team that will
  run it next. A person's objective still cannot.

- [#110](https://github.com/open-okr/open-okr/pull/110) [`fe540d2`](https://github.com/open-okr/open-okr/commit/fe540d2beede8d9ea51d61faa2fb5e8865488bca) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Stage ten of the quarterly review, Learnings, no longer drafts the next
  cycle (METHOD.md §8.10: hold the review before drafting). The draft form
  and the assist that proposed drafts from the carried learnings are gone;
  a line under the learning composer says an idea for the next cycle is a
  learning marked to carry, which reaches the next cycle's issue list, and
  kept or modified objectives reach its Phase 4 as drafts on their own.
  Drafts written before still show, read-only, and in the minutes.
  
  `sessions.draftNextCycle` and `sessions.proposeFromLearnings` are
  deprecated and will be removed in 0.3, with the `next_cycle_drafts`
  table.

### Patch Changes

- [#110](https://github.com/open-okr/open-okr/pull/110) [`214ffc7`](https://github.com/open-okr/open-okr/commit/214ffc717c27e4b123c2090a7ff0015f838caa36) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The demo shows what 0.2.0 ships. Its current quarter holds a milestone key
  result beside the metrics, Amara's agreed definition of a 90-day renewal,
  alongside its committed and aspirational objectives. Its finished quarter
  has an objective started in week three, which the scorecard counts among
  what moved and whose check-ins begin that week. The user guide describes
  writing and changing OKRs, the kinds, the three responses to an unhealthy
  KPI and the quarterly review as 0.2.0 has them.

- [#110](https://github.com/open-okr/open-okr/pull/110) [`1766c7c`](https://github.com/open-okr/open-okr/commit/1766c7c2eb98858dface92e91495522949dcd27f) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - `pnpm db:seed --year` builds the Northwind year: the scenario in
  `docs/scenarios/northwind-year` placed on the real calendar, with every
  event dated on or before today written and nothing after it. Each date
  keeps its distance from its quarter's first Monday, so a Monday check-in
  stays a Monday in any year.
  
  This first part writes the year's frame: fourteen people with the days they
  arrive and leave, nine spaces with Support archived and Growth formed on
  their own dates, "Team" in terminology, the year's practice settings
  changes on their dates, eleven KPIs judged by their own thresholds with a
  reading for every month as it is recorded, and the annual frame with its
  four objectives, published. The quarters follow in later parts.

- [#110](https://github.com/open-okr/open-okr/pull/110) [`43b8b6d`](https://github.com/open-okr/open-okr/commit/43b8b6db386387a900195c21f146e5b3547b4944) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - `pnpm db:seed --year` now writes the pilot quarter and Q1's plan. The pilot
  runs with Product and Customer Success, checks in every Monday from
  October, takes Tomás's confidence down to 3 in 10 in week five, is reviewed
  with two learnings for Q1's input pack, and closes at 0.55, its scores
  landing in Q1's prior-cycle list. Q1 opens four weeks ahead, ranks four
  issues, revalidates the frame, books its rhythm, publishes the company set
  first and the teams' set on 15 January, with the peer review's rewrites,
  its two objectives turned into initiatives, a deleted duplicate, two
  confirmed dependencies and the capacity cut on record.

- [#110](https://github.com/open-okr/open-okr/pull/110) [`330dac8`](https://github.com/open-okr/open-okr/commit/330dac8c9f5cbbc51c42d5e2a88ce99db9a2dd03) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - `pnpm db:seed --year` now plans Q2 and runs it to its first monthly review.
  The eleven objectives Q1 kept or modified come back as Q2's drafts, each key
  result starting where Q1 left it, and are redrafted: retargeted, given Q2's
  due dates and capacity verdicts, aligned again, and joined by four new
  objectives. The company set publishes on 29 March and the teams' on
  15 April, past OBJ-1 with the override reason on record. Engineering's third
  objective becomes an initiative, Yuki follows Product's objective, and
  Customer Success's dependency on Product is escalated and confirmed. The
  company checks in from week 1, the teams from week 3, and the May review
  gives each company objective a trend.

- [#110](https://github.com/open-okr/open-okr/pull/110) [`2299409`](https://github.com/open-okr/open-okr/commit/229940932ba8624e2e81a45cd273370084c8f717) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - `pnpm db:seed --year` now runs Q3 to its close. Product marks two holiday
  weeks and checks in nothing in them, Amara stands in for Sara and Leo for
  Mei, Support merges into Customer Success with SU1 moved first, and the
  Growth team starts G1 with a baseline and sets its target once it is found.
  F3's milestones and the SOC 2 report land on their days, and the review and
  retrospective, held apart, grade 0.66 with seven of eleven commitments met
  and read results delivered with the holiday weeks left out.
  
  A retrospective scheduled by hand now names the review scheduled before it,
  rather than a review booked later for the same cycle.

- [#110](https://github.com/open-okr/open-okr/pull/110) [`86ea55e`](https://github.com/open-okr/open-okr/commit/86ea55e61c0df2126f18bdf23a1203accc02c8b7) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - `pnpm db:seed --year` now plans Q3 and launches the margin recovery. Q2's
  kept and modified objectives are redrafted for Q3 beside the deferred
  expansion on Phase 2's list, C2 is committed again, and the company step
  publishes on 28 June. On 6 July C6 is launched from the operating margin
  KPI, which has read unhealthy for two months: committed, at company level,
  its first key result the KPI itself from 7.6% to 13.5%, with the renewal
  discount in place of two drivers other objectives already own, and the
  expansion KPI answered by C6.2. The teams add S3 and F3 and publish on
  14 July, and Sales checks in every two weeks.
- Updated dependencies [[`fecd1c1`](https://github.com/open-okr/open-okr/commit/fecd1c18556e938627c4f5094b22a751297aedca), [`bf256ef`](https://github.com/open-okr/open-okr/commit/bf256eff36f8e8b601559bc381c624b2fa2ad9eb), [`fa5b9d2`](https://github.com/open-okr/open-okr/commit/fa5b9d2d03e12d93b22014facd8adb3d5de4d1d7)]:
  - @openokr/db@0.2.0
  - @openokr/method@0.2.0
  - @openokr/config@0.2.0

## 0.1.2

### Patch Changes

- Updated dependencies []:
  - @openokr/config@0.1.2
  - @openokr/db@0.1.2
  - @openokr/method@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies []:
  - @openokr/config@0.1.1
  - @openokr/db@0.1.1
  - @openokr/method@0.1.1

## 0.1.0

### Patch Changes

- Updated dependencies []:
  - @openokr/config@0.1.0
  - @openokr/db@0.1.0
  - @openokr/method@0.1.0
