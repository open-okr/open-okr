# KPI engine

Part four of the Phase 3 design gate. Authority: METHOD.md §6,
TECHNICAL-PLAN.md §4.6 and §6.4. Implemented across P3-T12 (periods, corridors,
the grid), P3-T13 (formulas and the cascade) and P3-T14 (trees, recovery
drafting, the key result link).

Decisions D-4, D-8, D-9, D-10, D-12 from
[the domain document](okr-core-domain.md) land here, plus D-15 below.

## 1. Period normalisation

A value lands in exactly one bucket. Buckets are calendar periods in the
workspace timezone, not rolling windows.

| Frequency | `period_start` |
|---|---|
| `daily` | The date |
| `weekly` | The Monday of the ISO week (decision D-12) |
| `monthly` | The first of the month |
| `quarterly` | The first of the calendar quarter |
| `yearly` | 1 January |

Uniqueness is a database constraint, not a convention: unique on
`(workspace_id, kpi_id, period_start)`. Recording a second value for a period
updates the row rather than adding one, which is what makes the grid safe under
two people typing at once.

<!-- golden: kpi.period -->

| case | frequency | date | expected_period_start |
|---|---|---|---|
| a day is its own period | daily | 2026-08-11 | 2026-08-11 |
| midweek rolls back to Monday | weekly | 2026-08-11 | 2026-08-10 |
| Monday is its own week start | weekly | 2026-08-10 | 2026-08-10 |
| Sunday belongs to the week that began | weekly | 2026-08-16 | 2026-08-10 |
| a week spanning a year boundary keeps its Monday | weekly | 2027-01-01 | 2026-12-28 |
| midmonth | monthly | 2026-08-11 | 2026-08-01 |
| the last day of a month | monthly | 2026-08-31 | 2026-08-01 |
| the first of a month | monthly | 2026-08-01 | 2026-08-01 |
| the third quarter | quarterly | 2026-08-11 | 2026-07-01 |
| the first day of the year | quarterly | 2026-01-01 | 2026-01-01 |
| the last day of the year | quarterly | 2026-12-31 | 2026-10-01 |
| a year | yearly | 2026-08-11 | 2026-01-01 |

## 2. Achievement

METHOD.md §6.4: "the direction-aware ratio of current to target". A ratio has
three ways to go wrong, so the rule is written as ordered cases rather than one
expression.

| Order | Case | Achievement |
|---|---|---|
| 1 | Actual or target missing | null |
| 2 | Target below zero | null, with a `negative_target` diagnostic (decision D-15) |
| 3 | Actual equals target | 100 |
| 4 | `higher_better` with a zero target | 200 when the actual is above zero, otherwise 0 |
| 5 | `higher_better` | `actual / target × 100` |
| 6 | `lower_better` with an actual of zero or below | 200 |
| 7 | `lower_better` | `target / actual × 100` |
| 8 | Every case above | Clamped to 0 to 200, two decimals |

**Decision D-10, revised.** The floor is 0 and the **ceiling is 200**, not
uncapped as first drafted. A ceiling is unavoidable, because `lower_better` with
an actual of zero divides by zero and the function has to stay total. Making the
ceiling apply to both directions keeps the two symmetrical. Nothing behaves
differently at the corridor boundaries, which only ever test from below.

**Decision D-15 (practice).** A **negative target** yields no achievement and a
diagnostic, rather than a ratio. For `higher_better` with a target of -3 and an
actual of -1, the ratio reads 33% while the KPI has actually beaten its target.
There is no correct ratio over a negative target. The KPI reads `no_data` and
the owner is told to model it as `lower_better` on the loss instead. A negative
**actual** against a positive target is fine and clamps to 0, which is the right
answer: an operating margin of -3% against a target of 12% is nowhere near it.

<!-- golden: kpi.achievement -->

| case | direction | actual | target | expected_pct | diagnostic |
|---|---|---|---|---|---|
| four fifths of the way | higher_better | 80 | 100 | 80 | |
| exactly on target | higher_better | 100 | 100 | 100 | |
| over target | higher_better | 130 | 100 | 130 | |
| far over target hits the ceiling | higher_better | 250 | 100 | 200 | |
| nothing achieved | higher_better | 0 | 100 | 0 | |
| a negative actual against a positive target | higher_better | -10 | 100 | 0 | |
| a zero target, beaten | higher_better | 5 | 0 | 200 | |
| a zero target, met exactly | higher_better | 0 | 0 | 100 | |
| a zero target, missed | higher_better | -5 | 0 | 0 | |
| a negative target has no ratio | higher_better | -1 | -3 | | negative_target |
| lower is better, beating the target | lower_better | 80 | 100 | 125 | |
| lower is better, exactly on target | lower_better | 100 | 100 | 100 | |
| lower is better, double the target | lower_better | 200 | 100 | 50 | |
| lower is better, ten times the target | lower_better | 1000 | 100 | 10 | |
| lower is better, down to zero | lower_better | 0 | 100 | 200 | |
| lower is better, below zero | lower_better | -5 | 100 | 200 | |
| lower is better with a zero target, missed | lower_better | 5 | 0 | 0 | |
| no actual recorded | higher_better | | 100 | | |
| no target set | higher_better | 80 | | | |

## 3. The corridor state

**Since P9-T17a this is the fallback.** METHOD v2 §6.2 gives a KPI a target
type (at or above, at or below, increase to, decrease to, a range) and green and
red thresholds in its own units, and `kpiReading` judges by those first:

| Type | Healthy | Unhealthy | Watch |
|---|---|---|---|
| At or above, increase to | At or above the green value | Below the red value | Between |
| At or below, decrease to | At or below the green value | Above the red value | Between |
| Range | Inside the green band, ends included | Past a red boundary on either side | Outside the band, short of a red boundary |

Green is inclusive and red is strict, as the method writes them. A KPI with no
thresholds, or half a pair, falls back to the table below, and every read says
which basis it used. A range has no ratio, because it has no single target to
divide by. The grid colours each period by its own band from the server rather
than working the ratio out in the browser. `kpiStateOf(band, recovery)` keeps
the precedence below until P9-T17b moves the recovery beside the band.

The fallback, as built at P3-T12. METHOD.md §6.4. Precedence, first match wins:
no data, then the band. Both thresholds are §11 parameters, defaults 90 and 70.

| Order | Condition | State |
|---|---|---|
| 1 | Achievement is null | `no_data` |
| 2 | Achievement at or above the healthy threshold | `healthy` |
| 3 | Achievement at or above the watch threshold | `watch` |
| 4 | Otherwise | `unhealthy` |

**Whose thresholds (UAT BUG-011).** A KPI reads the workspace's
`kpi.healthyThreshold` and `kpi.watchThreshold` as they are now, unless it
holds a line of its own. `healthy_pct` and `watch_pct` are null for a KPI that
follows, and each falls back on its own through `corridorOf`.

| Event | What happens |
|---|---|
| `kpis.create` without a corridor | Both lines stored null |
| `kpis.update` with a number | That line becomes the KPI's own |
| `kpis.update` with null | That line follows the workspace again |
| `rhythm.update` moves either key | Every KPI with a null line is recomputed in the same transaction |
| Data change 0026 | Clears each stored line equal to the workspace's current one or the canon's 90 and 70, and rereads the band of a ratio KPI against the corridor it now follows |

**Given** a KPI at 87% that follows a workspace at 90 and 70, **when** an
administrator moves the healthy threshold to 85, **then** the KPI reads
`healthy` straight away. **Given** a KPI with its own healthy line at 95,
**when** the workspace moves to 85, **then** it still reads by 95.

**Recovering is beside the state, not one of them (P9-T17b-a).** Until then an
open recovery goal outranked the band, so a collapsing KPI read "recovering"
for as long as its recovery ran, whatever the metric did. Now the state is
always the band, and a KPI whose recovery goal is open is marked recovering
beside it. A closed recovery no longer marks it. A row stored as `recovering`
before the change is read as the band its achievement gives, which is the rule
it was judged by, and data change 0021 rewrites those rows.

<!-- golden: kpi.state -->

| case | achievement_pct | recovery | healthy_pct | watch_pct | expected | expected_recovering |
|---|---|---|---|---|---|---|
| nothing recorded | | none | 90 | 70 | no_data | no |
| comfortably healthy | 95 | none | 90 | 70 | healthy | no |
| exactly at the healthy threshold | 90 | none | 90 | 70 | healthy | no |
| just below healthy | 89.99 | none | 90 | 70 | watch | no |
| exactly at the watch threshold | 70 | none | 90 | 70 | watch | no |
| just below watch | 69.99 | none | 90 | 70 | unhealthy | no |
| nothing achieved | 0 | none | 90 | 70 | unhealthy | no |
| far over target | 200 | none | 90 | 70 | healthy | no |
| an open recovery is shown beside the band, not in its place | 50 | open | 90 | 70 | unhealthy | yes |
| a recovering KPI that is healthy again says so | 95 | open | 90 | 70 | healthy | yes |
| no data with a recovery is still no data | | open | 90 | 70 | no_data | yes |
| a closed recovery no longer marks it | 50 | closed | 90 | 70 | unhealthy | no |
| a stricter workspace | 92 | none | 95 | 80 | watch | no |
| a looser workspace | 65 | none | 80 | 60 | watch | no |

## 4. Effective health while recovering

METHOD.md §6.5: the displayed health is the higher of real achievement and a
projection, so recovery is visible before the lagging number catches up.

```
projection = start + recoveryProgress × max(0, healthy − start)
effective  = max(achievement, projection)
```

`recoveryProgress` is the recovery goal's progress as a fraction from 0 to 1.
`start` is `recovery_started_pct`, the achievement stamped at launch.

The `max(0, …)` guard covers a degenerate input. A recovery launches only from
an unhealthy KPI, so `start` is always below the healthy threshold in practice.
A KPI manually linked to a recovery goal while already healthy would otherwise
produce a projection that falls as the recovery progresses. That case emits a
`recovery_start_above_healthy` diagnostic.

<!-- golden: kpi.effective -->

| case | achievement_pct | start_pct | recovery_progress | healthy_pct | expected_effective | diagnostic |
|---|---|---|---|---|---|---|
| recovery just launched | 50 | 45 | 0 | 90 | 50 | |
| recovery halfway, projection ahead of reality | 50 | 45 | 0.5 | 90 | 67.5 | |
| recovery complete, projection reaches healthy | 50 | 45 | 1 | 90 | 90 | |
| reality has overtaken the projection | 95 | 45 | 0.5 | 90 | 95 | |
| a small step forward | 45 | 45 | 0.2 | 90 | 54 | |
| reality still at the start | 45 | 45 | 0 | 90 | 45 | |
| a degenerate start above the threshold | 50 | 95 | 0.5 | 90 | 95 | recovery_start_above_healthy |

## 5. The formula grammar

A typed expression tree validated with Zod. No string parsing at evaluation
time, no dynamic evaluation, ever.

| Node | Shape |
|---|---|
| Literal | `{"n": 42}` |
| Reference | `{"k": "<kpi id>"}` |
| Binary | `{"op": "add" \| "sub" \| "mul" \| "div", "l": node, "r": node}` |
| Negation | `{"neg": node}` |

Parentheses do not exist as syntax, because a tree already carries precedence.
The formula builder in the interface writes the tree; the stored shape is the
only shape.

| Limit | Value | Why here and not in §11 |
|---|---|---|
| Maximum depth | 32 | An evaluation safety bound, not a practice threshold. §11 holds the numbers the practice fires on |
| Maximum nodes | 256 | Same |
| Maximum references | 32 distinct KPIs | Same |

Evaluation rules:

| Rule | Detail |
|---|---|
| Null propagates | Any null operand makes the whole expression null, with a `missing_source` diagnostic naming the reference |
| Division by zero | null, with a `divide_by_zero` diagnostic. Never 0, which would read as a real `unhealthy` (decision D-9) |
| A null result writes no actual value | The dependent KPI's record for that period holds no actual, so the KPI reads `no_data` rather than a fabricated number |

<!-- golden: kpi.formula -->

| case | formula | sources | expected | diagnostic |
|---|---|---|---|---|
| a literal | {"n":42} | {} | 42 | |
| a bare reference | {"k":"a"} | {"a":10} | 10 | |
| addition | {"op":"add","l":{"k":"a"},"r":{"k":"b"}} | {"a":10,"b":5} | 15 | |
| subtraction | {"op":"sub","l":{"k":"a"},"r":{"k":"b"}} | {"a":10,"b":5} | 5 | |
| multiplication | {"op":"mul","l":{"k":"a"},"r":{"k":"b"}} | {"a":10,"b":5} | 50 | |
| division | {"op":"div","l":{"k":"a"},"r":{"k":"b"}} | {"a":10,"b":5} | 2 | |
| a ratio as a percentage | {"op":"mul","l":{"op":"div","l":{"k":"a"},"r":{"k":"b"}},"r":{"n":100}} | {"a":25,"b":200} | 12.5 | |
| the tree carries precedence | {"op":"mul","l":{"op":"add","l":{"k":"a"},"r":{"k":"b"}},"r":{"n":2}} | {"a":1,"b":2} | 6 | |
| negation | {"neg":{"k":"a"}} | {"a":10} | -10 | |
| division by zero | {"op":"div","l":{"k":"a"},"r":{"k":"b"}} | {"a":10,"b":0} | | divide_by_zero |
| division by a zero literal | {"op":"div","l":{"k":"a"},"r":{"n":0}} | {"a":10} | | divide_by_zero |
| a missing source | {"op":"add","l":{"k":"a"},"r":{"k":"b"}} | {"a":10,"b":null} | | missing_source |
| a missing source inside a product | {"op":"mul","l":{"k":"a"},"r":{"k":"b"}} | {"a":null,"b":5} | | missing_source |
| zero times a missing source is still missing | {"op":"mul","l":{"n":0},"r":{"k":"b"}} | {"b":null} | | missing_source |

That last row is deliberate. Short-circuiting `0 × null` to 0 would be
arithmetically defensible and reporting-wise wrong: the number would look
measured when nothing was measured.

## 6. Cross-frequency aggregation

A reference resolves to one value for the target period.

| Source frequency versus target | Rule |
|---|---|
| Finer | Aggregate every source record whose `period_start` falls inside the target period, using the **source's own** `aggregate` function |
| Equal | The source's record at the same `period_start` |
| Coarser | The source's record whose period contains the target period, used as-is |

An empty span yields null, except `count`, which yields 0 (decision D-9). Zero
records is a real count. Zero as a sum of nothing is a fabrication.

<!-- golden: kpi.aggregate -->

| case | source_frequency | target_frequency | aggregate | records | target_period | expected |
|---|---|---|---|---|---|---|
| daily into monthly, summed | daily | monthly | sum | [["2026-08-01",10],["2026-08-02",20],["2026-08-03",30]] | 2026-08-01 | 60 |
| daily into monthly, averaged | daily | monthly | avg | [["2026-08-01",10],["2026-08-02",20],["2026-08-03",30]] | 2026-08-01 | 20 |
| daily into monthly, maximum | daily | monthly | max | [["2026-08-01",10],["2026-08-02",20],["2026-08-03",30]] | 2026-08-01 | 30 |
| daily into monthly, minimum | daily | monthly | min | [["2026-08-01",10],["2026-08-02",20],["2026-08-03",30]] | 2026-08-01 | 10 |
| daily into monthly, counted | daily | monthly | count | [["2026-08-01",10],["2026-08-02",20],["2026-08-03",30]] | 2026-08-01 | 3 |
| records outside the period are excluded | daily | monthly | sum | [["2026-07-31",99],["2026-08-01",10],["2026-09-01",99]] | 2026-08-01 | 10 |
| weekly into monthly by week start | weekly | monthly | sum | [["2026-08-03",10],["2026-08-10",10],["2026-08-17",10],["2026-08-24",10],["2026-08-31",10]] | 2026-08-01 | 50 |
| same frequency reads the record | monthly | monthly | sum | [["2026-08-01",12]] | 2026-08-01 | 12 |
| a coarser source broadcasts down | quarterly | monthly | sum | [["2026-07-01",90]] | 2026-08-01 | 90 |
| a much coarser source broadcasts down | yearly | quarterly | sum | [["2026-01-01",400]] | 2026-07-01 | 400 |
| monthly broadcasts into a day | monthly | daily | sum | [["2026-08-01",31]] | 2026-08-11 | 31 |
| an empty span sums to nothing, not zero | daily | monthly | sum | [] | 2026-08-01 | |
| an empty span counts zero | daily | monthly | count | [] | 2026-08-01 | 0 |
| a coarser source with no covering record | quarterly | monthly | sum | [["2026-04-01",90]] | 2026-08-01 | |

## 7. The dependency cascade

`kpi_dependencies` holds one row per formula edge. Changing a source recomputes
every dependent, then their dependents, in topological order, each exactly once.

| Rule | Detail |
|---|---|
| Self-reference | Refused on write |
| Cycles | Refused on write. The check walks the existing graph before inserting the new edge |
| Order | Topological. A diamond recomputes the shared dependent once, after both branches |
| Driven from the outbox | The write commits the edge and an outbox row. The relay runs the cascade |
| Idempotent | Replaying the cascade produces the same values |

In the matrix, `dependencies` lists `[dependent, dependsOn]` pairs.

<!-- golden: kpi.cascade -->

| case | dependencies | changed | expected_order | expected_rejected |
|---|---|---|---|---|
| one dependent | [["b","a"]] | a | b | no |
| a chain | [["b","a"],["c","b"]] | a | b,c | no |
| changing the middle of a chain | [["b","a"],["c","b"]] | b | c | no |
| a diamond recomputes the join once | [["b","a"],["c","a"],["d","b"],["d","c"]] | a | b,c,d | no |
| a leaf change touches nothing | [["b","a"]] | b | | no |
| a self-reference is refused | [["a","a"]] | | | yes |
| a two-node cycle is refused | [["b","a"],["a","b"]] | | | yes |
| a three-node cycle is refused | [["b","a"],["c","b"],["a","c"]] | | | yes |

## 8. The recovery drafter

METHOD.md §6.5, as METHOD v2 writes it (rewritten at P9-T18a). Given an
unhealthy KPI, produce a committed recovery goal whose first key result is the
KPI itself, then up to three drivers.

| Rule | Detail |
|---|---|
| Kind | `committed`: a recovery restores a level the business relies on |
| Objective title | `<KPI title> back where the business can rely on it`. No number, so OBJ-2 has nothing to find; the old `Bring <KPI title> back to <target>` failed it |
| Description | Names the KPI, its reading and its healthy level, and leaves the why to its owner |
| First key result | `<KPI title> from <reading> to <healthy boundary>`, owned by the KPI's owner, reading the KPI (`kpi_id` set), with the KPI's own indicator type. This replaced the placeholder `define the first leading driver to move`, which failed KR-2 |
| Healthy boundary | The green value where the KPI has thresholds, the nearer end of a range's band, and on the fallback the value whose ratio to target is the healthy threshold; the KPI's own target when nothing says |
| The walk | Breadth-first through the KPI's subtree, ordered by `position` then identifier |
| A leading child | A candidate directly |
| A lagging child | Descended through, until its nearest leading descendants are reached |
| Which candidates | Only a driver below its own target with an owner. One at or past its target is skipped, because it would ask a number to go the wrong way: "Improve Sales calls per week from 120 to 100" marked increase |
| Cap | The §11 `recovery_key_result_cap`, four, the KPI included: the KPI and three drivers |
| Driver key result | `Improve <driver title> from <current> to <target>`, `increase` or `reduce` by the driver's direction, owned by the driver's named owner or the member whose list it is on, indicator type `leading` |
| At launch | `recovery_started_pct` stores the KPI's achievement and `recovery_goal_id` links back. The state stays the band (P9-T17b-a). One Operation, one transaction |

**A question this leaves for a human.** A KPI-backed key result's progress is
the KPI's achievement against the KPI's own target (decision D-4), so the
first key result, written "from its reading to its healthy boundary", reads
about 90% when the KPI reaches its boundary on the ratio fallback, rather than
100%. Whether a KPI-backed key result should instead progress from its own
baseline to its own target is a change to D-4 for every such key result, and is
recorded in adaptable-practice.md's open questions rather than made
here.

<!-- golden: kpi.recovery-draft -->

| case | tree | expected |
|---|---|---|
| the KPI first, then its drivers below target with owners | {"root":{"id":"r","title":"Operating margin","target":15,"current":7.6,"direction":"higher_better","healthyBoundary":13.5,"owner":"m0"},"nodes":[{"id":"c1","parent":"r","type":"leading","title":"Onboarding time","direction":"lower_better","current":9,"target":4,"position":1,"owner":"m1"},{"id":"c2","parent":"r","type":"leading","title":"Activation rate","direction":"higher_better","current":41,"target":60,"position":2,"owner":"m2"},{"id":"c3","parent":"r","type":"leading","title":"Support cost per ticket","direction":"lower_better","current":18,"target":11,"position":3,"owner":"m3"}]} | {"objective":"Operating margin back where the business can rely on it","keyResults":[{"title":"Operating margin from 7.6 to 13.5","direction":"increase","baseline":7.6,"target":13.5,"owner":"m0"},{"title":"Improve Onboarding time from 9 to 4","direction":"reduce","baseline":9,"target":4,"owner":"m1"},{"title":"Improve Activation rate from 41 to 60","direction":"increase","baseline":41,"target":60,"owner":"m2"},{"title":"Improve Support cost per ticket from 18 to 11","direction":"reduce","baseline":18,"target":11,"owner":"m3"}]} |
| a lagging child is descended through | {"root":{"id":"r","title":"Revenue","target":100,"current":60,"direction":"higher_better","healthyBoundary":90,"owner":"m0"},"nodes":[{"id":"c1","parent":"r","type":"lagging","title":"Pipeline","direction":"higher_better","current":30,"target":50,"position":1},{"id":"g1","parent":"c1","type":"leading","title":"Qualified leads","direction":"higher_better","current":80,"target":140,"position":1,"owner":"m1"}]} | {"objective":"Revenue back where the business can rely on it","keyResults":[{"title":"Revenue from 60 to 90","direction":"increase","baseline":60,"target":90,"owner":"m0"},{"title":"Improve Qualified leads from 80 to 140","direction":"increase","baseline":80,"target":140,"owner":"m1"}]} |
| a leading child comes before a lagging child's descendant | {"root":{"id":"r","title":"Revenue","target":100,"current":60,"direction":"higher_better","healthyBoundary":90,"owner":"m0"},"nodes":[{"id":"c1","parent":"r","type":"lagging","title":"Pipeline","direction":"higher_better","current":30,"target":50,"position":1},{"id":"c2","parent":"r","type":"leading","title":"Trial starts","direction":"higher_better","current":200,"target":400,"position":2,"owner":"m2"},{"id":"g1","parent":"c1","type":"leading","title":"Qualified leads","direction":"higher_better","current":80,"target":140,"position":1,"owner":"m1"}]} | {"objective":"Revenue back where the business can rely on it","keyResults":[{"title":"Revenue from 60 to 90","direction":"increase","baseline":60,"target":90,"owner":"m0"},{"title":"Improve Trial starts from 200 to 400","direction":"increase","baseline":200,"target":400,"owner":"m2"},{"title":"Improve Qualified leads from 80 to 140","direction":"increase","baseline":80,"target":140,"owner":"m1"}]} |
| the cap of four counts the KPI | {"root":{"id":"r","title":"Revenue","target":100,"current":60,"direction":"higher_better","healthyBoundary":90,"owner":"m0"},"nodes":[{"id":"c1","parent":"r","type":"leading","title":"D1","direction":"higher_better","current":1,"target":2,"position":1,"owner":"m1"},{"id":"c2","parent":"r","type":"leading","title":"D2","direction":"higher_better","current":2,"target":3,"position":2,"owner":"m1"},{"id":"c3","parent":"r","type":"leading","title":"D3","direction":"higher_better","current":3,"target":4,"position":3,"owner":"m1"},{"id":"c4","parent":"r","type":"leading","title":"D4","direction":"higher_better","current":4,"target":5,"position":4,"owner":"m1"},{"id":"c5","parent":"r","type":"leading","title":"D5","direction":"higher_better","current":5,"target":6,"position":5,"owner":"m1"}]} | {"objective":"Revenue back where the business can rely on it","keyResults":[{"title":"Revenue from 60 to 90","direction":"increase","baseline":60,"target":90,"owner":"m0"},{"title":"Improve D1 from 1 to 2","direction":"increase","baseline":1,"target":2,"owner":"m1"},{"title":"Improve D2 from 2 to 3","direction":"increase","baseline":2,"target":3,"owner":"m1"},{"title":"Improve D3 from 3 to 4","direction":"increase","baseline":3,"target":4,"owner":"m1"}]} |
| acceptance: a driver already at or past its target is skipped | {"root":{"id":"r","title":"Revenue","target":100,"current":60,"direction":"higher_better","healthyBoundary":90,"owner":"m0"},"nodes":[{"id":"c1","parent":"r","type":"leading","title":"Sales calls per week","direction":"higher_better","current":120,"target":100,"position":1,"owner":"m1"},{"id":"c2","parent":"r","type":"leading","title":"Churned accounts","direction":"lower_better","current":3,"target":5,"position":2,"owner":"m2"},{"id":"c3","parent":"r","type":"leading","title":"Demos booked","direction":"higher_better","current":50,"target":50,"position":3,"owner":"m3"},{"id":"c4","parent":"r","type":"leading","title":"Activation rate","direction":"higher_better","current":41,"target":60,"position":4,"owner":"m4"}]} | {"objective":"Revenue back where the business can rely on it","keyResults":[{"title":"Revenue from 60 to 90","direction":"increase","baseline":60,"target":90,"owner":"m0"},{"title":"Improve Activation rate from 41 to 60","direction":"increase","baseline":41,"target":60,"owner":"m4"}]} |
| a driver nobody owns is skipped | {"root":{"id":"r","title":"Revenue","target":100,"current":60,"direction":"higher_better","healthyBoundary":90,"owner":"m0"},"nodes":[{"id":"c1","parent":"r","type":"leading","title":"Trial starts","direction":"higher_better","current":200,"target":400,"position":1}]} | {"objective":"Revenue back where the business can rely on it","keyResults":[{"title":"Revenue from 60 to 90","direction":"increase","baseline":60,"target":90,"owner":"m0"}]} |
| a leaf KPI is its own key result | {"root":{"id":"r","title":"Revenue","target":100,"current":60,"direction":"higher_better","healthyBoundary":90,"owner":"m0"},"nodes":[]} | {"objective":"Revenue back where the business can rely on it","keyResults":[{"title":"Revenue from 60 to 90","direction":"increase","baseline":60,"target":90,"owner":"m0"}]} |
| a KPI that should fall reduces to its green boundary | {"root":{"id":"r","title":"Support tickets per account","target":2,"current":3.3,"direction":"lower_better","healthyBoundary":2.2,"owner":"m0"},"nodes":[]} | {"objective":"Support tickets per account back where the business can rely on it","keyResults":[{"title":"Support tickets per account from 3.3 to 2.2","direction":"reduce","baseline":3.3,"target":2.2,"owner":"m0"}]} |
| with nothing to say where healthy is, the KPI's own target stands in | {"root":{"id":"r","title":"Revenue","target":100,"current":60},"nodes":[]} | {"objective":"Revenue back where the business can rely on it","keyResults":[{"title":"Revenue from 60 to 100","direction":"increase","baseline":60,"target":100}]} |

## 9. The recovery proposal and its closure

Two separate things. The **draft** is available for one-click launch the moment
a KPI turns unhealthy. The **proactive proposal** from the Coach waits for two
consecutive unhealthy periods (§11 `recovery_proposal_delay`), so one bad month
never generates an unsolicited OKR.

Periods are read newest last. "Consecutive" means the two most recent periods,
with no other state between them.

<!-- golden: kpi.recovery-proposal -->

| case | period_states | expected_propose |
|---|---|---|
| one bad period is not enough | unhealthy | no |
| two consecutive bad periods | unhealthy,unhealthy | yes |
| a good period in between resets it | unhealthy,watch,unhealthy | no |
| a recovery after a good start | healthy,unhealthy,unhealthy | yes |
| three bad periods still propose once | unhealthy,unhealthy,unhealthy | yes |
| watching is not unhealthy | watch,watch | no |
| a gap in the data resets it | unhealthy,no_data,unhealthy | no |
| the most recent period is fine | unhealthy,unhealthy,healthy | no |
| a fall from healthy to unhealthy in one period proposes at once | healthy,unhealthy | yes |
| a fall through watch waits for the second period | healthy,watch,unhealthy | no |

**Two things decide whether the proposal is asked at all, before the run of
periods is read** (P9-T18b, METHOD.md §6.5 and §12):

| Given | Then |
|---|---|
| The KPI was answered another way, by a fix task not yet done or a key result on an objective still open | No proposal. Asking for a recovery on top of an answer is asking twice |
| That answer is closed (the task is done, or the objective closed) and the KPI is still unhealthy | The run of periods decides, as above |
| The practice's `kpi.unhealthyResponse` is `draftRecovery` | The delay is one period: the first unhealthy period proposes |
| Somebody answers the KPI another way while a proposal is pending | The proposal is settled as dismissed, decided by whoever answered, in the same transaction |

Closure runs the other way. When **real** achievement re-enters the healthy
corridor, the Coach proposes closing the recovery goal, exactly once. Real, not
effective: closing on the projection would close a recovery because the recovery
was progressing, which is circular.

<!-- golden: kpi.recovery-close -->

| case | achievement_pct | recovery | already_proposed | expected_propose_close |
|---|---|---|---|---|
| back inside the corridor | 92 | open | no | yes |
| already proposed, so not again | 92 | open | yes | no |
| still in the watch band | 85 | open | no | no |
| still unhealthy | 60 | open | no | no |
| exactly at the threshold | 90 | open | no | yes |
| no open recovery | 92 | closed | no | no |

## 10. The key result link

METHOD.md §6.1's first connection: a key result measured by a live KPI.

| Rule | Detail |
|---|---|
| Progress source | The KPI's **real** `achievement_pct`, clamped to 0 to 100 (decision D-4) |
| Never the effective value | A recovery key result reading its own KPI's effective health would feed its own progress back into itself |
| Manual entry | Refused while linked |
| Current value | The KPI's latest reading, the newest period with an actual value. Written as a `kpi` history row when it moves, so the sparkline records it |
| Cascade | A KPI record write recomputes the KPI and every calculated KPI downstream, then every linked key result, then their goals upward |
| Where the cascade runs | **In the writing Operation, not through the outbox** (completeness review M-07). No relay drains the outbox yet, which is the call P3-T05 made for the scoring cascade. `kpis.record`, `kpis.setFormula` and `kpis.update` all run it, because each can move an achievement |
| Closed goals | Left as they were closed. Their key results take no new values, and `goals.linkKpi` refuses one until it is reopened |
| Linking | On create (`goals.addKeyResult` with `kpiId`) or later (`goals.linkKpi`). Either way the key result starts at the KPI's latest reading. A key result that already reads a KPI is refused; unlinking first puts the change of source on the record |

## 11. Acceptance criteria

**Given** a monthly KPI with a target and default corridors, **when** a value at
80% of target is recorded, **then** the cell reads `watch`, and recording again
for the same month updates the row rather than adding one.

**Given** a monthly KPI defined as the sum of two others, **when** one source's
value changes, **then** the dependent recomputes for that period, anything
depending on it follows in topological order, and a self-referencing formula is
refused at write time.

**Given** an unhealthy KPI with three leading children, **when** the owner
launches recovery, **then** a goal exists with three key results carrying those
children's current values as baselines and their targets as targets, the KPI
reads `recovering`, and `recovery_started_pct` holds the achievement at launch.

**Given** a KPI whose children are all lagging, **when** recovery is drafted,
**then** the key results come from the nearest leading descendants. **Given** a
subtree with no leading KPI at all, **then** there is exactly one placeholder key
result.

**Given** a recovering KPI whose real achievement is 50, launched at 45, whose
recovery goal is halfway, **then** its effective health reads 67.5 and its real
achievement still reads 50 wherever both are shown.

**Given** a recovering KPI whose real achievement re-enters the healthy
corridor, **when** the coach evaluates it twice, **then** exactly one closure
proposal exists.
