# P9-T00: Adaptable practice

The design gate for Phase 9. Written on 1 October 2026 for Akmal and Agung to approve with "design approved" before any Phase 9 code.

| | |
|---|---|
| Asked for by | Akmal, 1 October 2026: "the 'open okr' need to be robust and allow different flavor of OKR implementation … many hard lock need to be remove and instead make it adjustable in the admin setting" |
| Rests on | [METHOD-REVIEW.md](../METHOD-REVIEW.md), the review of every METHOD.md rule against public OKR practice |
| Approved practice text | [METHOD.md](../development-plan/METHOD.md) since P9-T21. Until then it was held in `p9-t00-method-v2.md`, deleted once every section had landed |
| Companion design | [p9-t00-okr-writing.md](p9-t00-okr-writing.md), the list and diagram views with inline editing |
| Decisions already made | Akmal, 1 October 2026: writing at any time by default, admin can restrict it; only structural publish checks block by default; committed and aspirational OKRs by default; Akmal's direction wins over [okr-entry-points.md](okr-entry-points.md) §2 ("keep every gate") |

---

## 1. What changes, in one table

| Today | After Phase 9 | Default |
|---|---|---|
| Nobody can create an objective or key result until phases 0 to 3 are complete, but only on the cycle screen: the API, CLI and copilot skip the check | One policy decides every practice refusal, for every caller | Anybody who can edit a space writes at any time |
| Six publish gates, "always hard" | Each check and each gate is block, warn or off | Structural defects block; quality warns; gate 6 off |
| A reviewer on every goal, required by the database | Off, optional or required | Optional |
| One kind of OKR | Committed and aspirational | Both, new objectives aspirational |
| Key results must be numeric ranges | Metric, maintain, milestone, baseline | All four |
| One target calibration per cycle, as a note unconnected to target edits; targets editable silently any time | Every target change recorded with its history; easing one toward its baseline needs a reason | No count limit |
| Penalty-based alignment score, level skips flagged | Share of goals aligned or standing alone with a reason | Healthy at 90% |
| KPI health as a ratio to target | The KPI's own thresholds by target type, ratio only as fallback | Ratio fallback 90/70 |
| Escalation reaches the sponsor in 48 hours | Ladders stop at the coordinator; the sponsor reads the digest | Sponsor off |
| "Opinionated, not configurable" | Opinionated defaults, adaptable practice: five profiles and a practice settings screen | Recommended profile |

## 2. The architecture: one registry, one policy, one snapshot

The H-09 drafting lock ([`goals.ts`](../../packages/core/src/actions/goals.ts) `refuseUnreadyDrafting`) is the cautionary tale for the whole phase:
- **A judgement became a lock.** METHOD.md said the facilitator *can* refuse, and the code refused everyone.
- **It was added in one place.** It runs only when a caller passes `guided: true`, so the cycle screen refuses while the API, the command line and the copilot do not.
- **Nothing could switch it off.**

The design prevents all three.

### 2.1 The practice registry, in `packages/method`

A pure registry beside the existing threshold registry ([`thresholds.ts`](../../packages/method/src/thresholds.ts)), in a new `practice.ts`.

```ts
export const PRACTICE = {
  "writing.when":           { label: "Who may write OKRs, and when", options: ["anytime", "planningWindow", "afterPhases"], default: "anytime" },
  "phases.enforcement":     { label: "Phase enforcement",            options: ["guided", "binding", "hidden"],               default: "guided" },
  "writing.midCycleAs":     { label: "New objectives mid-cycle start as", options: ["live", "ownerDraft", "reviewerApproval"], default: "live" },
  "reasons.easingTarget":   { label: "Reason when easing a target",  options: ["required", "optional"],                      default: "required" },
  "reviewer":               { label: "Reviewer per goal",            options: ["off", "optional", "required"],               default: "optional" },
  "checks.OBJ-1":           { label: "Check enforcement", item: "OBJ-1", options: ["asMethod", "block", "warn", "off"],   default: "asMethod" },
  "gates.3":                { label: "Publish gate enforcement", item: "Gate 3", options: ["block", "warn", "off"],        default: "warn" },
  // ... one entry per row of METHOD v2 §12.1, and per check, gate, level and key result kind
};

export const PROFILES: Record<ProfileKey, { label; for; practice: PracticeOverrides; thresholds: ThresholdOverrides }>;

export function resolvePractice(profile: string, overrides: unknown): ResolvedPractice;
```

**As built at P9-T01** ([`practice.ts`](../../packages/method/src/practice.ts)):
- **Every value is a word.** A number a profile sets, such as Radical Focus's one objective per team, is a §11 threshold, so a profile carries `practice` and `thresholds` separately.
- **`asMethod`** is a check's default: the level §4 gives it, which for KR-1, KR-3, KR-7 and the cycle checks is more than one level. Overrides are block, warn or off.
- **Storage.** `rhythm_settings.profile` names the profile and `rhythm_settings.practice` holds only the workspace's own changes. Resolution is defaults, then the profile, then the changes. Switching profile keeps the changes, and `differencesFromProfile` names the ones that now override the new profile, which `practice.applyProfile` returns and audits.
- **Profile thresholds are applied from P9-T05.** `cadence.checkInFrequency`, which Lightweight sets, has its own non-null column, so applying a profile's thresholds is a write the settings screen has to decide, not a layer at read time.
- **Strict mode, as built at P9-T03a.** It raises every check to block except one turned off. The §11 threshold `quality.coachStrictness` at `strict`, for the workspace or one space, still means the same, so the two cannot disagree and no workspace that chose strict before Phase 9 loses it. Retiring the threshold's `strict` needs a data change and one control on the settings screen, which is P9-T05's to decide.

**As built at P9-T05** ([`practice.ts`](../../packages/method/src/practice.ts), [`/admin/practice`](../../apps/web/app/admin/practice/page.tsx)):

| Decision | What was built | Why |
|---|---|---|
| A profile's thresholds | `switchProfile(current, to)` works out both halves of a switch. Practice is layered, so it only reports what moves. A threshold either profile names is written: one still at the old profile's value (or the canon's, if the old profile said nothing) follows the switch; one the workspace changed itself is kept and named. A value back at the canon is stored as nothing in `overrides`, and as the canon's value in a column | The same promise the practice makes, "this workspace's own changes are kept", held for the numbers too. One function serves the preview on the screen and the write in `practice.applyProfile`, so the two cannot disagree |
| Strict mode's one home | The practice's strict mode is the workspace's switch. The rhythm card's "Coach strictness" select is gone and links to the practice instead. Data change 0015 turns strict mode on for a workspace whose `coach_strictness` was `strict` and returns the column to `warn`. The column, and `rhythm.update`'s field, stay for a release, and `strict` in it still reads as strict mode for a workspace an older release writes to. A space's own strictness is unchanged | Two switches for one behaviour is two places to look, and turning strict mode off would have done nothing while the column still said strict. `advisory` and `warn` now mean the same thing, so neither is carried |
| Option words | Each setting carries `optionLabels` in §12.1's own words, and `pnpm method:check` compares them with the options column in both directions. A column may leave out only the default, which §12.1 names in the next column | The screen shows a choice to a person, and "planningWindow" is not a word. Keeping the words beside the options, under the conformance suite, means the screen and the document cannot drift |
| The screen | `/admin/practice`, between General and Rhythm in the admin navigation. A profile card with a preview, then one card per §12.1 group in the rhythm card's pattern: a form per card, a sticky header with its own save, "Unsaved", a toast, and "Reset to profile". A save sends only the settings that changed | The rhythm card's own lesson (P8-G11): a save ten screens from the field it commits is not a save anybody finds |
| The drafting refusal's heading | "This workspace's practice does not let a new objective be written here now", in place of "Drafting waits for the earlier phases" | The planning window refuses for a reason that is not a phase, and the heading sat above that reason |
- **One row was added to §12.1**: "Root causes at the review", as §8.4 or optional. The approved Lightweight profile makes root causes optional, and no setting existed to say so.

Every entry carries a Zod schema, a label, the METHOD.md section and a source line, exactly as a threshold does. The conformance suite gains one comparison: METHOD.md §12.1 against `PRACTICE`, in both directions, so a setting cannot exist in one and not the other.

**As built at P9-T07a-c**: the levels in use. `cycles.levels`, a column since P3-T01 that only its default and `cycles.update` ever wrote, is the record of the levels a cycle began with: it is written from the practice when the cycle is created, and a change to the practice's levels (an update or a profile) reaches only cycles that have not started, by the workspace's local date. `cycles.levelsInUse` answers what a cycle offers, its record plus any level an objective in it already has, and every level picker and the level filter read it. The policy refuses an objective at a level its cycle does not use, from every surface, citing that level's setting; an import is never refused. No migration was needed. P9-T14's snapshot at close records the practice in full; this keeps only what a running cycle has to keep before then.

### 2.2 One policy decides every practice refusal

A pure function, also in `packages/method` (`policy.ts`):

```ts
type Intent =
  | { kind: "objective.create"; cycle: CycleFacts; midCycle: boolean }
  | { kind: "keyResult.create"; cycle: CycleFacts; midCycle: boolean }
  | { kind: "target.change"; from: number; to: number; direction: Direction; reason?: string }
  | { kind: "objective.stop"; reason?: string }
  | { kind: "set.publish"; gates: GateResult[]; override?: string }
  | { kind: "draft.publish" | "draft.approve"; actorIsReviewer: boolean };

type Decision = {
  outcome: "allow" | "warn" | "block";
  rules: RuleKey[];            // every message cites a rule key, as today
  reasons: string[];           // plain sentences for the person
  createAs?: "live" | "draft" | "awaitingApproval";
};

export function decide(intent: Intent, practice: ResolvedPractice, t: ResolvedThresholds): Decision;
```

In `packages/core`, one helper wraps it:
- `requirePolicy(tx, workspaceId, intent)` loads the resolved practice inside the transaction, calls `decide`, and throws `OperationError("forbidden", reasons)` on block.
- Warnings are returned with the action result, so the interface shows them beside the work.

**As built at P9-T02** ([`policy.ts`](../../packages/method/src/policy.ts), [`practice/policy.ts`](../../packages/core/src/practice/policy.ts)):
- **Two intents so far**, `objective.create` and `keyResult.create`. Each later task adds the intents it governs: a target change at P9-T06, publishing at P9-T03b, drafts at P9-T13.
- **The phases are read only when the practice needs them** (`policyNeedsPhases`), because evaluating a cycle's workflow is a dozen queries. A caller that skips them under binding is refused loudly, never allowed quietly.
- **Drafting waits for phases 1 to 3, never phase 0**, because an annual OKR is what completes phase 0.
- **An import is not refused** (`bulk`): it records objectives somebody already wrote, and refusing history would lose data, which no setting may do (§2.5).
- **`workflow.read` returns the decision**, so the screen never offers a form the write would refuse.
- **The first cycle is inferred** when no earlier cycle of the same mode exists, in the workflow loader every surface reads.

**The rule that keeps it robust.** A source test lists every write action that creates, changes, publishes or closes an OKR and asserts that it calls `requirePolicy` or carries a written exemption. This is the same pattern as the trigger-emitter gate from H-11. The `guided` flag is deleted. A refusal for a practice reason anywhere else fails the build.

### 2.3 Enforcement levels, not new code paths

Checks keep returning pass, warn, fail or todo, as [`quality.ts`](../../packages/method/src/quality.ts) does today. One step is added after evaluation: `applyEnforcement(verdicts, practice)`.
- A check at **block** keeps its fails, and turns its warns into fails.
- A check at **warn** turns any fail into a warn.
- A check at **off** is dropped.

The gates in [`workflow.ts`](../../packages/method/src/workflow.ts) `publishGates` read the enforced verdicts and their own level. Strict mode is "every check at block". The structural parts of OBJ-3, OBJ-4, KR-1 and KR-3 default to block; nothing that matches words does.

### 2.4 A cycle keeps the rules it was graded under

`cycles.practice_snapshot` (jsonb) records the profile, the resolved practice and every threshold when a cycle closes, quality caps included, so a closed cycle's OKR-count warnings are as fixed as its score bands. Scorecards, portfolio verdicts and the diagnostic of a closed cycle read the snapshot, so changing a band next quarter never rewrites last quarter. Open cycles read the live settings.

### 2.5 Settings never destroy anything

| Change | What happens to existing data |
|---|---|
| A key result kind turned off | Existing ones keep working and scoring. Only creating new ones is hidden |
| Reviewer set to off | Existing reviewers stay on their goals and are simply not asked to acknowledge |
| Committed only, or aspirational only | Existing objectives keep their kind. Only the picker is hidden |
| A check or gate set to off | Its verdicts stop being computed. Nothing stored is deleted |
| Profile switched | Overrides are kept, and switching back restores them |

No setting can refuse a read or lose data. Every change is the audited action `practice.update`.

## 3. The data changes

All additive. Each new table gets `workspace_id` and its row-level security policy in the same migration. Renames and removals follow PLAN.md §5.1's two-release rule.

| Table | Change | Backfill (data-change runner) |
|---|---|---|
| `rhythm_settings` | `profile text not null default 'recommended'`, checked against the five profiles; `practice jsonb not null default '{}'`, checked to be an object (migration 0109, P9-T01) | None |
| `goals` | `kind goal_kind not null default 'aspirational'` (`committed`, `aspirational`) | None; existing goals read aspirational |
| `goals` | `added_mid_cycle_at timestamptz` (migration 0115, P9-T13-a), `standalone_reason text`, `draft_state` (`draft`, `awaiting_approval`; null means it follows its cycle). **As built at P9-T13-b-b**, `draft_state` is text with a check constraint (migration 0117), as every other enumerated goal column is | None |
| `goals` | `reviewer_id` drops `not null` | None |
| `key_results` | `kind key_result_kind not null default 'metric'` (`metric`, `maintain`, `milestone`, `baseline`), `done_at timestamptz` | `maintain` where `direction = 'maintain'` |
| `key_results` | `target_value` drops `not null` (migration 0116, P9-T13-b-a). Not in the original plan: §2.9's acceptance needs a metric key result saved before its target is known | None; every existing row has a target |
| `key_results` | `score_computed numeric`, `score_reason text` (migration 0120, P9-T14a) | `score_computed = score` where scored (data change 0018) |
| New `key_result_target_changes` | `workspace_id`, `key_result_id`, `from_value`, `to_value`, `reason`, `actor`, `changed_at`, `mid_cycle` | None |
| `cycles` | `practice_snapshot jsonb` (migration 0121, P9-T14b) | Closed cycles get today's canon. **As built, at read time rather than by backfill**: the canon is resolved by `packages/method`, which the data-change runner in `packages/db` does not reach, so a closed cycle with no snapshot reads the canon when it is read |
| `cycles` | `company_published_at timestamptz`, the first publish step (METHOD v2 §4.5, migration 0110). **Changed at P9-T03b** from a `teams_published_at` for the second step: `published_at` keeps meaning "the whole set is out" for every reader that relies on it, so a cycle published before the release needs no backfill | None |
| New `space_holidays` | `workspace_id`, `space_id`, `starts_on`, `ends_on`, `note` | None |
| New `member_leave` (G-2) | `workspace_id`, `member_id`, `starts_on`, `ends_on`, `delegate_member_id` | None |
| Root-cause enum | add `other`; sessions gain `secondary_root_cause` | None |
| Blocker-type enum | add `approach`, `other` | None |
| Close-decision enum | add `achieved`, `defer` | None |
| `kpis` | `target_type`, `green_value`, `red_value`, `band_low`, `band_high`; aggregate enum adds `last`, `first` | `target_type` from `direction` |
| `cycle_calibrations` | Stop writing in this release. The unique one-per-cycle index is dropped. The table is removed one release later | None |

DATABASE.md and the TECHNICAL-PLAN.md §7.2 importer mapping change in the same task as each migration. For FlowyTeam there is no key result type to map: corrected at P9-T12a, because neither its schema (`reference/flowyteam-okr-kpi-tasks-model.md`, "There is no KR 'type' enum") nor its API carries the `metric_type` this line once named. An imported key result is metric, or maintain where the importer already reads its equal baseline and target as one.

## 4. The contract

New actions in the registry, which regenerates REST, OpenAPI, the CLI and the agent tools:

| Action | Access | Purpose |
|---|---|---|
| `practice.read`, `practice.update`, `practice.applyProfile` | read, `full` | The settings screen and the API |
| `goals.tree` | read | One read for the list and the diagram: a cycle's objectives, key results, alignment and dependencies for a scope, plus every parent in another cycle (an annual objective) as read-only context |
| `goals.patch`, `goals.patchKeyResult` | edit | One field at a time, for inline editing, with an optimistic concurrency token, so a stale edit is refused with the current value rather than overwriting it |
| `goals.changeTarget` | edit | Records the change in `key_result_target_changes`, asks the policy whether a reason is needed |
| `goals.deleteKeyResult` | edit | Soft delete; there is no way to remove a key result today |
| `goals.setKind` | edit | Committed or aspirational, recorded in the activity |
| `goals.publishDraft`, `goals.approveDraft` | edit, reviewer | For workspaces whose mid-cycle objectives start as drafts, and for a mid-cycle addition that is a draft until it passes the checks set to block |
| `workflow.publish` gains `step: "company" \| "teams"`, absent for whatever is left | full | The two publish steps (METHOD v2 §4.5). Each step judges only what it publishes, and only a gate at block holds it |
| `spaces.setHolidays` | edit on the space | Holiday periods (METHOD v2 §7.4) |
| `goals.moveToSpace` (G-1) | edit on both spaces | Moves an objective with its key results, check-ins, dependencies and alignment, recorded as one dated change (METHOD v2 §2.9) |
| `people.setLeave` (G-2) | the member, or `full` | Leave with a delegate (METHOD v2 §7.4) |

Removed: the `guided` input on `goals.create` and `goals.addKeyResult`. The two-release rule applies to the input field: it is accepted and ignored for one release.

## 5. Robustness, the ten rules this phase holds to

| # | Rule | How it is enforced |
|---|---|---|
| R1 | One policy decides every practice refusal, whoever calls | `requirePolicy` plus the source test in §2.2 |
| R2 | Every setting is declared once, with a schema, a default and a source | `PRACTICE` registry; conformance against METHOD.md §12.1 |
| R3 | Settings changes are audited and closed cycles keep their rules | `practice.update` audit row; `cycles.practice_snapshot` |
| R4 | No setting loses data or refuses a read | §2.5, with a test per row |
| R5 | Concurrent inline edits never silently overwrite | Concurrency token on `goals.patch*`; the refusal carries the current value |
| R6 | History is data, not prose | Target changes, kind changes, mid-cycle additions and score adjustments are rows the close reads |
| R7 | Deterministic first | `decide`, `resolvePractice` and `applyEnforcement` are pure; AI only drafts |
| R8 | Every profile is tested end to end | A profile matrix: each of the five profiles × each intent, as a unit property test, plus one end-to-end spec per profile that writes, publishes and closes |
| R9 | Agents obey the same settings | The Coach and the Champion read the resolved practice; a trigger whose rule is off never fires, and the trigger-emitter gate checks the mapping |
| R10 | Importers produce the same model | CSV and FlowyTeam map kinds and key result kinds, and their writes go through `requirePolicy` with notification suppressed, as every import write does |

## 6. The tasks, and which METHOD.md sections each carries

Each task copied the named sections of `p9-t00-method-v2.md` into METHOD.md, with the code that makes `pnpm method:check` agree. The 67 differences the check reports today are all assigned below. Full task text is in IMPLEMENTATION-PLAN.md, Phase 9.

| Task | Title | METHOD v2 sections | Conformance differences it closes |
|---|---|---|---|
| P9-T01 | Practice settings: registry, storage and actions | §12 | New: §12.1 against `PRACTICE` |
| P9-T02 | One policy decides; anybody can write; the first cycle is inferred | §1 principle 11, §2.2, §2.3, §2.4, §2.6, §2.9 (who may write, and when) | "Team publication window", "Strategic issue minimum"; retire "Strategic issue bounds" |
| P9-T03a | Enforcement levels for the checks | §2.7 (all but its levels-in-use sentences), §4 intro, §4.1 (bar OBJ-4), §4.2's KR-1, KR-4 and KR-5, §4.6's first four pairs | Word lists ("to", "bring"); OBJ-1, OBJ-2 and KR-5 condition tables; "Objective length limit", "Strength score warn weight"; retire "Objective length bounds" |
| P9-T03b | Gate levels, and publishing in two steps | §4.4, §4.5 | None (behaviour) |
| P9-T04 | The reviewer becomes optional | §2.5, OBJ-4 | None (behaviour) |
| P9-T05 | The practice settings screen | none | New: §12.1's option words against `optionLabels` |
| P9-T06 to P9-T10 | OKR writing, list and diagram | none ([p9-t00-okr-writing.md](p9-t00-okr-writing.md)), except P9-T07a, which carries §2.7's first sentence with the level picker that reads the levels in use (G-3) | None |
| P9-T11a | The method by kind | §1 principle 4, §2.8, §3.2, §3.3's notes, §3.4, §4.2's KR-6, §4.4's CY-6, §4.5's gate 5, §4.6's committed pair, §5.5, and the sentences that quote the numbers it moves: §8.4's threshold, §9's phase 7 sandbagging line and §10's two rows on stretch. §3.3's root-cause note reads "Below 0.4", the bands' own lowest boundary, until P9-T14 moves the bands to 0.3 | The new scoring thresholds; retire the sandbagging and annotation parameters |
| P9-T11b-a | The kind stored and chosen | None of its own | None |
| P9-T11b-b | The kind in the rules | None of its own | None |
| P9-T11b-c | The committed floor | §10's committed row | None |
| P9-T12a | Kinds of key result in the method | §2.10, §3.1 but its last paragraph, KR-2, KR-3 and KR-7 | KR-2 condition table |
| P9-T12b | Kinds of key result in the data | §3.1's last paragraph, with the roll-up setting's consumer | None |
| P9-T12c-a | Kinds of key result on screen | None of its own | None |
| P9-T12c-b | Kinds of key result in the importers | None of its own | None |
| P9-T13-a | Adding OKRs mid-cycle | §2.9's four moves | None (behaviour) |
| P9-T13-b-a | A target that can wait, and live or draft | §2.9's live or draft | None (behaviour) |
| P9-T13-b-b | Drafts that wait for a person | none | None (behaviour) |
| P9-T13-c-a | Stopping | none (§2.9's four moves arrived at P9-T13-a) | None (behaviour) |
| P9-T13-c-b | Targets that move under one rule | §2.9's changing a target, §7.6 | The four calibration sentences |
| P9-T13-c-c | Annual revisions | §2.1, but its quarterly row's planning-open lead, which waits for P9-T19a | None (behaviour) |
| P9-T13a | Moving an objective to another space (G-1) | §2.9's "When the organisation changes" | None (behaviour) |
| P9-T14a | Score bands, and a computed score a person may adjust | §3.3 | Score band values |
| P9-T14b | Cycles that keep their rules | §12 snapshot paragraph | None (behaviour) |
| P9-T14c | The scorecard by cycle | none | None (behaviour) |
| P9-T15a | A progress signal that knows the date | §3.6, §3.7 | "Progress signal pace gaps", "Trend forecast minimum values" |
| P9-T15b-a | Health that says what happened | §3.5 but its divergence paragraph | None (behaviour) |
| P9-T15b-b | Divergence over a window | §3.5's divergence paragraph | "Divergence window" |
| P9-T16a | Alignment on ratios | §1 principle 9, §5.1, §5.2, §5.3 (§5.5 arrived at P9-T11a) | "Alignment watch threshold", "Alignment healthy threshold" at 90; retire "Alignment penalties" |
| P9-T16b-a | Alignment checks at their levels, over the levels in use (G-3) | §4.3, bar AL-5's escalation | "Contribution minimum" |
| P9-T16b-b | Escalating a dependency | §4.3's AL-5, §5.4 | None (behaviour) |
| P9-T17a | KPI health in its own units | §6.2 bar its owner and tier rows, §6.4 bar its recovering sentence, §6.7 | None (behaviour) |
| P9-T17b-a | Recovering beside the band | §6.1, §6.3, §6.4's recovering sentence | None (behaviour) |
| P9-T17b-b | The KPI form | §6.2's owner and tier rows | None (behaviour) |
| P9-T18a | A recovery OKR that passes its own checks | §6.5's recovery paragraphs | Recovery proposal delay value |
| P9-T18b | Three responses to an unhealthy KPI | §6.4's unhealthy row, §6.5's decision list, §6.6 | None (behaviour) |
| P9-T19a-a | Blockers on the check-in's clock | §7.3, the §11 blocker clock and blocker ladder rows | Blocker taxonomy and definitions; the blocker clock and ladder |
| P9-T19a-b | A next action for every low score | §7.2's step 2 | Weekly steps |
| P9-T19a-c-a | Ladders that stop at the coordinator | §3.2's confidence paragraphs, §7.2's last sentence of step 2, the §11 check-in ladder, acknowledgement ladder and critical confidence rows | The ladders; critical escalation opt-in |
| P9-T19a-c-b | A ceiling of five, and the digest that carries the rest | The §11 nudge ceiling row | The nudge ceiling, 10 to 5 |
| P9-T19a-d-a | A space's own check-in frequency | The §11 check-in frequency and planning-open lead rows, and §2.1's quarterly row's "about 4 weeks", which P9-T13-c-c left at 3 so the method did not disagree with its own §11 | "Planning-open lead" for a quarter, 3 to 4 weeks |
| P9-T19a-d-b | A streak and a booking at the team's frequency | §7.1's frequency paragraph and sources, §7.4's first paragraph | None (behaviour) |
| P9-T19a-d-c | Commitments, wins and the weekly digest | §7.1's weekly row, §7.2's steps 1, 3 and 4 | Weekly steps; commitment bounds |
| P9-T19a-d-d | The monthly review's moves | §7.1's monthly row, §7.5 | Rituals |
| P9-T19b-a | Holidays, and a rhythm that follows them | §7.4's first two paragraphs | None (behaviour) |
| P9-T19b-b | Leave, with a delegate | §7.4's leave paragraph (G-2) | None (behaviour) |
| P9-T20a | The review re-timed | §8's opening and act table, §8.1's minutes and purposes, §11 review length and stage minutes | Review stages and purposes |
| P9-T20b-a | The review and the retrospective apart | §8's format sentences | None (behaviour) |
| P9-T20b-b | The annual review | §8's annual sentence | None (behaviour) |
| P9-T20c | Scoring that closes on explanations, and root causes by kind | §8.3, §8.4 | Root causes |
| P9-T20d | The diagnostic, measured | §8.2's source, §8.5, §8.6, §11 diagnostic rows | Rhythm diagnostic; "Diagnostic rhythm threshold"; retire "Diagnostic rhythm-score threshold" |
| P9-T20e-a | Achieved and defer | §8.8 | Close decisions and meanings; stage 9's title |
| P9-T20e-b | Carrying forward, and the minutes | the rest of §8 | Stage 10's title |
| P9-T21 | The coach's voice, and METHOD.md fully landed | The preamble and terms, §1, §9, §10, §11 framing, §13 | Trigger catalogue (AI-NATIVE-PLAN.md §6.4) and the P4-T00 coach watch list; deletes `p9-t00-method-v2.md` and METHOD.md's banner |
| P9-T22a | Release 0.2.0 | none | None |
| P9-T22b | The demo shows the practice | none | None |
| P9-T22d | Stage ten drafts nothing | none | None |
| P9-T22c-a to e | The Northwind year on the real calendar (G-4), in five parts: its frame, the pilot and Q1, Q2, Q3, and Q4 with the demo | none | None |

**Live or draft under "Live", as built at P9-T13-b-a** ([`addition.ts`](../../packages/method/src/addition.ts)):

| Question | Answer |
|---|---|
| Which checks make an addition a draft? | Its own checks after enforcement, at `fail`. Set-level checks (OBJ-5, KR-4, KR-6, the alignment checks) are the gates', which an addition never faces. KR-1 counts for an objective, because one with no key result is not finished |
| How is "what is missing" named? | KR-3's failure is read field by field: a target, a due date, an owner, or a baseline where KR-3 was raised to block. OBJ-4's is the reviewer. Any other failing check is named by its title |
| Stored or computed? | Computed on every `goals.tree` read, for additions only. A stored answer would go stale the moment an admin raised a check to block, and the plan reads nothing extra |
| Who sees a draft? | Its goal's ordinary access. See the second question below |
| A target that is not set yet | Null. KR-3 fails, progress reads 0% and nothing is forecast, and the first target asks for no reason and writes no history row, because it eases nothing |

**Drafts that wait for a person, as built at P9-T13-b-b** ([`goal-drafts.ts`](../../packages/core/src/actions/goal-drafts.ts)):

| Question | Answer |
|---|---|
| What starts as a draft? | An objective added mid-cycle, under "Draft published by its owner" or "Draft approved by the reviewer". Not a key result: §2.9 gives this choice for "new objectives", so a key result added mid-cycle is live once complete under every setting. Not the plan, and never an import |
| Who publishes, who approves? | Its champion publishes; under reviewer approval it then waits for its reviewer, who alone approves. Both need `edit` on the objective first, then the policy decides, citing `writing.midCycleAs` |
| A reviewer-approval draft with no reviewer | Publishing is refused until one is named. Where reviewers are off there is nobody to approve, so the owner's publish takes it live |
| What does waiting change? | It owes no check-in: it is created without a due date, so no reminder and no staleness sweep reaches it, and its rhythm starts when it goes live. It keeps its goal's access, as a draft under "Live" does |
| How does a screen know whom to offer the step? | `goals.tree` answers `viewerId`. Publish is offered to the champion and approve to the reviewer; the write asks the policy again |
| A setting changed while drafts wait | Nothing is lost: a waiting draft still waits for its owner's publish or its reviewer's approval, as it was created to (§2.5) |

**Targets under one rule, as built at P9-T13-c-b.** `workflow.calibrate` is gone from the registry, so the API, the command line and the agents lose it together, and phase 6 states §7.6's four sentences with nothing to record; a calibration written before is still shown there, read-only. Migration 0118 dropped the one-per-cycle index; the table itself is removed one release after 0.2.0, which is not a Phase 9 task. The close reads the record the rule keeps: `sessions.scoringStatus` answers each key result's `originalTarget`, the target it began the cycle with when it has moved since, and `easedBecause`, the reason given for its last easing, and the scoring stage prints both beside the evidence.

**Annual revisions, as built at P9-T13-c-c.** An agreed frame may be revised within its year with a written reason; `frame.set` refuses one without, keeps each in `annual_frame_revisions` with which fields changed and what they held, and `frame.read` lists them. A draft frame keeps no history and a new year supersedes. Phase 0's form asks for the reason once the frame is agreed and lists the revisions beneath it. Building it found `frame.set` writing only the horizon and the agreement when it edited a frame in place, so a same-year edit to the mission or the not-doing list was answered as saved and dropped; the prose is written now. An annual key result's target already eased under §2.9's rule, so its 35 to 32 keeps its reason in the target history, and the close shows the original once P9-T20 brings the annual review to a session.

**Moving an objective between spaces, as built at P9-T13a.** `goals.moveToSpace` changes one column, `goals.space_id`, because key results, check-ins, dependencies and the parent pointer all hang from the goal and every space-scoped read, the agents' sight included, finds a goal through that column. What follows it is computed per space: OBJ-5 in both units, and both spaces' alignment scores. It needs edit on the objective and on both spaces, and moves only an objective a space owns. The card asked for the control in the list's row menu; the row has no menu, so the space sits in the row's meta line as a picker, beside the kind and the champion, as it does in the drawer's details.

**Score bands and an adjustable score, as built at P9-T14a.** §3.3's bands move to 1.0, 0.6 and 0.3 and are read by kind, in `SCORE_BAND_TEXT`: an aspirational key result on four bands, a committed one met at 1.0 and missed below. `scoreBandsIn` reads the workspace's colours: Google's are §11's bands, Doerr's are 0.7 and 0.4, and the coach's "little progress" note follows the same boundary. The quarterly review's scoring stage shows each key result's computed score, starts the slider there in hundredths so accepting it is not an adjustment by rounding, and reads each grade's band; under "Not allowed" the slider goes and a grade off the computed number is refused. Every grade already carried §8.3's one-line reason, so the close keeps `score_computed` beside `score` and the reason in `score_reason` only where they differ. A maintain key result's computed score is its share of the cycle inside its band, from its readings.

**Cycles that keep their rules, as built at P9-T14b.** The close writes `cycles.practice_snapshot`, both the practice and the thresholds resolved, in the transaction that closes the cycle. `cycleRulesInTx` is the one answer to "which rules is this cycle read under": the workspace's own while it is open, the snapshot once closed, and today's canon for a cycle closed before snapshots existed; a snapshot from an older release takes the canon for any setting added since. The quarterly review's scoring read, the archive, the new `cycles.rules` read and phase 7's band table all ask it, so moving the bands to Doerr's colours repaints the open cycle and leaves a closed one as it was graded. The scorecard joins at P9-T14c.

**The scorecard by cycle, as built at P9-T14c.** The scorecard is a table with a row per closed cycle rather than a column; each row reads its cycle's rules through `cycleRulesInTx`, shows the bands it was graded on, and colours its result by them. Beneath it, "What moved in each cycle" lists, for each cycle where anything did, each adjusted score beside its computed one with the reason, each eased target beside its original, how many objectives and key results were added mid-cycle, and each change of kind with its reason. The lists name objectives and key results, so they pass through the access model's visible set. A deleted cycle leaves the scorecard.

**A progress signal that knows the date, as built at P9-T15a.** `progressSignal` takes the pace: under "Pace-aware", the default, it compares progress with `expectedProgressPct`, the share of the cycle's days gone, green on pace, amber more than 10 points behind and red more than 25 behind; under "Absolute", or where no cycle gives a date, it reads the pass and fail thresholds as before. `paceInTx` reads the practice and today's expected progress once per review or sweep, and the monthly review's signal and the divergence sweep's both read through it, so a young quarter does not read as diverging. The trend forecast waits for "Trend forecast minimum values", four, and fits only a metric key result, in the recompute and on the goal page's sparkline alike. Two suites that test divergence and trend mechanics now choose the absolute signal, because their "red progress" is a fixed number rather than a day of the quarter.

**Health that says what happened, as built at P9-T15b-a.** Migration 0122 widens the goal's outcome and health to `abandoned`, and a stop records it, so an objective set down because it stopped mattering no longer reads as missed. "At risk" is a new term, `atRisk`, whose hole fills `common.caution`, so a workspace renames it as it renames any term. Every surface that printed the stored health code now reads `healthWord`, and the chip shows an outdated goal's last reported status beside it from the tree's new `reportedStatus`. Three specs that read the old lowercase codes moved with it.

**Divergence over a window, as built at P9-T15b-b.** `stalledWhileOnTrack` is §3.5's rule beside the two cases P4-T06b-a built: a goal reported on track whose metric key result has not moved within "Divergence window", four weeks. A key result last moved at its latest reading that differs from the one before it, the first compared with its baseline; one never measured last moved when it was written. The coach's sweep raises it as `quality.divergence` against the key result, one finding per key result, and not where the linked-work case already holds that key result.

**Alignment on ratios, as built at P9-T16a** ([`alignment.ts`](../../packages/method/src/alignment.ts), [design](p3-t00-alignment-engine.md)):

| Question | Answer |
|---|---|
| What is counted? | Goals below company level. A goal counts when it has a live parent anywhere, in this scope, another space or another cycle, or a standalone reason that is not blank. A contribution statement does not count: it names what the goal supports without pointing at it |
| How is it rounded? | Down to a whole percentage, so 89.6 reads 89 and the figure never shows a band it has not reached |
| What is "no company-level objective"? | At workspace scope, no company goal in the cycle and none that a goal in it aligns to. A quarter hung under the annual company objectives is anchored by them, because §5.1 lets it align to a longer cycle. At space scope the rule is skipped, as before |
| What happened to the other findings? | KR-1, AL-3 and AL-6 are still raised and listed, at the severities the penalties gave them, and still drive the orphan, level-skip and silo nudges. None is in the share. P9-T16b turns AL-3 and AL-6 off by default |
| A parent and a reason together? | One or the other. `goals.update` clears the reason when it sets a parent and the parent when it sets a reason, and refuses both in one call. Not a check constraint, because an importer or a relink setting a parent would then fail outright |
| A workspace that tuned the old numbers | Data change 0019 removes the stored penalties, which nothing reads. A stored healthy threshold is kept and now reads as a share |
| The screens | The figure carries "%" where it carried "/ 100", coloured by band, and the panel says how many of how many count and what the band means. The standalone reason's own control is P9-T16b's, in the drawer |

**Alignment checks at their levels, as built at P9-T16b-a.** The engine reports every finding it sees and `enforceAlignment` drops the ones whose check is off under the cycle's practice, so AL-3 and AL-6 are silent by default and their nudges with them; a stored finding from before a practice change is hidden by the read and skipped by the nudge reader, because a practice change recomputes nothing. AL-1 has METHOD v2's rows: a warn with no parent, no contribution and no reason, a warn with a contribution under "Contribution minimum" (3 words, new in §11), and a pass otherwise, so a goal that states its contribution passes AL-1 and is still left out of the share; `alignment.read` lists those as `uncounted`. AL-3 measures a skip over the levels the cycle began with (G-3). Scoring reads the cycle's own rules now, so a closed cycle keeps the thresholds and levels it closed under. Gate 3 accepts a standalone reason, which its text has said since P9-T03b. The drawer's alignment tab asks an objective with no parent why it stands alone, and the panel lists what the share did not count. Two things changed beside it: a run now collapses identical due nudges before deciding them, because a finding stored at both scopes reached its champion twice; and the demo's recovery objective records its reason to stand alone, which its contribution statement had always been.

**Escalating a dependency, as built at P9-T16b-b.** `goals.escalateDependency` copies the cycle's sponsor onto the register row with who escalated it and when (migration 0124), refused while the cycle names no active sponsor and for a dependency already confirmed. Escalated settles publish gate 4, CY-7 and AL-5 as a confirmation or a named risk owner does, and stops the unowned-dependency nudge. The sponsor's review inbox lists each one, a new `dependency` kind, until the providing team confirms or somebody is named to carry the risk; no deadline is invented for the decision, so it sits in today. **Nothing is sent to the sponsor:** a message would be a new proactive message kind, which is a human's decision, so the inbox, which the sponsor reads, carries it. The register shows "Escalated to … on …" and offers "Escalate to {sponsor}" on an unsettled entry, or says to name a sponsor first. AL-5 now warns, as METHOD v2 says.

**KPI health in its own units, as built at P9-T17a.** Migration 0125 adds `target_type` and four thresholds to `kpis`, and `last` and `first` to the aggregates; data change 0020 writes the type each existing KPI's direction implies, at or above or at or below, and a null type reads the same way meanwhile. `kpiReading` judges by the thresholds where a KPI has a complete set and by the ratio where it has none, green inclusive and red strict, and reports which basis it used; the recompute, the sweep's period states and the grid's cells all read through it, so the grid no longer works the ratio out in the browser. A recovery proposes its close on the real band where thresholds decide it. `kpis.create` and `kpis.update` take a type and thresholds, refused in words when a type cannot be judged by them, and a direction alone still picks a type for an older caller; `direction` is written beside the type for the release that reads only that. METHOD.md §6.2 moved in without its owner and tier rows, which are not built and joined P9-T17b, and §6.4 kept its recovering row and precedence until P9-T17b changes them; §6.4's sentence that the form names the fallback's limits is P9-T17b's form.

**Recovering beside the band, as built at P9-T17b-a.** The recompute writes the band and nothing else; `recovering` is read beside it wherever a KPI's recovery goal is live and open, on the grid, the detail, the board and the trees, and `kpis.launchRecovery` returns the band it leaves alone. Data change 0021 rewrites rows the previous release stored as `recovering` to the corridor band their achievement gives, which is the rule they were judged by, and readers map any residue the same way. The board lists unhealthy KPIs and every KPI under an open recovery whatever its band, so a recovery that lifted a metric into watch does not vanish from it. The detail and the board stopped quoting a projected "displayed health": the recovery's own progress sits beside the real reading. **What the product says did not change:** the corridor nudge stays silent for a KPI under an open recovery, as it was when that KPI read `recovering`, so no message is added. A tree link is formula where the parent's formula uses the child and influence otherwise, read rather than stored. METHOD.md §6.1, §6.3 and §6.4's recovering sentence moved in; §6.4's "decide a response (§6.5)" waits for P9-T18.

**The KPI form, as built at P9-T17b-b.** One client component, `JudgedBy`, asks for the target type and either a green and a red value or, for a range, the green band with a red boundary below and above; the add form and a new "How it is judged" block on the KPI page both use it, and the server turns a one-sided pair into the columns the type uses. While no thresholds are given it says what the ratio does not suit (§6.4's own sentence), and a range says it needs its band. **The owner is a new column, `owner_member_id`** (migration 0126), separate from where a KPI lives: a KPI can belong to a space and still have one named person who answers for it. That person hears the corridor nudges, and without one the old rule decides, so nothing changes for a KPI nobody names. The form names the person adding the KPI by default; the API takes any active human and refuses an agent; a KPI on a member's own list is owned by that member, and data change 0022 names the member for existing ones. Nobody is invented for the rest. **The tier is optional**: the column takes null, its default stays `output` for the release that always states one, and the API leaves it empty unless one is chosen. Nothing decides by tier, so this is a label change only. METHOD.md §6.2's owner and tier rows moved in, so §6.2 now matches v2.

**A recovery OKR that passes its own checks, as built at P9-T18a.** `draftRecovery` drafts what METHOD v2 §6.5 describes: committed; a number-free objective, "<KPI> back where the business can rely on it", with the KPI, its reading and its healthy level in the description and the why left to its owner; the KPI itself as the first key result, from its reading to `healthyBoundaryOf`, reading the KPI; then up to three drivers below their own target with an owner, breadth-first as before, so a driver at or past its target, which produced a key result going the wrong way, is skipped. "Recovery key result cap" counts the KPI. `shouldProposeRecovery` proposes at once on a fall from healthy to unhealthy in one period, and after two unhealthy periods otherwise. METHOD.md §6.5's recovery paragraphs and the two §11 rows moved in; the decision list, §6.5's new heading and §6.6 are P9-T18b's.

**Three responses, as built at P9-T18b.** An unhealthy KPI nobody has answered offers §6.5's three on its recovery board card. "Fix it now" is `tasks.create` with an owner, a date and a space, then `kpis.recordResponse`; "add a key result" is `goals.addKeyResult` on an open objective in the current cycle, reading the KPI, then the same record, or names a key result that already exists, such as a recovery's driver (NW-Q3-04); "launch a recovery OKR" is P9-T18a's draft, shown before it is launched. The work keeps every rule of its own write, so the answer is two actions rather than one; the second can only refuse what the first allowed. Migration 0127 keeps the latest answer on the KPI, and the board shows it while it is open (a task not done, an objective not closed) and offers the three again once it is not. A reader who cannot open the task or the objective is told only that there is an answer. Answering settles a pending proposed recovery for the KPI as dismissed, and the coach proposes none while an answer is open. A proposed recovery in the review inbox links to the card for the other two. `kpi.unhealthyResponse`, in the registry since P9-T01 and read by nothing, is read by the sweep now: `draftRecovery` proposes on the first unhealthy period. METHOD.md §6.4's unhealthy row, §6.5's heading and decision list, and §6.6 moved in.

**Blockers on the check-in's clock, as built at P9-T19a-a.** A blocker's next action is due by the next check-in of the goal it blocks: the goal's own `next_check_in_at`, stepped on at the goal's frequency while that falls on the opening day or earlier, so a blocker raised in the meeting that is this week's check-in is due a week later, and stored as `due_at` when it is opened. `cadence.blockerClockHours` left the registry, because the check-in is the clock and it has no number; §11's "Blocker clock" row is the first §11 row that states a rule rather than a value, and `method:check` names it as one. `cadence.blockerLadderHours` became `cadence.blockerLadderDays`, one rung: the reminder, a day before the check-in. The coordinator hears when the check-in passes with the action open. The sponsor is a rung only where "Sponsor in escalation ladders" is on, which nothing read until now, and then once the check-in after that one has passed too; v2 names the setting and not the moment, so that moment is this build's reading. The nudges, the board and the digest read one clock (`blockerClockOf`) and one ladder. Data change 0023 drops the two old keys and any hour-shaped ladder a workspace stored, and moves each open blocker's deadline to its goal's next check-in, never earlier. Migration 0128 adds "approach not working" and "other" to the blocker types. METHOD.md §7.3, its §10 coaching row and the two §11 rows moved in. REQUIREMENTS §8 still sets "under 24 hours" as the median time from a blocker to its next action; that is a success measure rather than a rule the product enforces, so it was left for a human.

**A next action for every low score, as built at P9-T19a-b.** Step 2 is "Discuss what dropped". `sessions.lowScores` lists every key result scored low in the session and every one whose confirmed confidence fell since the last session that scored it. A low one needs a next action and its owner, recorded on its `session_confidences` row (migration 0129) by `sessions.setNextAction` and due by the goal's next check-in through the same helper a blocker uses; the gate into step 3 accepts that, or an open blocker raised in the session. A key result that only dropped is listed for discussion and holds nothing. The next action is recorded and shown, and nothing nudges about it: a reminder would be a new proactive message kind, which is a human's decision. METHOD.md §7.2's step 2 moved in, except its last sentence, "A key result that falls into the low band is raised with the coordinator", which is P9-T19a-c-a's ladder; the v1 sentence about 0.3 stays until then.

**Ladders that stop at the coordinator, as built at P9-T19a-c-a.** The check-in ladder's fifth step, the sponsor at fourteen days, is reached only where "Sponsor in escalation ladders" is on; without it a goal stays at the coordinator, and v2 has the sponsor see stale goals in the weekly digest, which P9-T19a-d's digest work names. The reviewer step and the acknowledgement ladder already reached only a goal's reviewer. `confidence.critical` keeps its key and changes its condition: it fires when a confidence crosses from at or above the low boundary to below it (`confidenceFellIntoLow`), from a session against the last confidence an earlier session confirmed, or from a check-in against what its snapshot says the key result held before, so a key result drafted low that stays low is quiet. The coordinator is the goal's space's; a company objective, held by the workspace, goes to the company space's coordinator, read as the workspace's own first space, which provisioning creates named after it. At 0.3 and below the cycle's sponsor hears too, a step above, only where "Critical confidence escalation" is on, which nothing read until now. The trigger's title is now "Confidence fell into the low band". METHOD.md §3.2's table and two paragraphs, §7.2's last sentence of step 2 and the §11 check-in ladder, acknowledgement ladder and critical confidence rows moved in; §3.2's "x in 10" sentence waits for the display setting.

**A ceiling of five, as built at P9-T19a-c-b.** `cadence.nudgeCeilingPerWeek` is 5, Akmal's decision of 2 October 2026, recorded in AI-NATIVE-PLAN §12 A7. A nudge past it is still a row with the reason `ceiling` and no `sent_at`; the morning summary, `digest.daily`, lists every one held since that member's last summary, or in the last week where there was none, once per rule and subject, with the condition its rule states, the rule key and a link, and leaves out a subject the member can no longer see. `CEILING_CARRIER` in the method names that summary: it is not held by the ceiling and is not counted against it. A member who turned the morning summary off has nowhere for held messages to arrive; they are still recorded, with their reason.

**A space's own check-in frequency, as built at P9-T19a-d-a.** `spaces.settings.defaultCheckInFrequency` had been stored since P6-G18b, offered on the space card, and read by nothing. A goal holds its own frequency, as the cadence design has it, so the space's is how that frequency is chosen: a goal created in the space takes it before its first due date is stamped, and `spaces.updateSettings` moves the open goals following it, those with no frequency of their own or with the space's previous one, and stamps their next due date from today at the new one. A goal set apart keeps its own. The space card stops offering "quarterly", which the goals table cannot hold; a space already set to it leaves its goals on the workspace's frequency. "Planning-open lead" for a quarter is 4 weeks, and §2.1's quarterly row and the §11 check-in frequency and planning-open lead rows moved in.

**A streak and a booking at the team's frequency, as built at P9-T19a-d-b.** `packages/method`'s streak counts periods: `periodStartOf` gives a week from Monday, a fortnight counted from a fixed Monday (1 January 2024) so two check-ins fourteen days apart are always consecutive, a calendar month or a calendar quarter, and a space whose goals check in daily still meets weekly. `afterCheckIn` and `currentStreakOn` take the space's frequency, read again from the stored start so a space that changes frequency keeps its run where the periods line up, and `streakAtRisk` warns on the last working day of a period. `planCycleCadence` books one check-in per period, the streak's own fortnights for a space on every two weeks, and `cadenceCoverage` judges the same periods, saying fortnight(s) or month(s) where it said week(s). `ritualFrequencyOf` is the space's choice or the workspace's. The streak columns keep their names. METHOD.md §7.1's three paragraphs with their sources and §7.4's first sentences moved in; the holiday clause is P9-T19b's.

**Commitments, wins and the weekly digest, as built at P9-T19a-d-c.** Step 3 is "Commitments and wins". `sessions.closeCommitments` takes a note per commitment, kept as `commitments.closing_note`, and the form gives each commitment its own verdict, where every row's radios shared one name and so one group, which let a press answer only one. "Weekly commitment bounds" is 3 to 4. `sessions.setWins` keeps the week's wins on the session, `okr_sessions.wins` (migration 0130), refused for any ritual but a weekly check-in and once it is closed, and the stage has a card for them. The digest gains the wins, after the commitments, and the space's open goals that read outdated, after what is at risk and only when there are some; the blockers line already carried each one's next action. METHOD.md §7.1's weekly row and §7.2's steps 1, 3 and 4 moved in, so §7.2 matches v2.

**The monthly review's moves, as built at P9-T19a-d-d.** `MONTHLY_REVIEW_ITEMS` holds §7.5's five rows and the conformance suite compares both columns. `sessions.monthlyRecord` gains `stops`, the objectives in the review's space and cycle closed as abandoned, with the reason, and `updates`, the target changes made once the cycle's plan was published, with the value each replaced; starts were already there as `additions`. The screen's moves panel lists all three and stops an objective through `goals.stop`, with nothing chosen until somebody chooses. Nothing new is stored. METHOD.md §7.1's monthly row and §7.5 moved in, so §7.5 matches v2.

**Holidays, as built at P9-T19b-a.** A space marks spans, `space_holidays` (migration 0131), written whole by `spaces.setHolidays`. **One rule decides what a holiday is, and everything reads it**: a check-in period is a holiday when its last working day is inside a span, `isHolidayPeriod` in `packages/method`. The cadence engine's `clearOfHolidays` moves a due date in a holiday period on a period at a time, so the anchor weekday survives, at creation, at publication, at a rollback, for the blocker clock, and for the goals already open when a holiday is marked, which only ever move forward. The streak neither extends nor breaks across holiday periods, and a check-in held in one still counts. `streak.at_risk` is quiet in a holiday period and reads the last counted period before it. The booking and its coverage leave holiday periods out. A check-in or commitment nudge about a space on a holiday day is recorded with the suppression reason `holiday` and not sent, ahead of every reason but a switched-off rule. Days and periods differ on purpose: a team away Monday to Wednesday still owes that week's check-in, and nobody is nudged on the three days it is away. The measured on-time rate does not exist yet, so leaving holidays out of it moved to P9-T20.

**Leave, as built at P9-T19b-b.** `member_leave` (migration 0132) holds each span with a delegate, written whole by `people.setLeave` for a member's own and `people.setMemberLeave` for an administrator's: two actions, the profile's own self-versus-others split, so no write compares ids beside `can()`. `packages/method`'s `standInFor` decides who answers on a day, following a delegate who is away as well and answering nobody when the chain comes back round. The nudge run sends the check-in and acknowledgement nudges, `DELEGATED_TRIGGERS`, to the stand-in, and records every other nudge to somebody away with the reason `leave`. A check-in published while its reviewer is away is stamped with the stand-in as reviewer of record, or the reviewer when nobody stands in, so the obligation waits rather than vanishing. Roles never move. **The delegate posts with the access they already hold**: every member edits every goal under the default role, and a narrower role would need a binding the leave does not grant, which is left for a person to decide. METHOD.md §7.4 now matches v2.

**The review re-timed, as built at P9-T20a.** `sessions.quarterlyStageMinutes` is 5, 20, 12, 5, 10, 8, 8, 4, 8, 5 and 5, ninety minutes, and `sessions.quarterlyMinutes` is 90. Stage 1 was already in its own Open act in the code; METHOD.md now has the act. Stage 7's purpose reads the root-cause threshold. The booking aims at the date `cadence.reviewPreparationLeadWeeks` names before the end and books the chosen weekday in the seven days around it, so "about two weeks" is never nearly three; coverage accepts a review from the start of that week to a week after the end, so a review already booked at the close still counts. Stages 9 and 10 keep their titles until P9-T20e, which brings "defer" and the pre-filled drafts they name.

**The review and the retrospective apart, as built at P9-T20b-a.** `review.format` is read at booking: split, the planner books the review half on the review date and the retrospective two working days later, and coverage owes both; a whole review already booked counts for both halves. `okr_sessions.review_part` and `review_session_id` (migration 0133) say which half a session is and which review a retrospective reads. `reviewStageKeysFor` in `packages/method` takes each half's stages from the acts, so the split cannot drift from the stage list. Every read that crosses the boundary asks `reviewHalvesInTx` for the pair: the root causes, the diagnostic and the close decisions read the grades from the review half, and either half's minutes read stages 1 to 4 from the review and 5 to 11 from the retrospective, so they are the whole review's. The counter still reads out of eleven. The retrospective's title is "Quarterly retrospective".

**The annual review, as built at P9-T20b-b.** Booking an annual cycle books its closing review and nothing else, titled "Annual review" (or the two halves where the review is split), aimed at the week before the next year's drafting opens: §2.4's annual Phase 4 row, three weeks before the start, read from `SUGGESTED_TIMELINE` rather than written out again. Coverage counts a review from four weeks before the drafting to the day before it, and not one held after it, since drafting pressure is what §8 warns distorts the grading. The phase 6 calendar check reads the same rule for an annual cycle. The review itself is the quarterly session over the annual cycle's objectives, which it already scored by cycle.

**Scoring and root causes, as built at P9-T20c.** The scoring stage refuses to advance while a committed key result in the review's scope is below 1.0 with no explanation: graded is explained, because a grade carries its line on why, and ungraded is a miss unless §2.10's computed score says it met the promise. Root causes are asked below each key result's own kind's threshold, through `needsRootCause`, where every key result had been held to the aspirational line; `sessions.rootCauses` returns both thresholds and each row's kind, and says whether the workspace requires them. §8.4's ninth cause, "Other, described in a line", is refused without its line at the boundary and by the table, and a second cause sits in its own column, never the primary again (migration 0134). The minutes count key results below their own threshold. §8.3's third paragraph, the cycle score over aspirational key results, moves with P9-T20d, which changes the diagnostic's cycle score to match it.

**The diagnostic, measured, as built at P9-T20d.** The rhythm is `onTimeShare` in `packages/method`: each due date counts once, as on time when a check-in was published after the one before it fell due and no later than the tolerance after it, each check-in answering one period, so a late one counts for the next period and never twice. `measuredRhythmInTx` walks every objective in the review's scope, and every objective it graded wherever it sits, because a company objective belongs to no space and a review is held in one: due dates at the objective's own frequency from the cycle's start, or from the day it was started mid-cycle, holiday periods left out, and only those whose tolerance has run out. The cycle score averages the aspirational grades and the committed ones are the share met. A delivered cycle reads without a rhythm, as §8.6's first row says; below the line the verdict needs a measured share, so a review held before anything fell due cannot read one. "Diagnostic rhythm threshold" at 75% replaces the five-point key, which data change 0024 removes from stored overrides, and `review_diagnostics` keeps the share and its counts beside the survey (migration 0135). A stored diagnostic shows its sentences by its verdict, `diagnosisFor`, because one read on the survey would be misread against a share. The demo's last quarter records its weekly check-ins with their own dates through an operation of the builder's own, so its review reads the rhythm the story says the team kept. The lowest process-health statement is made an improvement action, with an owner and a date, through stage 11's `sessions.addAction`; carrying it into Phase 3 as one is §8.9's, with P9-T20e.

**Achieved and defer, as built at P9-T20e-a.** `CLOSE_DECISION_MEANINGS` in `packages/method` holds §8.8's five decisions and the line each means, and the conformance suite reads them both ways from the document. Migration 0136 widens the check on `goals.close_decision` and on `review_decisions.decision` to achieved, keep, modify, defer and abandon, so every stored value still passes. Stage 9's row proposes keep for an aspirational objective scored below 1.0 when `close.carryForward` is not `notProposed`, and shows the proposal as a chip; nothing is chosen for the room, because a decision recorded without anybody deciding it is the thing stage 9 exists to prevent. A deferred objective reaches the next cycle's issue list when the cycle is archived, as a `carry_forward` issue at `quality.carryForwardIssueImpact`, once per text, beside the open blockers that already travel that way. Keep and modify pre-filling a Phase 4 draft, and stage 10's new title, are P9-T20e-b's.

**Carrying forward, and the minutes, as built at P9-T20e-b.** METHOD.md §8 now matches v2. The feed-forward reads each objective's close decision from two places, stage 9 and the objective's own close, and **the later one is the decision**, so a room that kept an objective and an owner who then closed it as achieved have together said achieved; defer follows the same rule. `carryKeptObjectivesInTx` writes a kept or modified objective into the next cycle through `createGoalInTx`, so it gets its context and bindings like any other, then its frequency, first due date, progress, quality and the cycle's alignment. It keeps the title, description, level, kind, owner, champion and weight; it drops what belonged to the old cycle, the alignment, the contribution statement, the due dates and the capacity verdicts, which Phase 5 asks for again.

| Key result | Carried as |
|---|---|
| Metric, maintain | The same kind, baseline the last recorded value, the same target |
| Milestone not done | A milestone again |
| Milestone done | Left behind |
| Baseline not recorded | A baseline again |
| Baseline recorded | A metric from the number it found, target to set (KR-3 asks) |

`goals.carried_from_goal_id` (migration 0137) names the source, unique per cycle whether or not the draft was deleted since, so **a carried draft somebody deletes stays deleted**: deleting it is a decision about the next cycle and a re-run must not overrule it. A champion who has left means the objective is named on the closed cycle rather than carried, because the product does not choose a new owner on the room's behalf. Into a cycle already running, the draft waits for a person (§2.9) rather than going live. The closed cycle's card reports the drafts beside the issues, and calls the lowest statement Phase 3's improvement action; it is the same `cycle_priorities` row as before, ranked with the rest, and its owner and date are stage 11's. The minutes report committed key results met as a count apart from the cycle score.

**Left for a human.** Stage 10 is "Learnings" now, and still offers free-form next-cycle drafts beside the learnings, with the assist that proposes them. The method review asked only for the rename, and kept objectives now pre-fill Phase 4 on their own, so whether that panel retires or stays as a place for ideas is a product decision rather than this task's.

**METHOD.md landed, and the coach's voice, as built at P9-T21.** METHOD.md is the revised text in full: the preamble with "Defaults, not dogma" and the four levels, the terms, the twelve principles with their sources, §2.9's closing paragraph, §3's "x in 10", KR-6 as Info, §9, §10, the §11 framing with what a workspace may and may not change, the three §11 rows that now say how strongly they apply, and §13's sources. The banner is gone and `p9-t00-method-v2.md` is deleted, with every link to it repointed. Two things the document says the product does and the product did not, found while landing it:

| Found | Now |
|---|---|
| `guidance.ts` said the conformance suite compared its §9 sentences, and nothing did, so the phase rail went on telling a facilitator to refuse Phase 4 without a complete input pack | The guidance is §9's, and `pnpm method:check` compares the phases and the sentences both ways |
| §10's "what the coach says" was a table nobody read: a nudge said only its rule's name | `COACH_LINES` in `packages/method` holds the twenty lines and the rule each cites, compared both ways with §10, and a nudge for one of those rules says the line under its headline |

The P4-T00 watch list is rewritten from §10, with three rules cited differently and AL-3 and AL-6 off the default list, and AI-NATIVE-PLAN §6.4's wording follows §10. "At risk" had been the status label since P9-T15b-a; what remained of decision D6 is the terminology card offering "Owner" beside "Champion", which fills both fields and saves nothing by itself.

**Two decisions Akmal took on 7 October 2026.**

| Question | Decision | Why |
|---|---|---|
| Stage ten's free-form next-cycle drafts, left when it became "Learnings" | **Retired** (P9-T22d). The form and its assist leave the screen; the actions stay one release, deprecated, and go in 0.3 with the table | The method review found drafting in the review contradicting §8.10, the drafts reached nothing but the minutes, kept objectives now pre-fill Phase 4 on their own, and an idea has a home as a carried learning on the next cycle's issue list |
| How the demo is placed at a date of the Northwind year (G-4) | **The real clock** (P9-T22c). The year sits on the real calendar, the scenario's 1 January on this year's, and the demo shows Northwind as of today | The product reads the real clock everywhere; a demo clock would be a platform change touching every place that asks what day it is, and the database stamps its own times besides. A demo that follows the real date is consistent, needs no explanation, and moves through the year by itself with the nightly reset. The five README dates become what a visitor sees in each part of the year |

**Six questions the build raised, for a human to answer** (5 and 6 October 2026):
- **An OKR written into a set still unpublished after its window** (P9-T13-a). §2.9 says what is created before the team publication window closes is the plan; it does not say what an OKR written after it, into a set nobody has published, is. The build reads it as the plan, late, unmarked and facing the publish gates, because there is no plan yet to add to. If it should be marked instead, `isMidCycleAddition` drops its second condition.
- **"A draft its space can see"** (P9-T13-b-a). The build reads this as a floor: the draft is never private to its writer. It is not hidden from the rest of the workspace either, because the access model has no deny rule and the built-in Member role views every objective (P8-G13c). Hiding a draft from outside its space would need a narrower default role, which is the workspace's choice, not this task's.
- **The list's add row invents a target of 100** (P9-T13-b-a). P8-G12 gave a new key result a starting baseline of 0 and target of 100, so it could be saved with a title alone. A key result added that way is live at once, because KR-3 cannot tell an invented target from a real one. Leaving the target empty instead would make a list addition a draft until somebody types its target, which is what §2.9 describes, and would change five specs that record a value straight after adding. Left as it was until somebody decides.
- **A KPI-backed key result's progress** (P9-T18a). Decision D-4 makes it the KPI's achievement against the KPI's own target. A recovery's first key result is the KPI from its reading to its healthy boundary, so on the ratio fallback it reads about 90% when the KPI is healthy again rather than 100%. Changing D-4, so a KPI-backed key result progresses from its own baseline to its own target using the KPI's value, would change every such key result; the build left D-4 as it is.
- **Stopping a key result** (P9-T19a-d-d). §2.9 says every OKR can stop, "closed as abandoned with a one-line reason". The product stops an objective (`goals.stop`, P9-T13-c-a) and has no closed state for a key result alone, so a key result that no longer matters is deleted or its objective is stopped. The task's acceptance named a key result and was rewritten to an objective rather than adding a closed state for key results inside a small task. A key result stop would need its own closed column, its reason, its place in scoring and the close, and is unplanned until somebody places it.
- **Gap G-5: a dependency that knows the key result providing it** (P9-T12c-a). NW-Q1-20 wants a dependency shown as delivered once the milestone behind it is done, and the register records the providing space, not a key result. Unplanned until somebody places it.

**The gaps the Northwind year found joined the plan at P9-T01**, as Akmal agreed on 2 October 2026: G-1 is P9-T13a, G-2 joins P9-T19b, G-3 is the level picker in P9-T07a and the levels in the alignment score in P9-T16, and G-4 extends P9-T22.

The preamble and terms move at P9-T21 rather than P9-T01, because they describe committed OKRs and key result kinds, which do not exist until P9-T11 and P9-T12.

Order and dependencies: P9-T01, then P9-T02 to P9-T05 (the unblock wave), then P9-T06 to P9-T10 (writing). The model, alignment, KPI and rhythm waves follow in order. P9-T21 and P9-T22 close the phase.

## 7. Acceptance criteria for the phase

| # | Given | When | Then |
|---|---|---|---|
| A1 | A fresh workspace on the recommended profile, a cycle whose earlier phases are incomplete | A member with edit access adds an objective and a key result, from the screen, the API or the CLI | Both are created; the phase checklist shows what is missing; nothing is refused |
| A2 | The same workspace switched to the governed profile | The member tries again | The create is refused with the reason and the rule key, from every caller alike |
| A3 | An objective "Launch the new mobile app" with one key result that has a target, a date and an owner | The set is published | Publishing succeeds; OBJ-1 shows a warning with its coaching prompt |
| A4 | A workspace that sets OBJ-1 to block | The same set is published | Publishing is refused until OBJ-1 passes or an admin overrides with a recorded reason |
| A5 | A key result from 40 to a target of 100 | Its owner eases the target to 80 without a reason | Refused: "Easing a target needs a written reason". With a reason it saves, and both 100 and 80 show at the close. Raising it to 110 saves with no reason |
| A6 | A committed key result scored 1.0 at the close | The scoring reveal runs | No "too safe" note appears; a committed key result at 0.8 asks for its explanation |
| A7 | A closed cycle scored under score bands 1.0 / 0.6 / 0.3 | An admin changes the bands to Doerr's colours | The closed cycle's verdicts are unchanged; the open cycle uses the new colours |
| A8 | A workspace with reviewers off | A champion publishes a check-in | No acknowledgement is owed, and no reviewer step appears in any ladder |
| A9 | Any of the five profiles | The profile end-to-end spec runs | A member writes, the set publishes or refuses per the profile, and the cycle closes |
| A10 | `pnpm method:check` after P9-T21 | It runs | It passes against the full revised METHOD.md, and `p9-t00-method-v2.md` no longer exists |

## 8. Decisions for a person

**Decided by Akmal on 2 October 2026: all six as recommended.** D1 approves `@xyflow/react` and `@dagrejs/dagre` as runtime dependencies of `apps/web`, for P9-T09.

| # | Decision | Recommendation |
|---|---|---|
| D1 | Approve two runtime dependencies for the diagram: `@xyflow/react` (React Flow, MIT) and `@dagrejs/dagre` (MIT). CLAUDE.md requires approval for any new runtime dependency | Approve. The alternative, extending the hand-built `/goals/studio` canvas, costs about three tasks and still lacks drag-to-connect, a minimap and tested accessibility. Both are bundled at build time, so the air gap holds. See [p9-t00-okr-writing.md](p9-t00-okr-writing.md) §5 |
| D2 | Kind for a new objective when the workspace uses both | Aspirational. A committed objective is a deliberate promise, so making it the choice someone makes on purpose is the safer default |
| D3 | Existing workspaces after the upgrade | Move everyone to the recommended profile, and say so in the release notes. The only existing instances are the demo and early adopters on 0.1.2. The alternative is a "classic" profile that keeps today's locks, which preserves behaviour at the cost of keeping a sixth profile alive |
| D4 | Version | 0.2.0. Practice defaults change for every workspace, which is a minor version under PLAN.md §5.1, with the change named in the notes |
| D5 | Agung's sidebar regroup and the "Goals" to "OKRs" rename from [okr-entry-points.md](okr-entry-points.md) §3.1 | Adopt it in P9-T07a. It is the part of that proposal this design keeps; its gate stance is superseded by Akmal's decision |
| D6 | The "Champion" label | Keep the stored role, and leave the label to terminology. "Owner" is offered as the suggested alternative on the terminology card |

## 9. Risks

| Risk | Mitigation |
|---|---|
| The phase changes practice for every existing workspace | D3 and D4; release notes name every behaviour change; the governed profile restores the strict behaviour in one click |
| METHOD.md lags the code, or the code lags METHOD.md, during the phase | The banner on METHOD.md, the target file, and the per-task section map in §6. `method:check` stays green after every task |
| Settings multiply into a configuration maze | Five profiles cover the common flavours; the settings screen shows only what differs from the chosen profile, with "reset to profile" on each card |
| Loosened gates let weak OKRs through | The coach still warns on every check, and the strength score still drops. The governed profile exists for organisations that want the gates |
| The diagram is slow on large workspaces | Scoped to one cycle and one scope, collapsed beyond a node budget, measured against TECHNICAL-PLAN §13.1 in P9-T09 |
