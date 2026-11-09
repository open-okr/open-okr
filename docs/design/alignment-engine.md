# Alignment engine

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

Decisions D-7 and D-11 from [the domain document](okr-core-domain.md)
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

### 3.2 AL-1, per goal, and the goals the share leaves out

Since P9-T16b-a the share and AL-1 are two answers, because METHOD v2 gives
them different tests:

| Goal below company level | In the share | AL-1 |
|---|---|---|
| A parent, or a standalone reason | Counted | Pass, unless its contribution is short |
| No parent, no reason, a contribution of at least "Contribution minimum" words | Not counted, and listed | Pass: it says what it supports |
| No parent, no reason, no contribution | Not counted, and listed | Warn: "which priority does this move forward?" |
| Any, with a contribution under "Contribution minimum" words | As above | Warn: "growth is not a priority, it is a word" |

Rows are first match wins, as every §4 table is. `uncounted` lists every goal
the share left out whether or not AL-1 is raised, because §5.2 says the coach
lists every unaligned goal and AL-1 may be off.

### 3.3 No key results, per goal

Fires when a goal has zero non-deleted key results. Applies at every level,
including company.

### 3.4 Level skip, per goal

Measured over the levels the cycle uses (G-3, P9-T16b-a): the levels it began
with, plus the two being compared, in this order. A cycle without departments
reads a team goal under a company one as one level, not two.

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

### 3.6 Which findings are said

The engine reports what it sees; `enforceAlignment` then drops the findings of
any check the cycle's practice turned off, as `applyEnforcement` does for the
other checks. AL-3 and AL-6 are off by default, so by default nothing is said
about a skip or a silo, and no nudge goes out for either. The share never
moves with a check's level. Two readers apply the same rule to stored rows,
because a practice change recomputes nothing: `alignment.read` shows a stored
structural finding only while the live answer still raises it, and the
nudge reader skips a finding whose check is off.

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
| Identity | `(rule_key, subject_goal_id, target_goal_id, subject_key_result_id)` within one `(scope, scope_id, cycle_id, source, kind)` slice (`reconcileFindingsInTx`) |
| Recompute | Upsert by identity. A row already `dismissed` stays dismissed |
| Condition cleared | The row is soft-deleted, not flipped to a closed state |
| Condition returns | A fresh row, in `open`. A dismissal does not survive the condition being fixed and broken again |
| Semantic findings | Never touched by this engine. It filters on `source = 'engine'` before writing anything |

That last row matters more than it looks. The Coach's semantic findings live in
the same table, and a structural recompute that cleared rows by scope rather
than by source would delete the Coach's work every time somebody edited a
weight.

## 7. Recomputation triggers

Driven by structural change only, inside the writing transaction until a relay
host drains the outbox (see the note at the top). Progress and check-ins never
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
and the engine raises exactly two findings, each opening the goal responsible.
With AL-6 at its default, off, only the unaligned goal's finding is said.

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

## 9. One-click applicability (plan 0.7.0 A6)

Status: proposed 9 November 2026. Approved by Akmal on 9 November 2026
("design approved"), Q1 as proposed: derived, no schema change. **Built.**
`oneClickApplicable` in `packages/core/src/alignment/applicable.ts`;
`alignment.read` returns it with the target, and the panel's re-parent button
follows it. It was on the plan as a schema change, so it was designed first
(CLAUDE.md).

`docs/design/agents.md` §1.5 lists a `one_click_applicable` boolean on
`alignment_findings`, "true when the fix is mechanical (re-parent, add
dependency)". METHOD.md §5.3: "Where the fix is mechanical (relink,
dependency), the finding offers a one-click proposal for a person to accept."

### 9.1 What exists

| Piece | Where | Today |
|---|---|---|
| The apply | `alignment.applyFinding`, `packages/core/src/actions/alignment.ts` | Since P4-T06b-b. Accepts a `relink` only, open, naming both the goal to move and its new parent, with edit access to both. Re-parents through `goals.update` |
| Why a dependency is not applied | The same action's header | A `dependency` finding says two goals should be linked; §5.4's register needs a provider named and a direction chosen, which is a decision, not a click. A `conflict` or a `gap` has nothing to apply |
| The button | `apps/web/app/goals/alignment-panel.tsx` | Drawn when `finding.kind === "relink"` |
| What a reader is told | `alignment.read` | Each finding's kind, reason, state and subject. **Not** the target goal, and not whether it can be applied |

So the rule already lives in two places that can disagree: a relink written
without its target draws a button the action then refuses. And an external
agent, which reads `alignment.read`, cannot tell which findings it may offer to
apply.

### 9.2 Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Derived, not stored.** One pure function, `oneClickApplicable({ kind, state, subjectGoalId, targetGoalId })`, in `packages/core/src/alignment/`: true for an open `relink` naming both goals. The action, the read and the panel all ask it | Every input is a column the row already has. A stored copy has to be written by every writer of the table (the structural engine, the semantic sweep, the divergence sweep, dismissals, applies) and backfilled for every existing row, and the day one writer forgets, the column and the action disagree. `nudges/quality.ts` refuses a second stored copy of an answer for the same reason |
| D2 | **`alignment.read` returns it**, as `oneClickApplicable`, with `targetGoalId` and `targetGoalTitle` beside the subject, so a reader sees what the click would do | The panel and an agent then ask the same question of the same answer |
| D3 | **A dependency stays unapplied**, as the action already decides | METHOD.md names "dependency" among mechanical fixes, but a dependency needs a provider and a direction (§5.4). Offering a click that then asks two questions is not one click. Changing that is a METHOD.md decision, not this row's |
| D4 | **`agents.md` §1.5's row changes** from a stored boolean to the derived field, with this section linked. No migration, no data change, nothing in TECHNICAL-PLAN §4 or DATABASE.md | The design doc is where the column was proposed, and the change is the design's own |

### 9.3 Question for Akmal

**Q1.** The plan row asks for a column. D1 proposes deriving the answer
instead, because every input is already on the row and a stored copy can go
stale. **Proposed: derived (D1), no schema change.** The alternative is the
column, with every writer setting it and a data change to backfill existing
rows.

### 9.4 Acceptance criteria

- **Given** an open relink naming its goal and its new parent, **when** the
  findings are read, **then** it says `oneClickApplicable: true` and names the
  target, and the panel offers the re-parent button.
- **Given** a relink with no target, **when** the findings are read, **then** it
  says `false` and the panel offers no button; **when** an agent applies it
  anyway, **then** it is refused, as today.
- **Given** a conflict, a gap, a dependency or a divergence, **then** it says
  `false`.
- **Given** an applied or dismissed relink, **then** it says `false`.

### 9.5 Tests

| Kind | File | Covers |
|---|---|---|
| Unit | `packages/core/test/alignment-applicable.test.ts` | The function, every kind and state |
| Integration | `packages/core/test/semantic-sweep.test.ts` (existing) | `alignment.read` returns the field and the target, and the target's title only to a reader who can see it. There rather than in `alignment.test.ts`, because only the Coach's review writes a relink and that file has its stand-in |
| Unit | `apps/web/test/alignment-panel.test.tsx` | The button follows the field |
| Contract | `pnpm check:contract` | `alignment.read`'s output grows by three fields |

## 10. The stored score (plan 0.7.0 D2)

Status: proposed 9 November 2026. Approved by Akmal on 9 November 2026
("design approved"), Q1 as proposed: latest only. **Built**, migration 0161 (numbered 0156 while it was built, and moved past 0157 to 0160 so that no database that already ran those refuses it as out of order),
with D5 replaced and three gaps settled while building (§10.6). A new table,
so it was designed first (CLAUDE.md).

TECHNICAL-PLAN §4.5 specifies `alignment_scores`: "the METHOD.md §5.2 score,
recomputed on structural change". Before this change DATABASE.md recorded it
as not built, and `alignment.read` computed the score when it was asked.

### 10.1 What exists

| Piece | Where | Today |
|---|---|---|
| The recompute | `recomputeAlignment`, `packages/core/src/alignment/service.ts` | Runs inside every structural write (§7), computes the whole result, reconciles the findings, and **drops the score** |
| The read | `alignment.read` | Loads the graph and computes again, every time |
| The Work Map | `apps/web/app/work-map-screen.tsx` | The home screen calls `alignment.read` on every load for two things, the score and its band, so the busiest page pays for the whole graph. §13.1 allows the computation 2 seconds at 10,000 goals |

### 10.2 Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **One row per scope per cycle, the latest only**: `workspace_id`, `cycle_id`, `scope` (`workspace` / `space`), `scope_id?`, `score smallint?`, `breakdown jsonb` (below company, aligned, standing alone with a reason, unaligned), `computed_at`. Unique on `(workspace_id, cycle_id, scope, scope_id)` with nulls not distinct | TECHNICAL-PLAN §4.5's columns. A null score is §5.2's "no score" for a cycle with nothing below company level |
| D2 | **Written by `recomputeAlignment`, in the writing transaction**, an upsert beside the findings reconcile | It already holds the answer. The score and the findings then commit together and can never disagree |
| D3 | **The band is not stored.** It is read from the score and the workspace's §11 alignment bands when the row is read | A workspace that moves its bands would otherwise read yesterday's band until somebody re-parents a goal |
| D4 | **A new read, `alignment.score { cycleId, scope?, spaceId? }`**, returning the score, the band, the breakdown and `computedAt`, at view access on the scope. The Work Map uses it | One row instead of the graph on the busiest screen. `alignment.read` keeps computing, because it lists every unaligned goal by name, which a number cannot |
| D5 | ~~**Backfilled once by data change 0034**, every cycle's workspace scope and each space scope with goals, through `recomputeAlignment`~~ **Replaced while building** by an hourly fill and a read that computes a missing row (§10.6) | A data change lives in `packages/db`, which cannot reach `recomputeAlignment` |
| D6 | **Tenant scoped, hard delete.** `workspace_id` with a tenant policy in the same migration; marked `openokr:hard-delete`, because a projection that a recompute replaces is not a record | As `search_documents` is. TECHNICAL-PLAN §7.2 gains a `No legacy source, derived` row |
| D7 | **A test holds the stored and the computed answer equal** after every write in the alignment suite | The one way a projection goes wrong is quietly, and this is where it would |

### 10.3 Questions for Akmal

**Q1.** D1 keeps the latest score only. Keeping one row per change instead would
give a trend line ("alignment rose from 62 to 88 over planning") at the cost of a
growing table. **Proposed: latest only.** A trend can come later from the
activity log, which already records each structural change.

### 10.4 Acceptance criteria

- **Given** a cycle with four goals below company level, three aligned, **when**
  a fourth is re-parented, **then** the stored workspace score reads 100 in the
  same transaction, and `alignment.read` computes 100.
- **Given** a workspace that moves its alignment bands, **when** the score is
  read, **then** the band follows the new bands with no recompute.
- **Given** an instance upgraded with cycles already planned, **when** the
  score is read before anything stored it, **then** it is computed and right,
  and **when** the fill has run, **then** every cycle with goals has a
  workspace row and a row for each space with goals, and a second run stores
  nothing (§10.6, replacing data change 0034).
- **Given** a parent deleted in one cycle with goals hanging from it in
  another, **when** it is deleted or restored, **then** the other cycle's
  stored score moves with it (§10.6).
- **Given** a member who cannot see a space, **when** they ask for its score,
  **then** it is not found.
- **Given** the Work Map, **when** it loads, **then** it reads one row and calls
  no graph computation.

### 10.5 Tests

| Kind | File | Covers |
|---|---|---|
| Integration | `packages/core/test/alignment-scores.test.ts` | The upsert on every §7 trigger, a parent deleted in another cycle, stored equals computed, the band from current thresholds, access, the read that computes a missing row, and the fill: once, and never over a row a write stored |
| Integration | `packages/core/test/alignment.test.ts` (existing) | Stored equals computed after every test in the suite, through `alignment-stored.ts` (D7) |
| Integration | `packages/db` migration suite, `pnpm db:lint` | Tenant policy, hard-delete marker, the unique index |
| Unit | `apps/web/test/work-map.test.tsx` | The Work Map reads `alignment.score` and never `alignment.read` |
| Unit | `apps/web/test/scheduler.test.ts` (existing) | The hourly fill is scheduled, as an instance job off the registry |
| Performance | `pnpm perf:budgets` | §13.1's new row, "Alignment score read, one cycle": 50 ms at the 95th percentile |

### 10.6 Settled while building, 9 November 2026

Akmal delegated these to the coordinator's recommendations the same day.

| # | Question | Settled |
|---|---|---|
| S1 | **D5 could not be built.** A data change lives in `packages/db`, which cannot import `packages/core` (where `recomputeAlignment` is) or `packages/method`. Repeating the §5.2 share in SQL would be a second copy of a METHOD rule, which CLAUDE.md forbids | **No data change.** `fillAlignmentScores` (`packages/core/src/alignment/fill.ts`) stores every live cycle with goals that has no workspace row, and every space with goals that has no row of its own, through `recomputeAlignment`, one workspace at a time inside its own tenant setting. The scheduler runs it hourly (`alignment.fillScores`, an instance job), `pnpm alignment:fill` runs it now, and `pnpm db:seed:large` runs it on its workspace. It never overwrites a row a write stored (`keepStored`), so a fill racing a write cannot leave the older answer |
| S2 | Reading a scope before the fill reaches it | **`alignment.score` computes it** through `alignmentInTx`, stores nothing, and says so with `computedAt: null`. So an upgraded instance is right from the first load, and D7 holds either way |
| S3 | The band needs `anchored` (§5.2: a gap whatever the share with no company-level objective), and D1's breakdown had no anchor | **`anchored` joins `breakdown`**, with `measured`, `withParent`, `standingAlone` and `unaligned`. `standingAlone` comes from the method package's result, so what a parent or a reason is stays one reading |
| S4 | D3 said "the workspace's" bands, and `alignment.read` reads the cycle's own rules, which a closed cycle freezes | **The cycle's own rules**, as `alignment.read`, so stored and computed stay equal. For an open cycle these are the workspace's current bands |
| S5 | The §13.1 row's ceiling | **"Alignment score read, one cycle": 50 ms at the 95th percentile.** TECHNICAL-PLAN §13.1, `BUDGETS` and its count move to sixteen rows |
| S6 | Writes that move a scope other than their own. A child reads its parent: a deleted parent is no parent, and a parent's level anchors. A quarter's goals hang under an annual objective, so deleting or restoring a goal, changing its level, or removing or restoring a key result moves another cycle's score. `goals.delete` also recomputed nothing at all, though §7 lists it | **These writes also recompute every scope a child sits in** (`scopesHangingFrom`), and the delete recomputes its own scopes. While every read computed live none of this showed; a stored score would have kept the old number |
| S7 | D4 named `scope?` beside `spaceId?` | **`spaceId?` alone**, as `alignment.read` takes it: a space id is the space scope, and none is the workspace's. View on the space or not found; the workspace's score is readable by any member, as `alignment.read` gives it to the Work Map today, guests included |

Two writes that recompute at the same moment each read the graph as it stood
before the other committed, so the later commit's score can miss the earlier
write. The findings table has always had the same window. The next structural
write in that cycle corrects it; a lock per cycle would close it, and is left
as a question rather than built.
