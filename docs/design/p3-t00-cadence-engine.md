# P3-T00: the cadence engine

Part three of the Phase 3 design gate. Authority: METHOD.md §7 and §11,
TECHNICAL-PLAN.md §6.3, REQUIREMENTS.md §51. Implemented at P3-T06 in
`packages/core/src/cadence/engine.ts` as pure date arithmetic, with the row
reading and writing beside it in `service.ts`.

**One correction from the implementation.** The escalation ladder in §7 went to
`packages/method/src/escalation.ts` rather than into the core engine. Which roles
it widens to is §11 practice, and practice lives in the method package. The date
arithmetic stayed in core, where the local-date primitives already were.

**The sweep in §5 is a command, not a job.** No scheduler host runs in the
application yet, so `pnpm cadence:sweep` is how it runs, the same shape
`pnpm audit:verify` already has. It goes through the Operation pipeline per
workspace, so a health flip nobody triggered is still audited.

This is the engine that makes health honest. If the next due date is wrong,
staleness is wrong, and a neglected goal quietly stays green. That is the one
thing METHOD.md §1 principle 8 forbids.

## 1. Contract and shape decisions

```
firstDue(from, frequency, anchor, tz)                        -> LocalDate
advance(due, frequency, anchor)                              -> LocalDate
nextAfterPublication(due, publishedOn, frequency, anchor, tolerance)
                                                             -> { next: LocalDate, missedPeriod: boolean }
dueInstant(due, tz)                                          -> Instant
isOutdated(due, today, graceDays)                            -> boolean
escalation(daysPastDue, graceDays, ladder)                   -> { step: number, targets: Role[] }
```

| Decision | Choice | Why |
|---|---|---|
| Due dates are local dates, not instants | Every step of the arithmetic runs on the calendar in the workspace timezone. Conversion to an instant happens once, at the end | A daylight-saving shift must never move a Monday deadline to a Sunday |
| The stored instant is the local end of the due date | `23:59:59.999` in the workspace timezone | A check-in posted at any hour of the due date is on time, which is what a human means by "due Monday". It also avoids the local midnight that does not exist on some transition days |
| Weeks step by 7 days, not by weekday search | `advance` on a weekly goal adds 7 days to the current due date | The anchor weekday is already baked into the first due date, so addition preserves it and cannot drift |
| Month clamping is not sticky | `advance` recomputes from the **anchor** day each month, not from the last clamped result | Anchor 31 must read 31 Jan, 28 Feb, 31 Mar. Stepping from 28 Feb would silently rewrite the anchor to 28 |
| Quarterly steps three months from the first due date | Not from the calendar quarter | A check-in rhythm belongs to the goal, not to the fiscal calendar. Cycles are the thing anchored to calendar quarters |

**Decision D-14 (mechanical).** §11 names one frequency default, "weekly", and
never enumerates the set. The set is `daily`, `weekly`, `biweekly`, `monthly`,
`quarterly`. `biweekly` is spelled the way the FlowyTeam reference model spells
it, so the importer needs no translation table. Anchor is an ISO weekday 1 to 7
for `weekly` and `biweekly`, a day of month 1 to 31 for `monthly` and
`quarterly`, and unused for `daily`.

## 2. Advancing one period

<!-- golden: cadence.advance -->

| case | frequency | anchor | current_due | expected_next |
|---|---|---|---|---|
| daily | daily | | 2026-08-11 | 2026-08-12 |
| weekly on Monday | weekly | 1 | 2026-08-10 | 2026-08-17 |
| weekly on Friday | weekly | 5 | 2026-08-14 | 2026-08-21 |
| weekly across a year boundary | weekly | 1 | 2026-12-28 | 2027-01-04 |
| biweekly on Monday | biweekly | 1 | 2026-08-10 | 2026-08-24 |
| monthly mid-month | monthly | 15 | 2026-08-15 | 2026-09-15 |
| monthly anchored to the 31st into February | monthly | 31 | 2026-01-31 | 2026-02-28 |
| monthly clamping is not sticky | monthly | 31 | 2026-02-28 | 2026-03-31 |
| monthly anchored to the 31st into a leap February | monthly | 31 | 2028-01-31 | 2028-02-29 |
| monthly anchored to the 30th into February | monthly | 30 | 2026-01-30 | 2026-02-28 |
| monthly recovering the 30th after February | monthly | 30 | 2026-02-28 | 2026-03-30 |
| monthly across a year boundary | monthly | 1 | 2026-12-01 | 2027-01-01 |
| quarterly from a 31-day month into a 30-day one | quarterly | 31 | 2026-03-31 | 2026-06-30 |
| quarterly recovering after a clamp | quarterly | 31 | 2026-06-30 | 2026-09-30 |
| quarterly into December | quarterly | 31 | 2026-09-30 | 2026-12-31 |

## 3. The first due date

The first occurrence **strictly after** the reference date. A goal created on
its own anchor day is not due the same day: the anchor day is a deadline, and a
goal created at 4pm on Monday has not had a period to report on yet.

<!-- golden: cadence.first-due -->

| case | frequency | anchor | from_date | expected_first |
|---|---|---|---|---|
| daily | daily | | 2026-08-11 | 2026-08-12 |
| weekly, created on a Tuesday | weekly | 1 | 2026-08-11 | 2026-08-17 |
| weekly, created on the anchor day itself | weekly | 1 | 2026-08-10 | 2026-08-17 |
| weekly, anchor is tomorrow | weekly | 2 | 2026-08-10 | 2026-08-11 |
| biweekly, created on a Tuesday | biweekly | 1 | 2026-08-11 | 2026-08-17 |
| monthly, anchor still ahead this month | monthly | 15 | 2026-08-11 | 2026-08-15 |
| monthly, created on the anchor day | monthly | 15 | 2026-08-15 | 2026-09-15 |
| monthly, anchor clamped in a short month | monthly | 31 | 2026-02-01 | 2026-02-28 |
| quarterly, anchor already past this month | quarterly | 1 | 2026-08-11 | 2026-11-01 |
| quarterly, anchor still ahead this month | quarterly | 20 | 2026-08-11 | 2026-08-20 |

## 4. Advancing after a publication

Two rules, and the order matters.

1. Advance one period **from the due date**, never from the publication date.
2. Keep advancing while the result is on or before the publication date.

Rule 1 is why an early or a late check-in does not shift the rhythm: a goal due
Mondays stays due Mondays after a Tuesday check-in. Rule 2 is why a champion
who vanishes for a month does not return to a backlog of four overdue periods.

The tolerance (§11, one day by default) does not change the next due date. It
decides whether the period that just ended was **met** or **missed**, which is
what the streak and the escalation ladder read. A publication after
`due + tolerance` is a missed period. A publication before the due date is
never missed, however early it is.

<!-- golden: cadence.after-publication -->

| case | frequency | anchor | current_due | published_on | tolerance_days | expected_next | expected_missed |
|---|---|---|---|---|---|---|---|
| exactly on time | weekly | 1 | 2026-08-10 | 2026-08-10 | 1 | 2026-08-17 | no |
| one day early | weekly | 1 | 2026-08-10 | 2026-08-09 | 1 | 2026-08-17 | no |
| one day late, inside tolerance | weekly | 1 | 2026-08-10 | 2026-08-11 | 1 | 2026-08-17 | no |
| three days early, outside tolerance | weekly | 1 | 2026-08-10 | 2026-08-07 | 1 | 2026-08-17 | no |
| four days late | weekly | 1 | 2026-08-10 | 2026-08-14 | 1 | 2026-08-17 | yes |
| published on the following anchor day | weekly | 1 | 2026-08-10 | 2026-08-17 | 1 | 2026-08-24 | yes |
| four weeks late skips the backlog | weekly | 1 | 2026-08-10 | 2026-09-07 | 1 | 2026-09-14 | yes |
| a workspace with a three-day tolerance | weekly | 1 | 2026-08-10 | 2026-08-13 | 3 | 2026-08-17 | no |
| daily on time | daily | | 2026-08-11 | 2026-08-11 | 1 | 2026-08-12 | no |
| daily four days late | daily | | 2026-08-11 | 2026-08-15 | 1 | 2026-08-16 | yes |
| monthly one day late | monthly | 31 | 2026-01-31 | 2026-02-01 | 1 | 2026-02-28 | no |
| monthly two days late | monthly | 31 | 2026-01-31 | 2026-02-02 | 1 | 2026-02-28 | yes |
| biweekly on time | biweekly | 1 | 2026-08-10 | 2026-08-10 | 1 | 2026-08-24 | no |

## 5. Staleness

`isOutdated` is true when `today > due + graceDays`, on local dates. The
boundary is exclusive: at exactly the grace limit the goal is not yet outdated.
This matches the health matrix in
[the scoring document](p3-t00-scoring-and-health-engine.md#4-health).

The staleness sweep is a job. It writes health only, for the goals whose grace
boundary has passed since the last sweep, and it is idempotent.

<!-- golden: cadence.staleness -->

| case | due_date | today | grace_days | expected_outdated |
|---|---|---|---|---|
| not yet due | 2026-08-10 | 2026-08-09 | 3 | no |
| due today | 2026-08-10 | 2026-08-10 | 3 | no |
| inside the grace window | 2026-08-10 | 2026-08-12 | 3 | no |
| exactly at the grace limit | 2026-08-10 | 2026-08-13 | 3 | no |
| one day past the grace | 2026-08-10 | 2026-08-14 | 3 | yes |
| a five-day grace still holds | 2026-08-10 | 2026-08-15 | 5 | no |
| a five-day grace expires | 2026-08-10 | 2026-08-16 | 5 | yes |
| a zero grace expires the next day | 2026-08-10 | 2026-08-11 | 0 | yes |
| ten days gone | 2026-08-10 | 2026-08-20 | 3 | yes |

## 6. Timezones and daylight saving

Local end of the due date, converted once. The golden masters below cross both
European and North American transitions in 2026 (Europe on 29 March and 25
October, North America on 8 March and 1 November), a zone that never shifts,
and both ends of the offset range.

<!-- golden: cadence.instant -->

| case | timezone | due_date | expected_instant |
|---|---|---|---|
| Berlin before the spring shift | Europe/Berlin | 2026-03-23 | 2026-03-23T22:59:59.999Z |
| Berlin after the spring shift | Europe/Berlin | 2026-03-30 | 2026-03-30T21:59:59.999Z |
| Berlin before the autumn shift | Europe/Berlin | 2026-10-19 | 2026-10-19T21:59:59.999Z |
| Berlin after the autumn shift | Europe/Berlin | 2026-10-26 | 2026-10-26T22:59:59.999Z |
| New York before the spring shift | America/New_York | 2026-03-02 | 2026-03-03T04:59:59.999Z |
| New York after the spring shift | America/New_York | 2026-03-09 | 2026-03-10T03:59:59.999Z |
| New York before the autumn shift | America/New_York | 2026-10-26 | 2026-10-27T03:59:59.999Z |
| New York after the autumn shift | America/New_York | 2026-11-02 | 2026-11-03T04:59:59.999Z |
| a zone that never shifts | Asia/Jakarta | 2026-08-10 | 2026-08-10T16:59:59.999Z |
| the reference zone | UTC | 2026-08-10 | 2026-08-10T23:59:59.999Z |
| the far end of the offset range | Pacific/Kiritimati | 2026-08-10 | 2026-08-10T09:59:59.999Z |
| the other far end | Pacific/Niue | 2026-08-10 | 2026-08-11T10:59:59.999Z |

The Berlin pair is the case that matters. Both due dates are Mondays, one week
apart. The stored instants differ by 167 hours rather than 168, and the local
deadline is 23:59 on both. Arithmetic done on instants would have produced a
Sunday deadline for half the year.

## 7. The escalation ladder

§11: champion at due, champion again at one day overdue, reviewer when the
grace is exceeded, coordinator at seven days, sponsor at fourteen. Targets
accumulate rather than replace, because the champion keeps being asked while
the escalation widens.

P3-T06 computes the step. P4-T05 sends the nudges. Splitting it this way means
the ladder is golden-master tested with no channel, no queue and no clock.

| Step | Fires at | Targets |
|---|---|---|
| 0 | The due-soon lead, one day before the anchor day | champion |
| 1 | The due date | champion |
| 2 | One day overdue | champion |
| 3 | The grace boundary is exceeded | champion, reviewer |
| 4 | Seven days overdue | champion, reviewer, coordinator |
| 5 | Fourteen days overdue | champion, reviewer, coordinator, sponsor |

Where a space has no coordinator, the target resolves to the space manager
(TECHNICAL-PLAN.md §4.2). The engine returns the role; resolving the role to a
member is the caller's job.

<!-- golden: cadence.escalation -->

| case | days_past_due | grace_days | expected_step | expected_targets |
|---|---|---|---|---|
| the day before it is due | -1 | 3 | 0 | champion |
| two days before, nothing fires | -2 | 3 | | |
| on the due date | 0 | 3 | 1 | champion |
| one day overdue | 1 | 3 | 2 | champion |
| still inside the grace | 2 | 3 | 2 | champion |
| the last day of the grace | 3 | 3 | 2 | champion |
| the grace is exceeded | 4 | 3 | 3 | champion,reviewer |
| still with the reviewer | 6 | 3 | 3 | champion,reviewer |
| a week overdue | 7 | 3 | 4 | champion,reviewer,coordinator |
| still with the coordinator | 13 | 3 | 4 | champion,reviewer,coordinator |
| a fortnight overdue | 14 | 3 | 5 | champion,reviewer,coordinator,sponsor |
| long abandoned | 30 | 3 | 5 | champion,reviewer,coordinator,sponsor |
| a longer grace delays the reviewer | 4 | 5 | 2 | champion |
| a longer grace, then the reviewer | 6 | 5 | 3 | champion,reviewer |

## 7b. The other two ladders (P4-T04c)

§11 carries three ladders and P3-T06 built one. These are the other two, added
when the nudge engine needed them.

**Acknowledgement.** §11: "reviewer nudged one day after publication, escalated
at three". The champion is never on this ladder. They did their part, and
chasing them for somebody else's acknowledgement is how a product teaches people
its messages are not about them.

<!-- golden: cadence.acknowledgement -->

| case | days_since_publication | expected_step | expected_targets |
|---|---|---|---|
| the day it was published | 0 | | |
| a day later, the reviewer is asked | 1 | 1 | reviewer |
| still only the reviewer | 2 | 1 | reviewer |
| three days, the coordinator is brought in | 3 | 2 | reviewer,coordinator |
| a week later, no further | 7 | 2 | reviewer,coordinator |

**Blocker.** §11: "owner warned at twenty hours, coordinator at twenty-four,
sponsor at forty-eight. The warning arrives before the deadline, not after it."
Hours rather than days, because a blocker's clock is twenty-four hours and a
ladder measured in days could not fire twice inside it.

Nothing calls this yet: blockers are rows from P4-T07c. It is here so the ladder
is tested beside the other two rather than written in a hurry beside the screen
that first needs it.

<!-- golden: cadence.blocker -->

| case | hours_since_opened | expected_step | expected_targets |
|---|---|---|---|
| just opened | 0 | | |
| nineteen hours, still quiet | 19 | | |
| the twenty-hour warning, before the deadline | 20 | 1 | champion |
| the clock runs out | 24 | 2 | champion,coordinator |
| a day and a half | 36 | 2 | champion,coordinator |
| two days, the sponsor hears | 48 | 3 | champion,coordinator,sponsor |
| a week | 168 | 3 | champion,coordinator,sponsor |

## 8. What resets the cadence

| Event | Effect on `next_check_in_at` |
|---|---|
| Goal created | `firstDue(created_on, ...)` |
| Check-in published | `nextAfterPublication(...)` |
| Latest check-in deleted | Recomputed from the previous check-in's publication date, or from the goal's creation date when there is none |
| Frequency or anchor changed | `firstDue` from the later of the last publication date and today. A change never makes a goal instantly overdue |
| Goal closed | Cleared. A closed goal is never due |
| Goal reopened | `firstDue(reopened_on, ...)` |
| Goal moved to another cycle | Unchanged. The rhythm belongs to the goal |
| Workspace default frequency changed | Nothing. Goals hold their own frequency, seeded from the default at creation |

That last row is a deliberate choice. Changing the workspace default silently
rewriting every existing goal's rhythm would move thousands of deadlines from
one setting change.

## 9. Acceptance criteria

**Given** a weekly goal anchored to Monday and due 2026-08-10, **when** the
champion publishes a check-in on 2026-08-09, **then** the next due date is
2026-08-17.

**Given** the same goal with a three-day grace, **when** the sweep runs on
2026-08-14 with no check-in published, **then** the goal reads `outdated`
everywhere it appears, and on 2026-08-13 it does not.

**Given** a workspace in `Europe/Berlin` with a goal due 2026-03-30, **when**
the due instant is computed, **then** it is `2026-03-30T21:59:59.999Z`, one hour
earlier in absolute terms than the same weekday a week before, and both read
23:59 locally.

**Given** a monthly goal anchored to the 31st and due 2026-01-31, **when** it
advances twice, **then** the due dates are 2026-02-28 and then 2026-03-31, not
2026-03-28.

**Given** a goal eight days overdue with a three-day grace, **when** the
escalation is computed, **then** the step is 4 and the targets are the champion,
the reviewer and the coordinator, with the coordinator falling back to the space
manager when none is named.
