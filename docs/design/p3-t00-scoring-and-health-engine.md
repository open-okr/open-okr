# P3-T00: the scoring and health engine

Part two of the Phase 3 design gate. Authority: METHOD.md §3 and
TECHNICAL-PLAN.md §6.2. Implemented at P3-T05, in `packages/core`, as pure
functions over a loaded graph.

Read [p3-t00-okr-core-domain.md](p3-t00-okr-core-domain.md) first for the
decision register. Decisions D-1, D-2, D-3, D-4, D-5 and D-13 land here.

## 1. Contract

```
recomputeGoal(graph, change, thresholds) -> { goals: GoalDerived[], keyResults: KeyResultDerived[], diagnostics: Diagnostic[] }
```

| Rule | Detail |
|---|---|
| Pure | No database, no clock, no network. The clock is an argument (`now`), the thresholds are an argument |
| Total | Every input produces an answer. Nothing throws on bad data. Impossible states become a diagnostic and a defined value |
| Rounding | Stored percentages carry 2 decimals, rounded half away from zero. Rounding happens once, at the boundary, never between cascade levels |
| Clamping | Progress is clamped to 0 to 100 after the direction formula, before weighting |

Three numbers stay separate everywhere and are never averaged together
(METHOD.md §3): progress is backward-looking 0 to 100%, confidence is
forward-looking 0.0 to 1.0, score is the final backward judgement 0.0 to 1.0.

## 2. Key result progress

METHOD.md §3.1. Direction-aware linear interpolation, clamped.

| Direction | Formula |
|---|---|
| `increase` | `(current − baseline) / (target − baseline)` |
| `move` | The same formula. It handles a downward move because both terms invert |
| `reduce` | `(baseline − current) / (baseline − target)` |
| `maintain` | 100 inside the band, otherwise `100 × (1 − distance / bandWidth)` (decision D-1) |

`maintain` reads its band from the two endpoints it already has:
`low = min(baseline, target)`, `high = max(baseline, target)`, both inclusive.
`bandWidth = high − low`. `distance` is 0 inside the band, otherwise the gap to
the nearest edge. A zero-width band scores 100 on an exact match and 0
otherwise, because there is no width to scale by.

Equal baseline and target score 0 for every direction except `maintain`, where
they describe a band of one point.

A key result with `kpi_id` set ignores all four formulas and takes the KPI's
real `achievement_pct`, clamped to 0 to 100 (decision D-4). A KPI at 130% of
target gives the key result 100%.

<!-- golden: scoring.kr-progress -->

| case | direction | baseline | target | current | expected_pct |
|---|---|---|---|---|---|
| increase at baseline | increase | 0 | 100 | 0 | 0 |
| increase halfway | increase | 0 | 100 | 50 | 50 |
| increase at target | increase | 0 | 100 | 100 | 100 |
| increase past target clamps | increase | 0 | 100 | 150 | 100 |
| increase below baseline clamps | increase | 0 | 100 | -20 | 0 |
| increase with awkward arithmetic | increase | 41 | 60 | 50 | 47.37 |
| increase equal endpoints | increase | 40 | 40 | 40 | 0 |
| increase equal endpoints, value above | increase | 40 | 40 | 90 | 0 |
| increase declared but target is lower | increase | 100 | 50 | 75 | 50 |
| reduce at baseline | reduce | 9 | 2 | 9 | 0 |
| reduce at target | reduce | 9 | 2 | 2 | 100 |
| reduce halfway | reduce | 9 | 2 | 5.5 | 50 |
| reduce past target clamps | reduce | 9 | 2 | 1 | 100 |
| reduce moving the wrong way clamps | reduce | 9 | 2 | 12 | 0 |
| reduce equal endpoints | reduce | 5 | 5 | 5 | 0 |
| reduce across negative values | reduce | 0 | -10 | -5 | 50 |
| maintain inside band | maintain | 95 | 99 | 97 | 100 |
| maintain on the lower edge | maintain | 95 | 99 | 95 | 100 |
| maintain on the upper edge | maintain | 95 | 99 | 99 | 100 |
| maintain one below the band | maintain | 95 | 99 | 94 | 75 |
| maintain a full band width below | maintain | 95 | 99 | 91 | 0 |
| maintain further than the band width | maintain | 95 | 99 | 90 | 0 |
| maintain one above the band | maintain | 95 | 99 | 100 | 75 |
| maintain with endpoints given high to low | maintain | 99 | 95 | 97 | 100 |
| maintain zero-width band, exact | maintain | 50 | 50 | 50 | 100 |
| maintain zero-width band, off by one | maintain | 50 | 50 | 51 | 0 |
| move upward halfway | move | 3 | 7 | 5 | 50 |
| move downward halfway | move | 9 | 5 | 7 | 50 |
| move downward at target | move | 9 | 5 | 5 | 100 |
| move downward past baseline clamps | move | 9 | 5 | 10 | 0 |

<!-- golden: scoring.kr-progress-kpi -->

| case | achievement_pct | expected_pct |
|---|---|---|
| kpi-backed below target | 82 | 82 |
| kpi-backed at target | 100 | 100 |
| kpi-backed over target clamps | 130 | 100 |
| kpi-backed at zero | 0 | 0 |
| kpi-backed with no achievement yet | | 0 |

## 3. Goal progress and the upward cascade

METHOD.md §3.1: the weighted average of the key results' progress, including
the weighted contribution of goals aligned beneath it.

| Rule | Detail |
|---|---|
| Items | Every key result of the goal, plus every goal whose parent pointer targets this goal **or any of its key results** |
| Weights | `weight` clamped to 0 to 100 on write. Weight 0 excludes an item from the average while keeping it visible |
| No items, or total weight 0 | Progress 0 (decision D-3) |
| A child aligned to a key result | Contributes to this **goal**, and leaves that key result's own measured progress alone (decision D-2) |
| Cycle | Broken before any arithmetic runs, deterministically, and reported |
| Depth | No limit in the arithmetic. The loader bounds the graph it hands over |

Cycle breaking cannot depend on where the traversal started, or the same graph
would produce different numbers on different requests. So it happens first, as
its own pass: find every cycle in the parent graph, and in each one drop the
parent pointer belonging to the node whose identifier sorts highest. That node
becomes a root. One `cycle:<child>-><parent>` diagnostic per dropped edge. The
write path at P3-T04 refuses to create a cycle in the first place, so this pass
exists for data that arrived through an import.

The tree notation in the matrix below is JSON. `krs` is a list of
`[weight, progress]`. `children` is a list of subtrees, each carrying its own
`w`. Omitted keys are empty.

<!-- golden: scoring.goal-progress -->

| case | tree | expected_pct |
|---|---|---|
| the plan's own example, weighted two and one | {"krs":[[2,100],[1,40]]} | 80 |
| one key result at zero | {"krs":[[1,0]]} | 0 |
| no key results and no children | {} | 0 |
| every weight zero | {"krs":[[0,100],[0,40]]} | 0 |
| a zero-weight item is excluded | {"krs":[[1,100],[0,0]]} | 100 |
| one key result and one equal-weight child | {"krs":[[1,50]],"children":[{"w":1,"krs":[[1,100]]}]} | 75 |
| a child weighted three times the key result | {"krs":[[1,50]],"children":[{"w":3,"krs":[[1,100]]}]} | 87.5 |
| two levels of children | {"krs":[[1,60]],"children":[{"w":1,"krs":[[1,100]],"children":[{"w":1,"krs":[[1,0]]}]}]} | 55 |
| a goal with no key results but an aligned child | {"children":[{"w":1,"krs":[[1,80]]}]} | 80 |
| fractional weights | {"krs":[[0.5,100],[1.5,50]]} | 62.5 |
| a weight above the clamp is clamped to 100 | {"krs":[[150,100],[1,0]]} | 99.01 |
| three key results, unequal | {"krs":[[1,100],[2,50],[1,0]]} | 50 |

The cascade matrix uses an explicit node list so a cycle and a
parent-key-result edge can be expressed. `parent` is a node id or a
`kr:<id>` reference. `krs` is `[weight, progress]` pairs.

<!-- golden: scoring.cascade -->

| case | nodes | expected | diagnostics |
|---|---|---|---|
| a three-level chain rolls upward | [{"id":"A","w":1,"krs":[[1,0]]},{"id":"B","parent":"A","w":1,"krs":[[1,50]]},{"id":"C","parent":"B","w":1,"krs":[[1,100]]}] | {"A":37.5,"B":75,"C":100} | |
| a child aligned to a key result leaves that key result alone | [{"id":"A","w":1,"krs":[[1,40]],"krIds":["k1"]},{"id":"B","parent":"kr:k1","w":1,"krs":[[1,100]]}] | {"A":70,"B":100,"k1":40} | |
| a two-goal cycle is broken and reported | [{"id":"A","parent":"B","w":1,"krs":[[1,100]]},{"id":"B","parent":"A","w":1,"krs":[[1,0]]}] | {"A":100,"B":50} | cycle:B->A |
| a self-parent is broken and reported | [{"id":"A","parent":"A","w":1,"krs":[[1,60]]}] | {"A":60} | cycle:A->A |

The second row is decision D-2 in numbers. Key result `k1` stays at its
measured 40 even though the goal aligned beneath it is complete, and goal A
reads 70 because the child contributes at the goal level.

**Budget** (decision D-13). §13.1 has no row for the scoring cascade. Derived
from its neighbour, "alignment score recomputation, 10,000 goals, under 2 s in
a job": the pure cascade over a 1,000-goal chain completes in under 200 ms with
no I/O, asserted in the suite. This is a derived number, not a canon one, and it
belongs in the design document rather than in the §11 registry, which holds
practice thresholds and not performance budgets.

## 4. Health

METHOD.md §3.5. Precedence, first match wins. Never a formula over progress.

| Order | Condition | Health |
|---|---|---|
| 1 | `closed_at` is set | `achieved` or `missed`, from `success_status` |
| 2 | Now is later than `next_check_in_at` plus the staleness grace | `outdated` |
| 3 | A published check-in exists | Its `status`: `on_track`, `caution`, `off_track` |
| 4 | Otherwise | `pending` |

Two consequences worth stating because they are easy to get wrong. A goal that
has never been checked in and is already past its grace window reads
`outdated`, not `pending`: rule 2 sits above rule 4. And a goal whose last
check-in said `on_track` reads `outdated` once the grace passes: rule 2 sits
above rule 3. That second one is the plan's own acceptance criterion.

The grace boundary is exclusive. At exactly the grace limit the goal is not yet
outdated.

<!-- golden: scoring.health -->

| case | closed | success_status | latest_status | days_past_due | grace_days | expected |
|---|---|---|---|---|---|---|
| never checked in, not yet due | no | | | -2 | 3 | pending |
| never checked in, due today | no | | | 0 | 3 | pending |
| never checked in, past the grace | no | | | 4 | 3 | outdated |
| on track and on time | no | | on_track | 0 | 3 | on_track |
| on track, one day overdue inside the grace | no | | on_track | 1 | 3 | on_track |
| on track, exactly at the grace limit | no | | on_track | 3 | 3 | on_track |
| on track, one day past the grace | no | | on_track | 4 | 3 | outdated |
| off track and stale reads stale | no | | off_track | 10 | 3 | outdated |
| caution and on time | no | | caution | 0 | 3 | caution |
| a workspace grace of five keeps it on track | no | | on_track | 4 | 5 | on_track |
| closed achieved outranks staleness | yes | achieved | on_track | 30 | 3 | achieved |
| closed missed outranks the last status | yes | missed | on_track | 0 | 3 | missed |
| closed achieved with no check-in at all | yes | achieved | | 0 | 3 | achieved |

## 5. The progress signal

METHOD.md §3.7. A red, amber or green signal from progress alone, shown beside
health and never instead of it.

| Condition | Signal |
|---|---|
| `progress >= pass` | green |
| `progress < fail` | red |
| Otherwise | amber |

Defaults 75 and 50, both §11 parameters. Note the asymmetry, which is what the
canon says: green includes its boundary, red excludes its own.

<!-- golden: scoring.rag -->

| case | progress_pct | pass_pct | fail_pct | expected |
|---|---|---|---|---|
| complete | 100 | 75 | 50 | green |
| exactly at pass | 75 | 75 | 50 | green |
| just under pass | 74.99 | 75 | 50 | amber |
| exactly at fail | 50 | 75 | 50 | amber |
| just under fail | 49.99 | 75 | 50 | red |
| nothing yet | 0 | 75 | 50 | red |
| a stricter workspace | 75 | 80 | 60 | amber |
| a looser workspace | 55 | 60 | 40 | amber |

A green signal on an outdated goal still renders `outdated`. The signal is a
second column, not an override.

## 6. The trend forecast

METHOD.md §3.6, and decision D-5 for the window the canon does not define.

| Rule | Detail |
|---|---|
| Window | Every `key_result_values` point inside the goal's cycle. For a contextual goal, every point since the goal was created |
| Horizon | The cycle's `ends_on`. For a contextual goal, the key result's `due_on` |
| Fit | Ordinary least squares over (timestamp, value). At least two points at distinct timestamps, otherwise no forecast |
| Projection | Not clamped. A linear fit can project past the possible, and the comparison is what matters |
| Trending flag | `increase` and `move`: true when the projection is below the target. `reduce`: true when the projection is above it. `maintain`: true when the projection falls outside the band |
| Output | `{ projected, trendingOffTrack }` in the key result's `forecast` column, or null |

Day offsets in the matrix are days from the first point. The horizon is a day
offset too. Projections carry 2 decimals.

<!-- golden: scoring.forecast -->

| case | points | horizon_day | direction | baseline | target | expected_projected | expected_trending |
|---|---|---|---|---|---|---|---|
| a clean line that lands | [[0,0],[7,10],[14,20]] | 84 | increase | 0 | 100 | 120 | no |
| a decaying line that will miss | [[0,0],[7,10],[14,12]] | 84 | increase | 0 | 100 | 73.33 | yes |
| flat and short of target | [[0,40],[7,40],[14,40]] | 84 | increase | 40 | 60 | 40 | yes |
| flat and already past target | [[0,70],[7,70],[14,70]] | 84 | increase | 40 | 60 | 70 | no |
| a reduction on track | [[0,9],[7,7],[14,6]] | 84 | reduce | 9 | 2 | -9.17 | no |
| a reduction barely moving | [[0,9],[7,8.8],[14,8.7]] | 84 | reduce | 9 | 2 | 7.18 | yes |
| two points only | [[0,10],[7,20]] | 84 | increase | 10 | 100 | 130 | no |
| one point, no forecast | [[0,10]] | 84 | increase | 10 | 100 | | |
| two points at the same moment, no forecast | [[0,10],[0,20]] | 84 | increase | 10 | 100 | | |
| no points at all | [] | 84 | increase | 10 | 100 | | |
| maintain drifting out of the band | [[0,97],[7,96],[14,95]] | 84 | maintain | 95 | 99 | 85 | yes |
| maintain holding inside the band | [[0,97],[7,97],[14,97]] | 84 | maintain | 95 | 99 | 97 | no |

The second row is the criterion in P3-T05's test plan: the key result is at 12
of a 100 target with a positive slope, so nothing about its current status looks
wrong, and the forecast already says it will land at 73.

## 7. Score bands and annotations

METHOD.md §3.3. Scored at the close against the key result as written.

The score defaults to `progress / 100` when Phase 7 opens, and is editable by
the facilitator through the scoring surface until the cycle closes. It is never
recomputed after an edit, because a score is a judgement and progress is a
measurement.

Annotation rows are evaluated in the canon's order, first match wins, which
leaves 0.3 to below 0.6 deliberately unannotated.

<!-- golden: scoring.score-bands -->

| case | score | expected_band | expected_annotation |
|---|---|---|---|
| perfect | 1 | fully_achieved | too_safe |
| nearly perfect | 0.95 | fully_achieved | intended |
| exactly at the achieved boundary | 0.9 | fully_achieved | intended |
| just below achieved | 0.89 | strong | intended |
| exactly at the strong boundary | 0.7 | strong | intended |
| just below strong | 0.69 | partial | intended |
| exactly at the annotation boundary | 0.6 | partial | intended |
| just below the annotation boundary | 0.59 | partial | none |
| exactly at the partial boundary | 0.4 | partial | none |
| just below partial | 0.39 | little | none |
| exactly at the disconnected boundary | 0.3 | little | none |
| just below disconnected | 0.29 | little | disconnected |
| nothing achieved | 0 | little | disconnected |

## 8. The portfolio verdict

METHOD.md §3.4, the average across any scored set. Boundaries are inclusive at
the bottom of each band except the top one, which the canon words as "above".

<!-- golden: scoring.portfolio -->

| case | average | expected |
|---|---|---|
| well above the ceiling | 0.95 | too_safe |
| just above the ceiling | 0.851 | too_safe |
| exactly at the ceiling | 0.85 | healthy |
| mid healthy | 0.72 | healthy |
| exactly at the healthy floor | 0.6 | healthy |
| just below the healthy floor | 0.599 | partial |
| exactly at the partial floor | 0.4 | partial |
| just below the partial floor | 0.399 | outran_capacity |
| nothing landed | 0 | outran_capacity |

An empty set has no verdict. The function returns null rather than dividing by
zero, and the scorecard renders "nothing scored yet".

## 9. Confidence bands

METHOD.md §3.2. Per key result, live.

<!-- golden: scoring.confidence-bands -->

| case | confidence | expected_band | escalates_same_day |
|---|---|---|---|
| certain | 1 | high | no |
| exactly at the high boundary | 0.7 | high | no |
| just below high | 0.699 | medium | no |
| exactly at the medium floor | 0.4 | medium | no |
| just below medium | 0.399 | low | no |
| exactly at the critical boundary | 0.3 | low | yes |
| well below critical | 0.1 | low | yes |
| no confidence at all | 0 | low | yes |

The same-day escalation column is the one extra rule inside the low band: at
0.3 and below the coordinator raises it with management the same day. The nudge
engine at P4-T05 consumes this flag; P3-T05 only computes it.

## 10. The draft set verdict

METHOD.md §3.2, second table. Judged on the **set** average at drafting time,
never on one key result.

<!-- golden: scoring.draft-confidence -->

| case | average | expected |
|---|---|---|
| near certain | 0.95 | sandbagging |
| just above the sandbagging line | 0.9001 | sandbagging |
| exactly at the sandbagging line | 0.9 | comfortable |
| comfortable | 0.8 | comfortable |
| just above the comfortable floor | 0.7501 | comfortable |
| exactly at the comfortable floor | 0.75 | sweet_spot |
| the middle of the sweet spot | 0.6 | sweet_spot |
| exactly at the sweet spot floor | 0.4 | sweet_spot |
| just below the sweet spot | 0.399 | ambitious |
| exactly at the ambitious floor | 0.25 | ambitious |
| just below ambitious | 0.2499 | moonshot |
| pure fantasy | 0 | moonshot |

## 11. Acceptance criteria

**Given** two key results weighted two and one, at 100% and 40%, **when** the
goal is recomputed, **then** its progress reads 80%.

**Given** a goal whose latest published check-in said `on_track` and whose due
date passed four days ago with a three-day grace, **when** any surface renders
it, **then** its health reads `outdated`.

**Given** a key result at 12 against a target of 100 with three rising points,
**when** the forecast runs, **then** it projects 73.33 and flags the key result
as trending off track, before any human changes its status.

**Given** a reduce-direction key result from 9 to 2, **when** its value is 2,
**then** progress reads 100%, and **when** its value is 12, **then** progress
reads 0%.

**Given** a 1,000-goal chain, **when** the cascade recomputes, **then** it
finishes in under 200 ms with no database access.

**Given** two goals aligned to each other, **when** the cascade runs, **then**
it returns a progress figure for both and a `cycle` diagnostic naming them,
rather than recursing.
