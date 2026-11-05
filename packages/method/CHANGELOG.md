# @openokr/method

## 0.5.0

### Minor Changes

- [#178](https://github.com/open-okr/open-okr/pull/178) [`8c20438`](https://github.com/open-okr/open-okr/commit/8c204380b6c21e1984a2a3de321bca7e238b74fd) Thanks [@agungksidik](https://github.com/agungksidik)! - "Kind" reads "Type": an objective's committed or aspirational choice and a key result's metric, maintain, milestone or baseline are its type, in METHOD.md §2.8, §2.10 and §12 and on screen. The practice settings are "OKR types" and "Key result types". Stored values do not change.

- [#178](https://github.com/open-okr/open-okr/pull/178) [`e73b7aa`](https://github.com/open-okr/open-okr/commit/e73b7aa0a1d54c84a2619f7337d18121bea3f685) Thanks [@agungksidik](https://github.com/agungksidik)! - The Work Map's On track colour comes from two new registry thresholds, `scoring.onTrackShareHealthy` (70) and `scoring.onTrackShareWatch` (40), defined in METHOD.md §3.5 and §11, where the numbers were written into the screen.

- [#178](https://github.com/open-okr/open-okr/pull/178) [`0c03fdf`](https://github.com/open-okr/open-okr/commit/0c03fdfd59290e68f1f67349297858ce2ef08357) Thanks [@agungksidik](https://github.com/agungksidik)! - The person accountable for a goal is called the Owner by default, where it was the Champion. "Champion" is now the suggested alternative on the terminology card, and a workspace that renamed the term keeps its own word. The OKR Champion agent keeps its name. METHOD.md §0 and §2.5 say Owner, and the quality checks, gates, rule pages and goal exports follow. Goal list exports head the column "Owner".

- [#168](https://github.com/open-okr/open-okr/pull/168) [`3dbba8c`](https://github.com/open-okr/open-okr/commit/3dbba8cabe4736ebe041dec8eb365a4f5ee0bfc9) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Every setting, profile and comparison row on Admin, Practice has a small "i" that says what it decides, in a sentence or two, with a link to its exact section of the method for the full write-up. It opens on hover, on tap and from the keyboard. The practice read in the API now returns each setting's summary as well.

- [#167](https://github.com/open-okr/open-okr/pull/167) [`570a0a2`](https://github.com/open-okr/open-okr/commit/570a0a2f6023efa1b5a613e63b68dbb42b1834b1) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Admin, Practice has a "Compare profiles" button that shows Recommended, Google-style, Radical Focus, Lightweight and Governed side by side: every setting and threshold one of them changes, with the profile in use marked and each value that differs from Recommended in bold. The page also links to the full method, as the running release shipped it. METHOD.md carries the same table, and the conformance check now holds it to what choosing each profile does.

- [#174](https://github.com/open-okr/open-okr/pull/174) [`91af1bf`](https://github.com/open-okr/open-okr/commit/91af1bfb6bcc8c82045a752e8e35dcd9cb5f8ab2) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Every threshold on Admin, Rhythm and thresholds has a small "i". Where its reason cites a principle by number, such as "(principle 5)", the hint says what that principle is. It also names the part of the method the threshold comes from and links to that exact section. Check-in frequency and the anchor day, which show no reason on the card, carry theirs in the hint.

- [#175](https://github.com/open-okr/open-okr/pull/175) [`80354db`](https://github.com/open-okr/open-okr/commit/80354dbe05088a837c1bcef61fff31ac9d067f80) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - A rule named by its key explains itself where it is named. Resting on a verdict such as "KR-3" on a goal's coach strip, on "Read the rule" in the goals list, or on a nudge's rule on the review inbox and the nudge volume page shows the rule's name, what kind it is, what a check looks for or when a nudge fires and who hears it. A click still opens the rule's page, and a quality check's page now links to its exact section of the method.

### Patch Changes

- [#166](https://github.com/open-okr/open-okr/pull/166) [`28b8ee0`](https://github.com/open-okr/open-okr/commit/28b8ee02b6c0f6c63ae5a1927115dbc33f932a21) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - No screen, message, API description, command help or import report cites a specification section ("§2.9") any more, and no API description names a screen code ("Drives screen S-27"). Each sentence now says what it means in words. The Grafana dashboard "the §13.1 budgets" is now "Performance budgets". The practice settings screen no longer prints a section and source under each setting, and its "As §4" and "As §8.4" options read "As the method". The KPI trees page no longer lists unbuilt work under "Not here yet". The `section` field that `practice.read` and `rhythm.read` return is now the section number alone, "4.5" rather than "§4.5".

- [#173](https://github.com/open-okr/open-okr/pull/173) [`f016dd5`](https://github.com/open-okr/open-okr/commit/f016dd5caf2ec0a842d2365fad2a72dc73918660) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Admin, Practice no longer offers a "Scoring" on or off switch. It never did anything: turning it off changed nothing, and nothing in the method said what off should mean. A workspace that had turned it off loses nothing, and the switch is dropped from its stored settings the next time any practice setting is saved. Key results are scored at the close as before.

## 0.4.0

### Minor Changes

- [#161](https://github.com/open-okr/open-okr/pull/161) [`af6432b`](https://github.com/open-okr/open-okr/commit/af6432b60ff60d740859c9b23485d7ceb74dac0b) Thanks [@agungksidik](https://github.com/agungksidik)! - The review inbox can be cleared.
  
  Each acknowledgement row shows the check-in's status and the first line of what
  it says, and "Acknowledge all" acknowledges every listed one in one press. A
  check-in nobody acknowledged within 14 days lapses: it leaves Review and the
  acknowledgement ladder stops asking, and it is not recorded as acknowledged.
  The window is the new §11 threshold `cadence.acknowledgementWindowDays`, which
  a workspace can change in Admin, Rhythm.

- [#161](https://github.com/open-okr/open-okr/pull/161) [`76abcf5`](https://github.com/open-okr/open-okr/commit/76abcf55b67cf00df66bad50a28522c7b8f1e23b) Thanks [@agungksidik](https://github.com/agungksidik)! - A member can check in on any day, not only when the goal is due.
  
  The check-in page lists the member's other goals under "Update any time". A
  goal that is not due offers "Post an update", which opens the usual composer.
  An update posted more than the cadence tolerance before the due date is an
  extra update: it moves health and progress, and the due date, its nudge and
  the blocker clock stay where they were. Before this, an early check-in used up
  the next period and that Monday's reminder never came.
  
  The check-in page and the Review inbox now list the same goals, so the Review
  can no longer say a check-in is owed while the check-in page says nothing is
  due. The rhythm share in the review diagnostic counts an extra update as
  answering nothing, the way the cadence does. `goals.due` accepts up to 366
  days ahead.

- [#161](https://github.com/open-okr/open-okr/pull/161) [`6c5c2cc`](https://github.com/open-okr/open-okr/commit/6c5c2ccb9e57a82026f76b60b585a9d04c6dfc56) Thanks [@agungksidik](https://github.com/agungksidik)! - A champion with two or more goals due on the anchor day gets one message,
  "Your check-ins this week", instead of one reminder per goal. It opens the
  check-in walker, which holds every goal due and opens the first one with its
  values filled in; in chat its button starts the check-in and offers the goals
  that are due. One goal due keeps its own reminder. The new rule key is
  `checkin.week`.

- [#161](https://github.com/open-okr/open-okr/pull/161) [`214cbb3`](https://github.com/open-okr/open-okr/commit/214cbb381530b9d192970688b6555ba7d2a03b91) Thanks [@agungksidik](https://github.com/agungksidik)! - A key result that reads a KPI now measures progress from its own baseline to
  its own target.
  
  The KPI's latest reading is still the key result's current value. What changed
  is the percentage: it used to be the KPI's achievement against the KPI's own
  target, so "Raise deflection from 31% to 35%" at a reading of 31 showed 89%. It
  now shows 0%, the same as any other key result at its baseline. Changing a
  KPI's target no longer moves the key results that read it. Goal progress
  recomputes the next time the KPI is recorded or the goal changes.

- [#161](https://github.com/open-okr/open-okr/pull/161) [`73845cc`](https://github.com/open-okr/open-okr/commit/73845ccf4f0d53312158d1aa30b3643205e935c2) Thanks [@agungksidik](https://github.com/agungksidik)! - A member sees their own check-in streak on the check-in page.
  
  It counts the periods in a row in which they posted a check-in on a goal they
  champion, by the same rule as the space's streak. It is paused, and names the
  goal, while one of their goals reads on track with a key result that has not
  moved past the divergence window, so re-entering the same number does not keep
  it alive. A new read action, `goals.myStreak`, serves it and is in the agent
  `core` toolset.

- [#161](https://github.com/open-okr/open-okr/pull/161) [`37ba2a5`](https://github.com/open-okr/open-okr/commit/37ba2a56fc26177edccad4e8e1aba259534b9492) Thanks [@agungksidik](https://github.com/agungksidik)! - A workspace can put a peer step in the check-in ladder.
  
  The new practice setting "Peer step in the check-in ladder" is Off by default,
  so nothing changes until a workspace turns it on. On, a goal whose check-in is
  past its grace asks one teammate from its space to offer a hand, under the new
  rule `checkin.peer`, before the reviewer hears; the reviewer joins at the
  coordinator's day. A peer champions another goal in the same cycle, is up to
  date on their own check-ins, can read the goal, and is not its reviewer or the
  space's coordinator. The one asked least recently is chosen, and where nobody
  qualifies the step is skipped.

### Patch Changes

- [#161](https://github.com/open-okr/open-okr/pull/161) [`8625cc1`](https://github.com/open-okr/open-okr/commit/8625cc17565e17db2efb1e57d3b1e18e16760918) Thanks [@agungksidik](https://github.com/agungksidik)! - The goal page and the drafting list no longer say "no parent, gate 3 is red"
  for a goal that has a parent.
  
  Both printed the sentence whenever the contribution statement was empty, while
  the side panel showed the parent the goal supports. They now ask the same
  question the publish gate asks: a parent, a contribution statement or a reason
  to stand alone.

- [#161](https://github.com/open-okr/open-okr/pull/161) [`6111207`](https://github.com/open-okr/open-okr/commit/611120788bb00e3fa1916b61acc93e236d7eb76f) Thanks [@agungksidik](https://github.com/agungksidik)! - Copy that explained the system's internals now tells the reader what it means
  for them.
  
  Admin, Rhythm no longer shows ticket numbers and a changelog in its threshold
  notes, and the escalation note says the sponsor step applies only where the
  workspace adds it. The vote note, the role note on a goal and the Review header
  say what happens rather than how it is computed. A key result's confidence on
  the goal page carries a visible "Confidence" label, apart from its value.

## 0.3.1

No changes in this release.

## 0.3.0

### Patch Changes

- [#120](https://github.com/open-okr/open-okr/pull/120) [`149f16e`](https://github.com/open-okr/open-okr/commit/149f16ea69d791c1e6d4b6abcd84c14f13cc9dc7) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - KPI numbers are easier to type and check.
  
  The KPI add form, a tree's new driver, how a KPI is judged, the KPI grid,
  the suggestion and a recovery's from and to all use number fields that show
  numbers grouped the way you read them and step with the arrow keys. In the
  grid the arrow keys still move between cells.
  
  Adding a KPI or a driver now asks for its unit, suggesting the units your
  KPIs already use and common ones. How a KPI is judged says straight away when
  its red value sits on the wrong side of green, with the same sentence a save
  would be refused with, and shows the KPI's unit beside each value. A range's
  band is labelled "Green from" and "Green to", where the second was only "to".

- [#120](https://github.com/open-okr/open-okr/pull/120) [`ba0488e`](https://github.com/open-okr/open-okr/commit/ba0488e4787f05b21570d30f9e30d39bdfa962da) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Numbers on the OKR screens are easier to type and read.
  
  Values, targets, baselines and weights in the OKR list, drawer and diagram,
  on a goal's page and in drafting show numbers grouped the way you read them
  (1,234.5), step with the arrow keys, and show the measure's unit beside them.
  A value field also says where the measure starts and where it is going, for
  example "from 40 to 75 %". Emptying a field records nothing rather than 0.
  
  The unit field suggests the units the cycle already uses, then common ones
  (%, people, US$, days, hours, points), and still takes any unit you type.
  
  Breaking for API clients: a weight must be from 0 to 100. A goal or key
  result sent with a weight outside that range is now refused with a message,
  where it used to be stored as 0 or 100 without saying so. Both importers
  still bring a weight outside the range in as 0 or 100, as before.

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

## 0.1.2

No changes in this release.

## 0.1.1

No changes in this release.

## 0.1.0

No changes in this release.
