# The numbers

Every threshold the practice runs on. These are not invented per instance:
they live in one registry, the product reads them from there, and
`pnpm check:docs` checks this page against that registry so the two cannot
drift.

An administrator can change many of them on **Admin, then Rhythm and
thresholds**. The values below are the defaults, and each says where in
[METHOD.md](../development-plan/METHOD.md) it comes from.

## Cadence

| Threshold | Default | Section |
|---|---|---|
| `cadence.checkInFrequency` | weekly | §7.1 |
| `cadence.anchorDay` | 1 | §7.1 |
| `cadence.toleranceDays` | 1 | §7.1 |
| `cadence.stalenessGraceDays` | 3 | §3.5 |
| `cadence.blockerLadderDays` | reminder 1 | §11 |
| `cadence.nudgeDeduplicationHours` | 24 | §11 |
| `cadence.nudgeCeilingPerWeek` | 5 | §11 |
| `cadence.dueSoonLeadDays` | 1 | §11 |
| `cadence.reviewPreparationLeadWeeks` | 2 | §11 |

**Weekly, anchored to Monday, with a day of tolerance.** A week is short enough
to act on and long enough to have moved, and anchoring to Monday means the week
is planned rather than reported on afterwards.

**Three days of grace before a goal reads as outdated.** After that, staleness
overrides whatever health its owner last reported.

**A blocker has until the next check-in.** Its next action is due by the next
check-in of the goal it blocks. The owner is reminded the day before, and the
coordinator hears if the check-in passes with the action still open. The
sponsor hears only where your workspace puts the sponsor in its ladders.

**Five nudges a week, deduplicated to one per subject per member per day.** A
product that speaks more than that is one people learn to ignore, which is the
same as a product that says nothing. Anything past the five waits for your
next morning summary, which lists it, so nothing held back is lost; an
escalation about somebody else's work always gets through.

## Confidence and scoring

| Threshold | Default | Section |
|---|---|---|
| `scoring.confidenceHigh` | 0.7 | §3.2 |
| `scoring.confidenceLow` | 0.4 | §3.2 |
| `scoring.confidenceCritical` | 0.3 | §3.2 |
| `scoring.aspirationalDraftTarget` | 0.5 | §3.2 |
| `scoring.draftSandbagging` | 0.9 | §3.2 |
| `scoring.draftComfortable` | 0.7 | §3.2 |
| `scoring.draftAmbitious` | 0.3 | §3.2 |
| `scoring.committedConfidenceFloor` | 0.7 | §3.2 |
| `scoring.committedExpectedScore` | 1 | §2.8 |
| `scoring.aspirationalExpectedAverage` | 0.7 | §2.8 |
| `scoring.closeTooSafeShare` | 0.75 | §3.3 |
| `scoring.rootCauseThreshold` | aspirational 0.6, committed 1 | §8.4 |
| `scoring.progressSignalPass` | 75 | §3.7 |
| `scoring.progressSignalFail` | 50 | §3.7 |

**Two kinds of promise, judged differently.** An aspirational objective is a
stretch: about 5 in 10 confidence at drafting is the aim, an average above 0.9
is near certain and the Coach says so, and below 0.3 is a moonshot, allowed
and flagged so it is a choice rather than an accident. A committed objective
is expected in full, so high confidence is right, and a committed key result
below 0.7 is a risk to escalate now.

**A pattern of 1.0 is the too-safe signal, not one score.** At the close, three
quarters or more of the aspirational key results at 1.0 means the targets were
too safe. A committed key result at 1.0 is a promise kept. One short of 1.0
asks for a short explanation of the miss.

**0.4 and 0.3 are where a goal becomes the session's business.** Below 0.4 it
needs discussion; below 0.3 it needs a decision.

## Quality

| Threshold | Default | Section |
|---|---|---|
| `quality.coachStrictness` | warn | §4 |
| `quality.companyObjectiveCap` | 5 | §2.7 |
| `quality.objectivesPerUnitCap` | 3 | §2.7 |
| `quality.inputPackLeadWorkingDays` | 3 | §2.6 |
| `quality.carryForwardIssueImpact` | 4 | §8.9 |

**Five company objectives, three per unit.** More than that is a list of work
rather than a set of priorities, and the cap is the whole point. Above either
the Coach warns rather than refuses: focus is a decision a team makes, and a
workspace that wants the cap to block sets that check to block.

**Two to five key results per objective**, which is `quality.keyResultsPerObjective`.
One is a measure pretending to be an objective; more than five is a plan.

**The input pack closes three working days before the planning session.**
It guides rather than locks: drafting is open while it is incomplete, unless a
workspace has made its phases binding.

## Alignment

| Threshold | Default | Section |
|---|---|---|
| `alignment.healthyThreshold` | 90 | §5.2 |
| `alignment.watchThreshold` | 80 | §5.2 |

Alignment health is a share: of the goals below company level, how many align
to a parent or say why they stand alone. Ninety per cent or more is healthy,
eighty to below ninety is watch, and below eighty is a gap. A cycle with no
company objective at the top reads as a gap whatever the share. A share, not a
points score, so eight unaligned goals weigh lightly in a large company and
heavily in a small one. The score always lists the goals it did not count, so
it is actionable rather than a grade.

## KPIs

| Threshold | Default | Section |
|---|---|---|
| `kpi.healthyThreshold` | 90 | §6.4 |
| `kpi.watchThreshold` | 70 | §6.4 |
| `kpi.recoveryKeyResultCap` | 4 | §6.5 |

**A KPI is judged in its own units first.** Give it a green value and a red
value, or a green band for a range, and those decide: inside green is healthy,
past red is unhealthy, and between them is watch. Uptime at 95% against a red
boundary of 99.5% is unhealthy, whatever 95 divided by 99.9 comes to.

**Ninety and seventy are the fallback.** A KPI with no thresholds is read as a
share of its target: ninety and above is healthy, below seventy is unhealthy.
That suits a positive number counted from zero, and nothing else. When a KPI
drops out of range the product drafts a recovery objective with at most four
key results, one per leading child driver, and the KPI is marked "recovering"
beside its real band while that objective moves. The band never changes to say
so: a metric still under its red line still reads unhealthy.

## Sessions

The quarterly review is eleven timed stages,
`sessions.quarterlyStageMinutes`, sixty minutes in total. The weekly session is
four steps and fifteen to thirty minutes. Both are in
[the weekly rhythm](weekly.md) and [the quarterly cycle](quarterly.md).

## Changing them

**Admin, then Rhythm and thresholds.** What an administrator may change is the
number, not the rule: the rules are the method, compiled from one
specification, and a coaching message can cite the rule behind it precisely
because nobody has rewritten it locally.
