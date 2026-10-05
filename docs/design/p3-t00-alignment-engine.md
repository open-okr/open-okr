# P3-T00: the alignment engine

Part five of the Phase 3 design gate. Authority: METHOD.md §5,
TECHNICAL-PLAN.md §4.5 and §6.5.

**Implemented at P3-T09, and in two places rather than the one this document
first named.** The arithmetic is in `packages/method/src/alignment.ts`, not
`packages/core`: every function in it is a §5.2 rule taking a §11 threshold as an
argument, and the repository rule puts those in the method package and nowhere
else, so the same code runs in the browser as somebody drags a goal onto a new
parent. `packages/core/src/alignment/service.ts` is the half that needs rows: it
loads the graph and reconciles the findings table. The scoring engine moved for
the same reason at P3-T05.

**Decision D-16 is settled as recommended**: `alignment_findings.subject_goal_id`
is nullable, and TECHNICAL-PLAN.md §4.5 and DATABASE.md say so.

**§7's outbox is not how recomputation runs yet.** No relay host drains the
outbox, so a topic with no consumer would be a pending row nobody reads.
Recompute runs inside the writing transaction through one entry point, which is
the call P3-T05 made for the scoring cascade and the stronger guarantee besides:
there is no window where the studio shows a score the rows no longer support.
The trigger table below is still exactly what fires it, and a relay host will
call the same function.

Deterministic and fully available with the AI provider off. The Coach agent adds
semantic findings into the same table at P4-T03, which is why the table has a
`source` column from the start.

Decisions D-7 and D-11 from [the domain document](p3-t00-okr-core-domain.md)
land here, plus D-16 below.

**Rewritten at P9-T16a, 6 October 2026, for METHOD v2's §5.2.** The score was
100 less a fixed penalty per finding, with a floor of 5. It is now the share of
goals below company level that align to a parent or say why they stand alone,
read in three bands. Fixed penalties cost the same points in a company of ten
goals and one of five hundred, so eight unaligned goals took either to the
floor. The findings stay, because the coach lists every unaligned goal and the
nudges are keyed on them, but only the share decides the reading. Every table
below was rewritten with it; the rows that survived kept their graphs.

## 1. The score

METHOD.md §5.2. The share of goals below company level that align to a parent
or state why they stand alone, as a whole percentage rounded down. Rounded down
so a share of 89.6 reads 89 and the figure never shows a band it has not
reached.

| Counts | Detail |
|---|---|
| The denominator | Every goal in scope whose level is not `company` |
| Aligned | A parent goal or parent key result anywhere: this scope, another space, or an earlier or longer cycle such as an annual objective (§5.1). A pointer to a deleted parent is no parent |
| Standing alone | `goals.standalone_reason` holds something other than blanks |
| Not enough | A contribution statement. It says what the goal supports without pointing at it, and publish gate 3 is where a written contribution counts |

The findings the engine raises, and which of them the share reads:

<!-- golden: alignment.findings -->

| finding | rule_key | severity | fires | in_the_share |
|---|---|---|---|---|
| no company-level objective anchors the tree | AL-4 | high | once, at workspace scope | no: it makes the band a gap whatever the share |
| a goal below company level neither aligns nor says why it stands alone | AL-1 | high | per goal | yes |
| an objective has no key results | KR-1 | medium | per goal | no |
| a goal skips a level | AL-3 | low | per goal | no |
| a department and its whole subtree have no horizontal dependency | AL-6 | medium | per department | no |

Every rule key resolves to a check that already exists in METHOD.md §4, so no
message cites a rule the method package does not define. Severity is fixed per
rule. The values are the ones the old penalty sizes produced, so no finding
changed colour when the penalties left.

An empty scope has **no score**, and neither does a scope holding only company
objectives: there is nothing below company level to measure. The function
returns null for both, with no band.

## 2. What is in scope

| Rule | Detail |
|---|---|
| Scope | `workspace` or `space`, always for one cycle |
| Membership | Every non-deleted goal whose `cycle_id` is that cycle and whose owner falls inside the scope |
| Closed goals count | Decision D-11. Otherwise the score would climb as a cycle ends and goals close, which reads as alignment improving when nothing changed |
| The anchor rule applies at workspace scope only | "A company objective anchors the tree" is not a statement about one space. At space scope it is skipped, not failed |
| A parent outside the scope still aligns | Since P9-T16a. Before it, a space's goal hung under the company objective read as unaligned at space scope, which counted it against the share it most plainly belongs in |

## 3. Each finding, precisely

### 3.1 No anchor, once

At workspace scope, fires when no goal in scope has `level = 'company'` and no
goal in scope aligns to a company-level goal in another cycle. A company
objective with no key results still anchors: the test is existence at that
level. Its own missing key results are a separate finding. A quarter whose
goals hang under the annual company objectives is anchored by them, because
§5.1 lets a quarter's goals align to a longer cycle's.

Without an anchor the band is a gap whatever the share (§5.2). The share is
still reported, because "every team is aligned to something, and nothing is at
the top" is worth reading in full.

**Decision D-16 (mechanical).** This finding has no subject goal, because
nothing caused it. TECHNICAL-PLAN.md §4.5 lists `alignment_findings.subject_goal_id`
without a nullable marker. The recommendation is to make it nullable and record
that in DATABASE.md in the same change, rather than attaching the finding to an
arbitrary goal that is not responsible for it. If you would rather keep the
column not-null, the alternative is a separate scope-level findings table, which
is more schema for one row.

### 3.2 Unaligned, per goal

Fires when `level` is not `company`, neither parent pointer reaches a live goal
or key result, and there is no standalone reason. Each one is a goal the share
does not count.

The `contribution_statement` does **not** excuse it, for the reason §1 gives.
A standalone reason does, which is the change METHOD v2 made: a team that
inherits no objective is not unimportant, and Finance's month-end close
supports no strategy and is not a mistake.

### 3.3 No key results, per goal

Fires when a goal has zero non-deleted key results. Applies at every level,
including company.

### 3.4 Level skip, per goal

Levels are ordered `company` 0, `department` 1, `team` 2, `individual` 3. A skip
fires when `childIndex − parentIndex > 1`.

| Child | Parent | Difference | Skip |
|---|---|---|---|
| team | department | 1 | No |
| team | company | 2 | Yes |
| individual | team | 1 | No |
| individual | department | 2 | Yes |
| individual | company | 3 | Yes |
| team | team | 0 | No |
| department | team | -1 | No |

A same-level or inverted parent is not a §5.2 penalty. It may be worth
coaching, and that belongs to the quality canon rather than to the score.

When the parent pointer is a **key result**, the parent's level is the level of
the goal that owns that key result. A parent outside the scope is read by its
level too.

### 3.5 Silo, per department

A department is a distinct owning space among the department-level goals in
scope. A department-level goal with no space forms its own group keyed by its
own identifier.

For each department, build the subtree: its department-level goals plus every
descendant through parent pointers. The department is siloed when nothing in
that subtree participates in a horizontal dependency with anything outside it.

**Decision D-7.** Both kinds of link count:

| Link | Counts for |
|---|---|
| `goal_dependencies` with one end inside the subtree and one outside | The subtree |
| `key_result_dependencies` on a key result inside the subtree, whose `provider_space_id` is a different space | Both the depending subtree **and** the providing space |

The providing side counting is the part worth noticing. METHOD.md §5.1 calls a
horizontal dependency "two-way by meaning". A department that three other teams
depend on is the least siloed department in the organisation, and flagging it
because it happened to be the provider rather than the consumer would be
absurd.

## 4. The score matrix

The graph notation is JSON. A goal carries `id`, `level`, an optional `parent`
(a goal id, or `kr:<goalId>` for a key result parent), an optional `outside`
(the level of a parent outside the scope), an optional `standalone` reason, an
optional `space`, a `krs` count, and an optional `closed`. `goalDeps` lists
pairs. `krDeps` lists `{goal, providerSpace}`. Findings are listed as
`<ruleKey>:<subject>`, sorted, with an empty subject for the scope-level anchor
finding. An empty score and band mean null.

<!-- golden: alignment.score -->

| case | scope | graph | expected_score | expected_band | expected_findings |
|---|---|---|---|---|---|
| the plan's own example: one orphan, one silo | workspace | {"goals":[{"id":"c","level":"company","krs":2},{"id":"d1","level":"department","parent":"c","space":"s1","krs":2},{"id":"d2","level":"department","parent":"c","space":"s2","krs":2},{"id":"d3","level":"department","parent":"c","space":"s3","krs":2},{"id":"t","level":"team","space":"s1","krs":2}],"goalDeps":[["d1","d2"]]} | 75 | gap | AL-1:t,AL-6:d3 |
| a clean tree | workspace | {"goals":[{"id":"c","level":"company","krs":2},{"id":"d1","level":"department","parent":"c","space":"s1","krs":2},{"id":"d2","level":"department","parent":"c","space":"s2","krs":2}],"goalDeps":[["d1","d2"]]} | 100 | healthy |  |
| nothing to align | workspace | {"goals":[]} |  |  |  |
| no company objective at all | workspace | {"goals":[{"id":"d1","level":"department","space":"s1","krs":2}]} | 0 | gap | AL-1:d1,AL-4:,AL-6:d1 |
| an objective with no key results, and nothing below company level | workspace | {"goals":[{"id":"c","level":"company","krs":0}]} |  |  | KR-1:c |
| a team goal straight under company | workspace | {"goals":[{"id":"c","level":"company","krs":2},{"id":"t","level":"team","parent":"c","space":"s1","krs":2}]} | 100 | healthy | AL-3:t |
| three orphans | workspace | {"goals":[{"id":"c","level":"company","krs":2},{"id":"t1","level":"team","space":"s1","krs":2},{"id":"t2","level":"team","space":"s1","krs":2},{"id":"t3","level":"team","space":"s2","krs":2}]} | 0 | gap | AL-1:t1,AL-1:t2,AL-1:t3 |
| an individual goal under a department skips a level | workspace | {"goals":[{"id":"c","level":"company","krs":2},{"id":"d1","level":"department","parent":"c","space":"s1","krs":2},{"id":"d2","level":"department","parent":"c","space":"s2","krs":2},{"id":"i1","level":"individual","parent":"d1","space":"s1","krs":2}],"goalDeps":[["d1","d2"]]} | 100 | healthy | AL-3:i1 |
| an individual goal under a team does not | workspace | {"goals":[{"id":"c","level":"company","krs":2},{"id":"d1","level":"department","parent":"c","space":"s1","krs":2},{"id":"d2","level":"department","parent":"c","space":"s2","krs":2},{"id":"t1","level":"team","parent":"d1","space":"s1","krs":2},{"id":"i1","level":"individual","parent":"t1","space":"s1","krs":2}],"goalDeps":[["d1","d2"]]} | 100 | healthy |  |
| a same-level parent is not a skip | workspace | {"goals":[{"id":"c","level":"company","krs":2},{"id":"d1","level":"department","parent":"c","space":"s1","krs":2},{"id":"d2","level":"department","parent":"c","space":"s2","krs":2},{"id":"t1","level":"team","parent":"d1","space":"s1","krs":2},{"id":"t2","level":"team","parent":"t1","space":"s1","krs":2}],"goalDeps":[["d1","d2"]]} | 100 | healthy |  |
| a key result parent takes its goal's level | workspace | {"goals":[{"id":"c","level":"company","krs":2},{"id":"d1","level":"department","parent":"c","space":"s1","krs":2},{"id":"d2","level":"department","parent":"c","space":"s2","krs":2},{"id":"t1","level":"team","parent":"kr:d1","space":"s1","krs":2}],"goalDeps":[["d1","d2"]]} | 100 | healthy |  |
| space scope skips the anchor rule | space:s1 | {"goals":[{"id":"d1","level":"department","space":"s1","krs":2}]} | 0 | gap | AL-1:d1,AL-6:d1 |
| a key result dependency clears both sides | workspace | {"goals":[{"id":"c","level":"company","krs":2},{"id":"d1","level":"department","parent":"c","space":"s1","krs":2},{"id":"d2","level":"department","parent":"c","space":"s2","krs":2}],"krDeps":[{"goal":"d1","providerSpace":"s2"}]} | 100 | healthy |  |
| a closed goal is still counted | workspace | {"goals":[{"id":"c","level":"company","krs":2},{"id":"d1","level":"department","parent":"c","space":"s1","krs":2},{"id":"d2","level":"department","parent":"c","space":"s2","krs":2},{"id":"t","level":"team","space":"s1","krs":2,"closed":true}],"goalDeps":[["d1","d2"]]} | 66 | gap | AL-1:t |
| one goal in ten unaligned reads healthy, at the threshold | workspace | {"goals":[{"id":"c","level":"company","krs":2},{"id":"d1","level":"department","parent":"c","space":"s1","krs":2},{"id":"d2","level":"department","parent":"c","space":"s2","krs":2},{"id":"t1","level":"team","parent":"d1","space":"s1","krs":2},{"id":"t2","level":"team","parent":"d1","space":"s1","krs":2},{"id":"t3","level":"team","parent":"d1","space":"s1","krs":2},{"id":"t4","level":"team","parent":"d1","space":"s1","krs":2},{"id":"t5","level":"team","parent":"d1","space":"s1","krs":2},{"id":"t6","level":"team","parent":"d1","space":"s1","krs":2},{"id":"t7","level":"team","parent":"d1","space":"s1","krs":2},{"id":"t8","level":"team","space":"s1","krs":2}],"goalDeps":[["d1","d2"]]} | 90 | healthy | AL-1:t8 |
| two in ten is watch | workspace | {"goals":[{"id":"c","level":"company","krs":2},{"id":"d1","level":"department","parent":"c","space":"s1","krs":2},{"id":"d2","level":"department","parent":"c","space":"s2","krs":2},{"id":"t1","level":"team","parent":"d1","space":"s1","krs":2},{"id":"t2","level":"team","parent":"d1","space":"s1","krs":2},{"id":"t3","level":"team","parent":"d1","space":"s1","krs":2},{"id":"t4","level":"team","parent":"d1","space":"s1","krs":2},{"id":"t5","level":"team","parent":"d1","space":"s1","krs":2},{"id":"t6","level":"team","parent":"d1","space":"s1","krs":2},{"id":"t7","level":"team","space":"s1","krs":2},{"id":"t8","level":"team","space":"s1","krs":2}],"goalDeps":[["d1","d2"]]} | 80 | watch | AL-1:t7,AL-1:t8 |
| three in ten is a gap | workspace | {"goals":[{"id":"c","level":"company","krs":2},{"id":"d1","level":"department","parent":"c","space":"s1","krs":2},{"id":"d2","level":"department","parent":"c","space":"s2","krs":2},{"id":"t1","level":"team","parent":"d1","space":"s1","krs":2},{"id":"t2","level":"team","parent":"d1","space":"s1","krs":2},{"id":"t3","level":"team","parent":"d1","space":"s1","krs":2},{"id":"t4","level":"team","parent":"d1","space":"s1","krs":2},{"id":"t5","level":"team","parent":"d1","space":"s1","krs":2},{"id":"t6","level":"team","space":"s1","krs":2},{"id":"t7","level":"team","space":"s1","krs":2},{"id":"t8","level":"team","space":"s1","krs":2}],"goalDeps":[["d1","d2"]]} | 70 | gap | AL-1:t6,AL-1:t7,AL-1:t8 |
| a reason to stand alone counts as aligned | workspace | {"goals":[{"id":"c","level":"company","krs":2},{"id":"d1","level":"department","parent":"c","space":"s1","krs":2},{"id":"f1","level":"department","space":"s2","krs":2,"standalone":"Finance operating cadence the board relies on"}],"goalDeps":[["d1","f1"]]} | 100 | healthy |  |
| a blank reason does not | workspace | {"goals":[{"id":"c","level":"company","krs":2},{"id":"d1","level":"department","parent":"c","space":"s1","krs":2},{"id":"f1","level":"department","space":"s2","krs":2,"standalone":"  "}],"goalDeps":[["d1","f1"]]} | 50 | gap | AL-1:f1 |
| a parent in another space aligns a goal at space scope | space:s2 | {"goals":[{"id":"t1","level":"team","space":"s2","krs":2,"outside":"department"}]} | 100 | healthy |  |
| an annual company objective anchors a quarter | workspace | {"goals":[{"id":"d1","level":"department","space":"s1","krs":2,"outside":"company"},{"id":"d2","level":"department","space":"s2","krs":2,"outside":"company"}],"goalDeps":[["d1","d2"]]} | 100 | healthy |  |
| with no company objective the reading is a gap whatever the share | workspace | {"goals":[{"id":"d1","level":"department","space":"s1","krs":2,"standalone":"Regulatory work"},{"id":"d2","level":"department","space":"s2","krs":2,"standalone":"Regulatory work"}],"goalDeps":[["d1","d2"]]} | 100 | gap | AL-4: |
| company objectives alone have nothing to measure yet | workspace | {"goals":[{"id":"c1","level":"company","krs":2},{"id":"c2","level":"company","krs":2}]} |  |  |  |
| a dependency inside one subtree does not clear the silo | workspace | {"goals":[{"id":"c","level":"company","krs":2},{"id":"d1","level":"department","parent":"c","space":"s1","krs":2},{"id":"t1","level":"team","parent":"d1","space":"s1","krs":2}],"goalDeps":[["d1","t1"]]} | 100 | healthy | AL-6:d1 |

That last row is the one an implementation gets wrong. A dependency between a
department and its own team is internal, so the department is still siloed.

## 5. The bands

METHOD.md §5.2: healthy at 90% and above, watch from 80% to below 90%, a gap
below 80%, and a gap whatever the share with no company-level objective. The §11
parameters are `alignment.healthyThreshold` and `alignment.watchThreshold`.

<!-- golden: alignment.band -->

| case | score | anchored | healthy | watch | expected |
|---|---|---|---|---|---|
| perfect | 100 | yes | 90 | 80 | healthy |
| exactly at the healthy threshold | 90 | yes | 90 | 80 | healthy |
| just below it | 89 | yes | 90 | 80 | watch |
| exactly at the watch threshold | 80 | yes | 90 | 80 | watch |
| just below that | 79 | yes | 90 | 80 | gap |
| perfect with nothing at the top | 100 | no | 90 | 80 | gap |
| a looser workspace | 70 | yes | 75 | 60 | watch |
| a workspace with no watch band | 85 | yes | 85 | 85 | healthy |

The two thresholds are not checked against each other. A watch threshold at or
above the healthy one leaves no watch band, which is a choice a workspace can
make rather than an error.

The surface lists every unaligned goal, each one opening the goal it names.
That is the whole point of a finding carrying a subject.

## 6. Finding identity and dismissal

Structural findings are re-derived on every recompute, so they need a stable
identity or every run would either duplicate them or resurrect dismissals.

| Rule | Detail |
|---|---|
| Identity | `(scope, scope_id, cycle_id, rule_key, subject_goal_id, target_goal_id)` |
| Recompute | Upsert by identity. A row already `dismissed` stays dismissed |
| Condition cleared | The row is soft-deleted, not flipped to a closed state |
| Condition returns | A fresh row, in `open`. A dismissal does not survive the condition being fixed and broken again |
| Semantic findings | Never touched by this engine. It filters on `source = 'engine'` before writing anything |

That last row matters more than it looks. The Coach's semantic findings live in
the same table, and a structural recompute that cleared rows by scope rather
than by source would delete the Coach's work every time somebody edited a
weight.

## 7. Recomputation triggers

Driven from the outbox on structural change only. Progress and check-ins never
move the alignment score.

| Write | Recomputes |
|---|---|
| Goal created, deleted, closed or reopened | The workspace scope and the goal's space scope |
| Parent pointer changed | Both the old and the new parent's scopes |
| Goal level or owner changed | Same |
| Key result created or deleted | Only when the count crosses zero, which is the only thing the score reads |
| Goal dependency added or removed | Both ends' scopes |
| Key result dependency added, removed or confirmed | The depending goal's scope and the provider space's scope |
| Check-in published | Nothing |
| Value or weight changed | Nothing |

Budget: §13.1 gives 2 seconds for 10,000 goals in a job. The engine loads the
graph in one query per relation and computes in memory.

## 8. Acceptance criteria

**Given** 100 goals below company level of which 92 are aligned or stand alone
with a reason, **when** the score is read, **then** it reads 92 and is healthy,
and the eight unaligned goals are listed, each opening its goal (P9-T16a).

**Given** a tree with one unaligned goal among four below company level and one
siloed department, **when** the score is computed, **then** it reads 75, a gap,
and lists exactly two findings, each opening the goal responsible.

**Given** an unaligned goal, **when** its owner records why it stands alone,
**then** it counts on the next recompute and its finding is gone.

**Given** a siloed department, **when** any goal in its subtree gains a
dependency on a goal in another department, **then** the silo finding is gone on
the next recompute, and the score does not move: a silo is not in the share.

**Given** a key result dependency that is neither confirmed nor risk-owned,
**when** publish gate 4 is evaluated, **then** it is red. **When** a risk owner
is named without confirmation, **then** gate 4 is green and the dependency
finding stays open.

**Given** a finding the facilitator dismissed, **when** the score is recomputed
with the condition unchanged, **then** the finding stays dismissed and does not
reappear.

**Given** a workspace with no goals in the cycle, **when** the score is
computed, **then** there is no score and no findings, rather than a penalty for
an absent anchor.
