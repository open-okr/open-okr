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

## 1. The score

METHOD.md §5.2. Starts at 100. Each finding subtracts. Floor 5, ceiling 100.

<!-- golden: alignment.penalties -->

| finding | penalty | rule_key | severity | fires |
|---|---|---|---|---|
| no company-level objective anchors the tree | 10 | AL-4 | high | once |
| a goal below company level has no parent | 12 | AL-1 | high | per goal |
| an objective has no key results | 4 | KR-1 | medium | per goal |
| a goal skips a level | 3 | AL-3 | low | per goal |
| a department and its whole subtree have no horizontal dependency | 8 | AL-6 | medium | per department |

Every rule key resolves to a check that already exists in METHOD.md §4, so no
message cites a rule the method package does not define. Severity follows the
penalty size: 10 and above is high, 4 to 8 is medium, below 4 is low. Severity
drives how the finding is presented; the penalty drives the score. They are
separate on purpose.

An empty scope has **no score**, not 100 and not 90. A workspace with no goals
has nothing to align, and the surface says so. The function returns null.

## 2. What is in scope

| Rule | Detail |
|---|---|
| Scope | `workspace` or `space`, always for one cycle |
| Membership | Every non-deleted goal whose `cycle_id` is that cycle and whose owner falls inside the scope |
| Closed goals count | Decision D-11. Otherwise the score would climb as a cycle ends and goals close, which reads as alignment improving when nothing changed |
| The anchor penalty applies at workspace scope only | "A company objective anchors the tree" is not a statement about one space. At space scope it is skipped, not failed |

## 3. Each penalty, precisely

### 3.1 No anchor, 10, once

At workspace scope, fires when no goal in scope has `level = 'company'`. A
company objective with no key results still anchors: the test is existence at
that level. Its own missing key results are a separate finding.

**Decision D-16 (mechanical).** This finding has no subject goal, because
nothing caused it. TECHNICAL-PLAN.md §4.5 lists `alignment_findings.subject_goal_id`
without a nullable marker. The recommendation is to make it nullable and record
that in DATABASE.md in the same change, rather than attaching the finding to an
arbitrary goal that is not responsible for it. If you would rather keep the
column not-null, the alternative is a separate scope-level findings table, which
is more schema for one row.

### 3.2 Orphan, 12, per goal

Fires when `level` is not `company` and both parent pointers are null.

The `contribution_statement` does **not** excuse it. METHOD.md §4.3's AL-1 check
passes a goal that states its contribution in words, and §5.2's penalty says
"has no parent" with no escape. Two different instruments: AL-1 coaches the
drafter, the penalty measures the structure. Publish gate 3 accepts a
contribution statement; the alignment score does not.

### 3.3 No key results, 4, per goal

Fires when a goal has zero non-deleted key results. Applies at every level,
including company.

### 3.4 Level skip, 3, per goal

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
the goal that owns that key result.

### 3.5 Silo, 8, per department

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
(a goal id, or `kr:<goalId>` for a key result parent), an optional `space`, a
`krs` count, and an optional `closed`. `goalDeps` lists pairs. `krDeps` lists
`{goal, providerSpace}`. Findings are listed as `<ruleKey>:<subject>`, sorted,
with an empty subject for the scope-level anchor finding.

<!-- golden: alignment.score -->

| case | scope | graph | expected_score | expected_findings |
|---|---|---|---|---|
| the plan's own example: one orphan, one silo | workspace | {"goals":[{"id":"c","level":"company","krs":2},{"id":"d1","level":"department","parent":"c","space":"s1","krs":2},{"id":"d2","level":"department","parent":"c","space":"s2","krs":2},{"id":"d3","level":"department","parent":"c","space":"s3","krs":2},{"id":"t","level":"team","space":"s1","krs":2}],"goalDeps":[["d1","d2"]]} | 80 | AL-1:t,AL-6:d3 |
| a clean tree | workspace | {"goals":[{"id":"c","level":"company","krs":2},{"id":"d1","level":"department","parent":"c","space":"s1","krs":2},{"id":"d2","level":"department","parent":"c","space":"s2","krs":2}],"goalDeps":[["d1","d2"]]} | 100 | |
| nothing to align | workspace | {"goals":[]} | | |
| no company objective at all | workspace | {"goals":[{"id":"d1","level":"department","space":"s1","krs":2}]} | 70 | AL-1:d1,AL-4:,AL-6:d1 |
| an objective with no key results | workspace | {"goals":[{"id":"c","level":"company","krs":0}]} | 96 | KR-1:c |
| a team goal straight under company | workspace | {"goals":[{"id":"c","level":"company","krs":2},{"id":"t","level":"team","parent":"c","space":"s1","krs":2}]} | 97 | AL-3:t |
| three orphans | workspace | {"goals":[{"id":"c","level":"company","krs":2},{"id":"t1","level":"team","space":"s1","krs":2},{"id":"t2","level":"team","space":"s1","krs":2},{"id":"t3","level":"team","space":"s2","krs":2}]} | 64 | AL-1:t1,AL-1:t2,AL-1:t3 |
| enough penalties to hit the floor | workspace | {"goals":[{"id":"c","level":"company","krs":2},{"id":"t1","level":"team","space":"s1","krs":2},{"id":"t2","level":"team","space":"s1","krs":2},{"id":"t3","level":"team","space":"s1","krs":2},{"id":"t4","level":"team","space":"s1","krs":2},{"id":"t5","level":"team","space":"s1","krs":2},{"id":"t6","level":"team","space":"s1","krs":2},{"id":"t7","level":"team","space":"s1","krs":2},{"id":"t8","level":"team","space":"s1","krs":2}]} | 5 | AL-1:t1,AL-1:t2,AL-1:t3,AL-1:t4,AL-1:t5,AL-1:t6,AL-1:t7,AL-1:t8 |
| an individual goal under a department skips a level | workspace | {"goals":[{"id":"c","level":"company","krs":2},{"id":"d1","level":"department","parent":"c","space":"s1","krs":2},{"id":"d2","level":"department","parent":"c","space":"s2","krs":2},{"id":"i1","level":"individual","parent":"d1","space":"s1","krs":2}],"goalDeps":[["d1","d2"]]} | 97 | AL-3:i1 |
| an individual goal under a team does not | workspace | {"goals":[{"id":"c","level":"company","krs":2},{"id":"d1","level":"department","parent":"c","space":"s1","krs":2},{"id":"d2","level":"department","parent":"c","space":"s2","krs":2},{"id":"t1","level":"team","parent":"d1","space":"s1","krs":2},{"id":"i1","level":"individual","parent":"t1","space":"s1","krs":2}],"goalDeps":[["d1","d2"]]} | 100 | |
| a same-level parent is not a skip | workspace | {"goals":[{"id":"c","level":"company","krs":2},{"id":"d1","level":"department","parent":"c","space":"s1","krs":2},{"id":"d2","level":"department","parent":"c","space":"s2","krs":2},{"id":"t1","level":"team","parent":"d1","space":"s1","krs":2},{"id":"t2","level":"team","parent":"t1","space":"s1","krs":2}],"goalDeps":[["d1","d2"]]} | 100 | |
| a key result parent takes its goal's level | workspace | {"goals":[{"id":"c","level":"company","krs":2},{"id":"d1","level":"department","parent":"c","space":"s1","krs":2},{"id":"d2","level":"department","parent":"c","space":"s2","krs":2},{"id":"t1","level":"team","parent":"kr:d1","space":"s1","krs":2}],"goalDeps":[["d1","d2"]]} | 100 | |
| space scope skips the anchor penalty | space:s1 | {"goals":[{"id":"d1","level":"department","space":"s1","krs":2}]} | 80 | AL-1:d1,AL-6:d1 |
| a key result dependency clears both sides | workspace | {"goals":[{"id":"c","level":"company","krs":2},{"id":"d1","level":"department","parent":"c","space":"s1","krs":2},{"id":"d2","level":"department","parent":"c","space":"s2","krs":2}],"krDeps":[{"goal":"d1","providerSpace":"s2"}]} | 100 | |
| a closed goal is still counted | workspace | {"goals":[{"id":"c","level":"company","krs":2},{"id":"d1","level":"department","parent":"c","space":"s1","krs":2},{"id":"d2","level":"department","parent":"c","space":"s2","krs":2},{"id":"t","level":"team","space":"s1","krs":2,"closed":true}],"goalDeps":[["d1","d2"]]} | 88 | AL-1:t |
| a dependency inside one subtree does not clear the silo | workspace | {"goals":[{"id":"c","level":"company","krs":2},{"id":"d1","level":"department","parent":"c","space":"s1","krs":2},{"id":"t1","level":"team","parent":"d1","space":"s1","krs":2}],"goalDeps":[["d1","t1"]]} | 92 | AL-6:d1 |

That last row is the one an implementation gets wrong. A dependency between a
department and its own team is internal, so the department is still siloed.

## 5. The healthy threshold

METHOD.md §5.2: 75 and above is healthy. The §11 parameter is
`alignment_healthy_threshold`.

<!-- golden: alignment.health -->

| case | score | threshold | expected |
|---|---|---|---|
| perfect | 100 | 75 | healthy |
| exactly at the threshold | 75 | 75 | healthy |
| just below | 74 | 75 | unhealthy |
| at the floor | 5 | 75 | unhealthy |
| a stricter workspace | 80 | 85 | unhealthy |
| a looser workspace | 60 | 55 | healthy |

Below the threshold the surface lists the gaps, each one opening the goal that
caused it. That is the whole point of a finding carrying a subject.

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

**Given** a tree with one orphan goal and one siloed department, **when** the
score is computed, **then** it reads 80 and lists exactly two findings, each
opening the goal responsible.

**Given** a siloed department, **when** any goal in its subtree gains a
dependency on a goal in another department, **then** the silo finding is gone on
the next recompute and the score rises by 8.

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
