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
| `cadence.blockerClockHours` | 24 | §3.2 |
| `cadence.nudgeDeduplicationHours` | 24 | §11 |
| `cadence.nudgeCeilingPerWeek` | 10 | §11 |
| `cadence.dueSoonLeadDays` | 1 | §11 |
| `cadence.reviewPreparationLeadWeeks` | 2 | §11 |

**Weekly, anchored to Monday, with a day of tolerance.** A week is short enough
to act on and long enough to have moved, and anchoring to Monday means the week
is planned rather than reported on afterwards.

**Three days of grace before a goal reads as outdated.** After that, staleness
overrides whatever health its owner last reported.

**A blocker has twenty-four hours.** The owner is warned before that and the
sponsor hears about it after.

**Ten nudges a week, deduplicated to one per subject per member per day.** A
product that speaks more than that is one people learn to ignore, which is the
same as a product that says nothing.

## Confidence and scoring

| Threshold | Default | Section |
|---|---|---|
| `scoring.confidenceHigh` | 0.7 | §3.2 |
| `scoring.confidenceLow` | 0.4 | §3.2 |
| `scoring.confidenceCritical` | 0.3 | §3.2 |
| `scoring.draftSandbagging` | 0.9 | §3.2 |
| `scoring.draftComfortable` | 0.75 | §3.2 |
| `scoring.draftAmbitious` | 0.25 | §3.2 |
| `scoring.closeSandbagging` | 0.85 | §8.3 |
| `scoring.rootCauseThreshold` | 0.7 | §8.4 |
| `scoring.progressSignalPass` | 75 | §3.7 |
| `scoring.progressSignalFail` | 50 | §3.7 |

**Confidence above 0.9 at drafting is sandbagging**, and the Coach says so. A
goal everybody is already confident about was not worth setting as an OKR.
Below 0.25 is ambitious, which is allowed and flagged so it is a choice rather
than an accident.

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
rather than a set of priorities, and the cap is the whole point.

**Two to five key results per objective**, which is `quality.keyResultsPerObjective`.
One is a measure pretending to be an objective; more than five is a plan.

**The input pack closes three working days before the planning session.**
Drafting is refused until it is complete, because a planning session with no
inputs produces objectives written from opinion.

## Alignment

| Threshold | Default | Section |
|---|---|---|
| `alignment.healthyThreshold` | 75 | §5.2 |

Alignment health is a score out of a hundred with named penalties: an
unanchored goal, an orphan, a goal with no key results, a level skipped, and a
silo. Seventy-five or better is healthy. The score always names its own gaps,
so it is actionable rather than a grade.

## KPIs

| Threshold | Default | Section |
|---|---|---|
| `kpi.healthyThreshold` | 90 | §6.4 |
| `kpi.watchThreshold` | 70 | §6.4 |
| `kpi.recoveryKeyResultCap` | 4 | §6.5 |

**Ninety and seventy are the corridor.** Above ninety is healthy, below seventy
is unhealthy, and between them is watch. When a KPI drops out of range the
product drafts a recovery objective with at most four key results, one per
leading child driver, and the KPI reads "recovering" while that objective moves.

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
