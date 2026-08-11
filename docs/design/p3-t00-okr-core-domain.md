# P3-T00: the OKR core domain

The Phase 3 design gate, part one of five. This document settles the domain:
cycles, the guided workflow, goals, key results and check-ins, with every
lifecycle written as Given / When / Then so the implementation tasks have
acceptance criteria they can copy rather than invent.

The four engines get their own documents, each carrying its golden-master
matrix:

| Document | Engine | Implemented at |
|---|---|---|
| [p3-t00-scoring-and-health-engine.md](p3-t00-scoring-and-health-engine.md) | Scoring, health, RAG, forecast, portfolio verdict | P3-T05 |
| [p3-t00-cadence-engine.md](p3-t00-cadence-engine.md) | Next due date, tolerance, staleness | P3-T06 |
| [p3-t00-kpi-engine.md](p3-t00-kpi-engine.md) | Periods, corridors, formulas, recovery drafting | P3-T12, P3-T13, P3-T14 |
| [p3-t00-alignment-engine.md](p3-t00-alignment-engine.md) | Penalty arithmetic, structural findings | P3-T09 |

Authority for every rule below is METHOD.md, then TECHNICAL-PLAN.md §4.3 to
§4.6 and §6. Where those documents are silent on something the code cannot
avoid deciding, the decision is recorded in the register below rather than made
quietly inside a function.

## 0. Approval

**Approved 2026-08-11.** Every recommendation in the register below stands as
written, including the six marked "practice". The three the gate flagged as worth
arguing with (D-1, D-5, D-15) were put directly and approved unchanged.

Two consequences follow from that and are now settled rather than open:

| Settled | Effect |
|---|---|
| D-5 stands, so no forecast-window parameter enters METHOD.md §11 | The forecast fits over the cycle. The registry is unchanged by Phase 3 |
| D-16 stands, so `alignment_findings.subject_goal_id` becomes nullable | A documented deviation from TECHNICAL-PLAN.md §4.5. DATABASE.md records it in the same change as the migration, at P3-T09 |

## 1. The decision register

Fifteen points where the canon does not reach far enough to write the code. Each
carries a recommendation. **A decision marked "practice" changes what the
product tells users about their OKRs and needs an explicit answer before the
task that depends on it starts. A decision marked "mechanical" can be taken as
recommended unless you say otherwise.** All fifteen were approved as written on
2026-08-11; see §0.

| # | Question | Kind | Recommendation | Blocks |
|---|---|---|---|---|
| D-1 | For a `maintain` key result, what is the band and how is "the distance back to the band" scaled? | Practice | Band is `[min(baseline, target), max(baseline, target)]`. Outside it, progress is `100 × (1 − distance / bandWidth)`, clamped at 0. A zero-width band scores 100 only on an exact match. No new setting, because §11 forbids numerics outside the registry | P3-T05 |
| D-2 | A child goal aligned to a parent **key result**: does it change that key result's progress? | Practice | No. The key result keeps its own measurement, and the child rolls into the parent **goal** as a weighted item, exactly like a goal-aligned child. Otherwise a measured 40% key result can display 80% because another team did well, which breaks "key results are the proof" | P3-T05 |
| D-3 | What is the progress of a goal whose items all carry weight 0, or which has no items? | Mechanical | 0%, and health `pending` when there is no published check-in. Weight 0 means "tracked, does not count" | P3-T05 |
| D-4 | A KPI-backed key result reads the KPI's achievement. Real `achievement_pct` or `effective_pct` (the recovery projection)? | Practice | Real `achievement_pct`. Using the effective value would let a recovery goal's own progress feed its own key result's progress, a closed loop that inflates itself | P3-T14 |
| D-5 | The trend forecast fits "a linear fit over the recent window". §11 defines no window, and §11 forbids numerics outside itself | Practice | Fit over every value point inside the goal's cycle, projecting to the cycle end date. For a contextual goal with no cycle, fit over points since the goal was created and project to the key result's due date. Needs at least two points at distinct timestamps. The alternative is adding a window parameter to §11, which is a METHOD.md change and therefore yours | P3-T05 |
| D-6 | How long is the check-in edit window? §11 defines no duration | Practice | It closes on whichever comes first: a newer published check-in on the same goal, or the moment the next due date passes. Both are already-defined quantities, so no new numeric enters | P3-T07 |
| D-7 | Does the alignment silo check count key result dependencies, or only goal dependencies? | Practice | Both. The key result register in §5.4 is where dependencies actually get recorded, so counting only goal-level links would flag teams that had declared their dependencies properly | P3-T09 |
| D-8 | Does the recovery drafter's walk descend only through **unhealthy** children? | Practice | No filter on health. §6.5 says the walk finds leading drivers by descending through lagging children, and says nothing about their state. A healthy leading driver can still be the lever | P3-T14 |
| D-9 | Formula source with no records in the target period: 0 or no value? | Mechanical | No value, so the dependent reads `no_data` rather than a false `unhealthy`. Exception: `count` over an empty span is 0, because zero records is a real count | P3-T13 |
| D-10 | Is achievement capped? | Mechanical | Floor 0, **ceiling 200**. A ceiling is forced: `lower_better` at an actual of zero divides by zero, so the function needs one to stay total. Applying it to both directions keeps them symmetrical, and the corridor bands only ever test from below | P3-T12 |
| D-11 | Are closed goals inside the alignment score's scope? | Mechanical | Yes. Alignment is a property of the set as published, and excluding closed goals would make the score climb as a cycle ends | P3-T09 |
| D-12 | Do KPI weekly periods start on Monday, or on the workspace `check_in_anchor_day`? | Mechanical | Monday, ISO-8601. KPI periods are calendar buckets shared with reporting, not the check-in rhythm | P3-T12 |
| D-13 | §13.1 has no performance budget for the scoring cascade. What is it? | Mechanical | Under 200 ms for a 1,000-goal chain as a pure function with no I/O, derived from the neighbouring "alignment score, 10,000 goals, under 2 s in a job". Stated in the design document, not the §11 registry, which holds practice thresholds and not budgets | P3-T05 |
| D-14 | §11 names one check-in frequency default and never enumerates the set | Mechanical | `daily`, `weekly`, `biweekly`, `monthly`, `quarterly`. `biweekly` spelled as the FlowyTeam reference model spells it, so the importer needs no translation | P3-T02 |
| D-15 | What is the achievement of a KPI whose **target** is negative? | Practice | No achievement and a `negative_target` diagnostic, so the KPI reads `no_data`. There is no correct ratio over a negative target: `higher_better` with target -3 and actual -1 computes 33% while the KPI has actually beaten its target. The owner is told to model it as `lower_better` on the loss. A negative **actual** against a positive target is fine and clamps to 0 | P3-T12 |

Three of these are worth arguing with rather than approving. **D-1** invents an
arithmetic that METHOD.md gestures at in five words, and it is the only
`maintain` semantics the product will ever have. **D-5** exists because a
forecast needs a window and the registry has none, so either the recommendation
stands or METHOD.md §11 gains a parameter. **D-15** narrows what a KPI can be:
it says a KPI aimed at a negative number reports nothing rather than reporting a
ratio that is wrong, and METHOD.md §6.3 names operating margin as a typical root
KPI, which is exactly the metric that can go negative.

## 2. What this gate does not settle

| Not settled | Why | Where it lands |
|---|---|---|
| The 26 quality checks and the Draft Coach | Phase 4's own design gate, P4-T00 | P4-T01 to P4-T03 |
| Sessions, the decision log, blockers, commitments, streaks | Domain G, Phase 4 | P4-T04 onward |
| The quarterly review, root causes, minutes | Domain H, Phase 4 | P4-T08 onward |
| Initiatives and tasks as Work Map rows | Domain I, Phase 5 | P5-T01 |
| Semantic alignment findings | The Coach agent needs AI | P4-T03 |
| Points and the scorecard layer | Off by default and unfunded | P3-T15, disabled |

Two phase-completion predicates therefore cannot be fully computed in Phase 3.
This is recorded rather than faked:

| Phase | Condition | Phase 3 behaviour |
|---|---|---|
| 6 | "Cadence booked for the whole cycle and at least one decision recorded" | Sessions and the decision log are domain G. The predicate returns `todo` for both inputs, never `pass`, until P4-T04 |
| 7 | "Every key result scored and the retrospective written" | Key result scores are Phase 3. The cycle retrospective is domain H. The predicate returns `todo` for the retrospective until P4-T08 |

A predicate that cannot see its input returns `todo`, never `pass`. This is the
Phase 1 rule about gates that check nothing, applied to phase completion.

## 3. Cycles and the annual frame

### 3.1 The annual frame

One current frame per workspace with history. The frame is read-only reference
material during a quarterly cycle (METHOD.md §2.1). Phase 3 of a quarterly
cycle revalidates it and never rewrites it.

| Rule | Enforcement |
|---|---|
| At most one frame per workspace is current | Partial unique index on `(workspace_id) where superseded_at is null` |
| A quarterly cycle cannot write frame fields | The frame's update action requires the acting cycle to be `mode = 'annual'`, or no cycle at all |
| 2 to 5 annual strategies | `annual_strategy_bounds` in the §11 registry. Below 2 fails Phase 0 completion, above 5 warns |
| The not-doing list is text, not a relation | METHOD.md §2.1 lists it as part of the frame. Rich text, one field |

### 3.2 Cycle states and the phase pointer

Two separate things, deliberately. `status` is the cycle's own lifecycle.
`phase` is the facilitator's position in the eight-phase workflow.

| `status` | Meaning | Entered by |
|---|---|---|
| `planning` | Phases 0 to 5 are running. Goals may be drafted, nothing is published | Creation |
| `active` | Published, inside its dates. Phase 6 | Publication, on or after `starts_on` |
| `closing` | Past `ends_on`, Phase 7 running | The cycle-end job, or the facilitator |
| `closed` | Scored and archived | The archive action (P3-T15) |

`phase` is a smallint 0 to 7 the facilitator moves freely. It never gates a
write on its own. What gates is the phase **completion predicate** of the
phases before it.

| Rule | Detail |
|---|---|
| Phase 0 exists only for `mode = 'annual'` | A quarterly cycle's predicate for phase 0 returns `not_applicable` |
| Moving the pointer forward is always allowed | The facilitator can look ahead. The surface renders what is missing |
| Phase 4 drafting is blocked while Phase 1 is incomplete | METHOD.md §2.6: the facilitator can refuse to run Phase 4 without a complete input pack. The product refuses on their behalf, naming each missing item |
| Publication is blocked while any of the six gates is red | Hard, always, regardless of strictness (METHOD.md §4.5) |

### 3.3 Cycle generation from the cadence

Cycles are generated forward from the workspace cadence and timezone, never
guessed at read time.

| Cadence | Bounds of the period containing date D (workspace timezone) |
|---|---|
| `annual` | 1 January to 31 December of D's year |
| `semiannual` | 1 January to 30 June, or 1 July to 31 December |
| `quarterly` | Calendar quarter: Jan to Mar, Apr to Jun, Jul to Sep, Oct to Dec |
| `monthly` | First to last day of D's month |

| Rule | Detail |
|---|---|
| Naming | `quarterly` reads `Q3 2026`, `semiannual` reads `H2 2026`, `monthly` reads `August 2026`, `annual` reads `2026`. Overridable per cycle |
| The active cycle is created on demand | Resolving "the current cycle" for a workspace with none creates the one containing today, in `planning`, inside the same transaction |
| Generation is idempotent | Unique on `(workspace_id, mode, starts_on)` |
| The fiscal year is calendar | No fiscal-year-offset setting is introduced. A workspace whose year starts in April is a deferred requirement, recorded here rather than half-built |

**Given** a workspace on quarterly cadence in `Asia/Jakarta` with no cycles,
**when** any surface resolves the active cycle on 2026-08-11,
**then** a cycle named `Q3 2026` exists with `starts_on` 2026-07-01 and
`ends_on` 2026-09-30, status `planning`, and resolving it again creates nothing.

### 3.4 Phase completion predicates

METHOD.md §2.3 as computed predicates. Each returns `pass`, `todo` or
`not_applicable`, with the unmet conditions named. Nothing here is a
user-settable boolean.

| Phase | Predicate |
|---|---|
| 0 | `annual_frames.mission` and `.strategy` non-empty, 2 to 5 `annual_strategies`, at least one goal at `level = 'company'` in this cycle with at least one key result. `not_applicable` when `mode = 'quarterly'` |
| 1 | `sponsor_id` and `facilitator_id` set, all 7 `cycle_pack_items` rows `gathered`, `pack_distributed_at` at least `input_pack_lead_time` working days before the first `session_dates` entry |
| 2 | `first_cycle` is true, or every `cycle_prior_scores` row has a score; a `cycle_baseline_health` row exists; at least `strategic_issue_bounds.min` `cycle_issues` rows each with an impact |
| 3 | Annual: 3 to 5 `cycle_priorities` each with a non-empty `success_statement`, `annual_frames.not_doing` non-empty, `agreed` true. Quarterly: a `cycle_revalidations` row with `holds` true or `changed` true with a `change_note`, plus at least one `cycle_focus_key_results` row (or a non-empty `focus_note` when the frame has no annual key results) |
| 4 | Every goal in the cycle passes the METHOD.md §4 checks at the workspace strictness. Returns `todo` until P4-T01 ships the evaluator, and reports that reason rather than passing |
| 5 | All six `cycle_gate_state` rows `passed`, and `published_at` set |
| 6 | Sessions cover the cycle and at least one decision exists. Returns `todo` with "sessions arrive at P4-T04" until then |
| 7 | Every key result in the cycle has a `score`, and a cycle retrospective exists. The retrospective input returns `todo` until P4-T08 |

Working days for Phase 1 mean Monday to Friday in the workspace timezone. No
holiday calendar. Recorded as a known simplification.

### 3.5 The six publish gates

METHOD.md §4.5, one `cycle_gate_state` row per gate, recomputed on every write
that could change it. Never stored as a user-set boolean.

| Gate | Green when | Recomputed by a write to |
|---|---|---|
| 1 | Every goal in the cycle has a non-empty title, a `champion_id` and a `reviewer_id` | goals |
| 2 | Every key result passes the §4.2 checks | key results, goals. `todo` until P4-T01 |
| 3 | Every goal has a parent pointer or a non-empty `contribution_statement` | goals |
| 4 | Every `key_result_dependencies` row is `confirmed`, or has a `risk_owner_id` | key result dependencies |
| 5 | No key result has `capacity = 'exceeds'`, and a `cycle_capacity_notes` row with non-empty `cuts` exists | key results, capacity notes |
| 6 | `publication_deadline` is set and falls before `starts_on` | the cycle |

Gate 2 returns `todo` before P4-T01, which keeps publication blocked. That is
the correct failure direction: a gate that cannot evaluate must not pass.

**Given** a cycle with one key result whose dependency is neither confirmed nor
risk-owned, **when** the facilitator publishes, **then** the write is refused,
gate 4 is red, and the response names that key result and its dependency.

### 3.6 Rhythm settings

One row per workspace holding the METHOD.md §11 registry deviations and the
terminology labels.

| Field | Rule |
|---|---|
| `overrides jsonb` | Sparse. Only keys that deviate from the canon default. Validated against the registry schema in `packages/method` on write, rejecting unknown keys and out-of-range values |
| `labels jsonb` | Terminology overrides (for example "Objective" to "Ambition"). Sparse, validated against a fixed key set |
| Resolution | `resolveThresholds(workspaceOverrides)` in `packages/method` returns the full parameter set. Every engine takes the resolved set as an argument. No engine reads a database or a global |
| Effect | Immediate. No restart, no cache with a lifetime. Reads resolve per request |

**Given** a workspace that overrides the staleness grace to 5 days, **when** a
goal is 4 days past its due date, **then** it does not read `outdated`, and
changing the override back to 3 makes it read `outdated` on the next render
with no restart.

## 4. Goals

### 4.1 Fields that carry a rule

TECHNICAL-PLAN.md §4.4 holds the full column list. These are the ones with
behaviour attached.

| Field | Rule |
|---|---|
| `champion_id` | Required. Exactly one member, never a team (METHOD.md §2.5) |
| `reviewer_id` | Required. Warned when equal to the champion, never refused: a one-person team has no other option |
| `level` | `company` / `department` / `team` / `individual`. Drives the level-skip and anchor rules |
| `owner_kind` | `workspace` / `space` / `member`, with exactly one of `space_id` / `member_id` set to match |
| `cycle_id` or `timeframe` | Exactly one. A goal with neither fails OBJ-3 |
| `weight` | Numeric, default 1, clamped to 0 to 100 on write. 0 means tracked but not counted |
| `parent_goal_id` / `parent_key_result_id` | At most one of the two. Cycles rejected |
| `contribution_statement` | Required to pass gate 3 when there is no parent |
| `progress_pct`, `health` | Derived columns, written only by the recompute job |

`health` is an enum with seven values: `pending`, `on_track`, `caution`,
`off_track`, `outdated`, `achieved`, `missed`. The last two are the closed
outcomes, so a closed goal never has to borrow a live status.

### 4.2 The single-parent invariant

| Rule | Enforcement |
|---|---|
| At most one parent pointer | Check constraint: `num_nonnulls(parent_goal_id, parent_key_result_id) <= 1` |
| No cycles | The write action walks upward from the proposed parent before committing, and refuses when it reaches the goal itself. Depth-limited to guard against pre-existing corruption from an import |
| A parent must be visible to the writer | Resolved through the access getter, so an invisible parent reads as not found rather than as a permission error |
| Cross-cycle parents are allowed | A quarterly goal aligning to an annual key result is the normal case |

**Given** goal A whose parent is goal B, **when** an editor sets B's parent to
A, **then** the write is refused with "that would make the alignment circular",
and A's parent is unchanged.

### 4.3 The close and reopen lifecycle

```
              ┌──────── close (requires outcome) ────────┐
              │                                          ▼
      ┌──── open ◄───────────── reopen ──────────────  closed
      │       ▲                                          │
      └── edit┘                                          └── retrospective kept
```

| Transition | Requires | Produces |
|---|---|---|
| close | `success_status` of `achieved` or `missed`, a `close_decision` of `keep` / `modify` / `abandon`, and a non-empty retrospective body | `closed_at`, `closed_by_id`, a `goal_retrospectives` row, an audit event, health `achieved` or `missed` |
| reopen | Nothing beyond edit access | Clears `closed_at`, `success_status`, `close_decision`. **Keeps** the retrospective. Health recomputes from the check-in cascade |

**Given** an open goal with two key results, **when** the champion closes it
without an outcome, **then** the write is refused naming the missing outcome.
**When** they close it as `achieved` with a decision and a retrospective body,
**then** the goal reads `achieved`, a retrospective row exists, and an audit
event records who closed it.

**Given** that closed goal, **when** it is reopened, **then** `success_status`
and `close_decision` are null, the retrospective row still exists, and health
reads whatever the latest published check-in says, or `pending` if there is
none.

### 4.4 Champion and reviewer reassignment

Both are access-bearing roles, so a reassignment is a rebind, not a column
update.

| Step | Detail |
|---|---|
| 1 | Remove the tagged binding for the outgoing member on this goal's context |
| 2 | Add the tagged binding for the incoming member |
| 3 | Update the column |
| 4 | Reassign every pending obligation of that role on this goal to the incoming member |
| 5 | Audit event naming both members and the role |

All five in one transaction through the Operation pipeline. A reviewer change
never retroactively creates an obligation for a check-in published before the
change: the review inbox reads the reviewer as of the check-in's publication,
which is why the reassignment records its own timestamp.

**Given** a goal whose reviewer has one unacknowledged check-in from today and
one from last month, already acknowledged, **when** the reviewer is replaced,
**then** the new reviewer owes exactly the one open acknowledgement, the old
reviewer owes none, and the acknowledged one is untouched.

### 4.5 Moving a goal between cycles

| Rule | Detail |
|---|---|
| Allowed while the target cycle is `planning` or `active` | A closed cycle refuses the move |
| Check-in history moves with the goal | History belongs to the goal, not the cycle |
| Prior-cycle scores do not move | `cycle_prior_scores` is a record of a scoring event in that cycle |
| Both cycles' gates and alignment scores recompute | Enqueued through the outbox in the same transaction |

## 5. Key results

### 5.1 Fields that carry a rule

| Field | Rule |
|---|---|
| `direction` | `increase` / `reduce` / `maintain` / `move`. KR-7 fails on anything else |
| `indicator_type` | `leading` / `lagging`. Required. KR-4 fails on an untagged key result |
| `baseline_value`, `target_value` | Both required (KR-3). Equal values score 0, which is intentional and visible |
| `current_value` | Defaults to `baseline_value` on create, so progress starts at 0 rather than undefined |
| `weight` | Same domain and clamping as a goal's |
| `kpi_id` | Optional. When set, `current_value` and progress are read from the KPI and manual value entry is refused |
| `capacity` | `fits` / `tight` / `exceeds`. Gate 5 reads it |
| `progress_pct`, `forecast`, `score` | Derived. `score` is writable only during Phase 7 |
| `carry_forward` | Set at close. Feeds the next cycle's issue list at impact 4 (§11) |

### 5.2 The value history

Every change to `current_value` writes a `key_result_values` row. There is no
path that updates the current value without one.

| `source` | Written by |
|---|---|
| `manual` | Direct edit on the key result |
| `check_in` | Publication, carrying `check_in_id` |
| `kpi` | The KPI cascade, when a linked KPI's achievement changes |
| `import` | The importer |
| `agent` | An applied agent proposal |

**Given** a key result at 40 with three history rows, **when** a check-in
publishes it at 55, **then** a fourth row exists with `source = 'check_in'`,
its `check_in_id` set, and the sparkline shows four points.

### 5.3 KPI-linked key results

| Rule | Detail |
|---|---|
| Manual value entry is refused | The value has one source of truth |
| Progress reads the KPI's real achievement | Decision D-4. Not the recovery projection |
| Unlinking freezes the last value | The key result keeps the value it had, as a manual value, and a history row records the unlink |
| A KPI update cascades to every linked key result | Through the outbox, then into the goal recompute |

## 6. Check-ins

### 6.1 The state machine

```
   draft ──publish──► published ──acknowledge──► published, acknowledged
     │                    │
   delete               edit (inside the window, re-snapshots)
     │                    │
     ▼                  delete (rolls the goal's pointers back)
   gone
```

| State | Emits activity | Emits notifications | Advances the cadence | Writes values |
|---|---|---|---|---|
| `draft` | No | No | No | No |
| `published` | Yes | Yes | Yes | Yes |

A draft is completely silent. Not "quiet", not "batched": no activity row, no
notification row, no outbox side effect, no cadence movement, no value history.

### 6.2 Publication

One transaction, in this order:

| Step | Detail |
|---|---|
| 1 | Refuse without a non-empty narrative, a status, and a confidence |
| 2 | Stamp `snapshot` from every key result's live state |
| 3 | Write a `key_result_values` row per key result whose value the composer changed, with `source = 'check_in'` |
| 4 | Set `goals.last_check_in_id` and recompute `progress_pct` and `health` |
| 5 | Advance `goals.next_check_in_at` through the cadence engine |
| 6 | Create the reviewer's acknowledgement obligation |
| 7 | Activity row, audit row, one outbox row for notification fan-out |

The snapshot is immutable and holds, per key result: identifier, value,
previous value, progress percentage, confidence, previous confidence. Immutable
means the column is never updated in place. An edit inside the window writes a
**new** snapshot and keeps the old one in the check-in's own history, so the
difference a reviewer already read cannot change under them.

### 6.3 The edit window

Decision D-6. The window closes on whichever comes first:

| Closing event | Reason |
|---|---|
| A newer check-in is published on the same goal | The period has moved on |
| `next_check_in_at` passes | The check-in now describes a finished period |

An edit inside the window re-snapshots and recomputes. An edit after it is
refused with the reason and a suggestion to post a new check-in.

### 6.4 Deletion

Deleting the latest published check-in must leave the goal exactly as it was
before that check-in.

| Restored | How |
|---|---|
| `last_check_in_id` | The previous published check-in, or null |
| `next_check_in_at` | Recomputed from the previous check-in's publication, or from the goal's creation |
| Key result values | The rows written by this check-in are soft-deleted, and each key result's `current_value` returns to the previous history row's value |
| Health and progress | Recomputed from what is left |
| The obligation | The acknowledgement obligation disappears |

Deleting a check-in that is not the latest leaves pointers alone and only
removes its own rows.

**Given** a goal whose latest check-in moved a key result from 40 to 55 and
advanced the due date to next Monday, **when** that check-in is deleted,
**then** the key result reads 40 again, the due date is back to the previous
Monday, health reads whatever the check-in before it said, and the reviewer no
longer owes an acknowledgement.

### 6.5 Acknowledgement

| Rule | Detail |
|---|---|
| Only the reviewer of record may acknowledge | Anyone else, including an admin, is refused. An admin who wants to close the loop reassigns the reviewer first, which is audited |
| Idempotent | Acknowledging twice is a no-op, not an error |
| A published check-in awaiting acknowledgement is a first-class state | Derived from `acknowledged_at is null`, per REQUIREMENTS.md §51 |
| Acknowledgement never changes health | It closes a loop. It is not a second opinion on the status |

### 6.6 Confidence votes

| Rule | Detail |
|---|---|
| Private until revealed | A vote is readable only by its author until `revealed_at` is set |
| The reveal is one write | A single transaction stamps `revealed_at` on every vote in the set, so no client can see a partial reveal |
| The team average is computed after the reveal | Before it, only the response count is visible |
| A vote is not a check-in | Votes never move health, progress or the cadence |

**Given** four members who have voted privately on a key result, **when** three
of them load the page before the reveal, **then** each sees only their own
number and the count 4. **When** the coordinator reveals, **then** every
connected client sees the same four numbers and the same average.

## 7. The recompute and invalidation map

Derived values are written by a job the outbox drives, never inline in a
request. `recomputeGoal(graph, change)` is the single entry point
(TECHNICAL-PLAN.md §6.2).

| Write | Invalidates |
|---|---|
| Key result value | Its goal, then every ancestor goal upward |
| Key result weight, direction, baseline, target | Same |
| Check-in published, edited or deleted | Its goal's progress, health and next due date, then every ancestor |
| Goal weight or parent pointer | The old parent's subtree and the new parent's subtree, plus the alignment score for the scope |
| Goal closed or reopened | The goal's health, then every ancestor's progress |
| Staleness sweep | Health only, of the goals it touched |
| KPI record | Every calculated KPI downstream, then every linked key result, then their goals upward |
| Rhythm settings | Nothing stored. Thresholds resolve per read |
| Space membership | No derived value. Access only |

Every fan-out is idempotent and safe to replay, because the outbox is
at-least-once.

## 8. Settings this phase adds

Declared in TECHNICAL-PLAN.md §4.14 with a working default, so a fresh
workspace needs no configuration (the hard rule in CLAUDE.md).

| Key | Default | Added at |
|---|---|---|
| `spaces.default_space_name` | "General" | P3-T01 |
| `cycles.cadence` | `quarterly` | P3-T02 |
| `cycles.timezone` | The workspace timezone | P3-T02 |
| `cycles.auto_generate` | true | P3-T02 |
| `goals.default_check_in_frequency` | `weekly` (§11) | P3-T02 |
| `goals.check_in_anchor_day` | Monday (§11) | P3-T02 |
| `kpis.weekly_period_start` | Monday, fixed, not overridable | P3-T12 |
| `demo.enabled` | false | P3-T17 |

Every numeric threshold, band, corridor and penalty is **not** in this table.
Those live in the METHOD.md §11 registry, resolved through
`packages/method`. A threshold appearing in the settings map would be a bug.

## 9. Acceptance criteria for this gate

**Given** this document and the four engine documents, **when** the human
reviews the golden-master matrices line by line, **then** every decision in the
register above is either approved or answered differently, and the answer is
recorded here before P3-T01 starts.

**Given** an approved gate, **when** P3-T05, P3-T06, P3-T09 and P3-T13 run
their suites, **then** they load the matrices from these documents directly
through `loadGoldenTable`, so a change to a matrix breaks the build rather than
drifting away from it.
