# P9-T00: Adaptable practice

The design gate for Phase 9. Written on 1 October 2026 for Akmal and Agung to approve with "design approved" before any Phase 9 code.

| | |
|---|---|
| Asked for by | Akmal, 1 October 2026: "the 'open okr' need to be robust and allow different flavor of OKR implementation … many hard lock need to be remove and instead make it adjustable in the admin setting" |
| Rests on | [METHOD-REVIEW.md](../METHOD-REVIEW.md), the review of every METHOD.md rule against public OKR practice |
| Approved practice text | [p9-t00-method-v2.md](p9-t00-method-v2.md), the revised METHOD.md |
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
| `goals` | `added_mid_cycle_at timestamptz`, `standalone_reason text`, `draft_state goal_draft_state` (`draft`, `awaiting_approval`; null means it follows its cycle) | None |
| `goals` | `reviewer_id` drops `not null` | None |
| `key_results` | `kind key_result_kind not null default 'metric'` (`metric`, `maintain`, `milestone`, `baseline`), `done_at timestamptz` | `maintain` where `direction = 'maintain'` |
| `key_results` | `score_computed numeric`, `score_reason text` | `score_computed = score` where scored |
| New `key_result_target_changes` | `workspace_id`, `key_result_id`, `from_value`, `to_value`, `reason`, `actor`, `changed_at`, `mid_cycle` | None |
| `cycles` | `practice_snapshot jsonb` | Closed cycles get today's canon |
| `cycles` | `company_published_at timestamptz`, the first publish step (METHOD v2 §4.5, migration 0110). **Changed at P9-T03b** from a `teams_published_at` for the second step: `published_at` keeps meaning "the whole set is out" for every reader that relies on it, so a cycle published before the release needs no backfill | None |
| New `space_holidays` | `workspace_id`, `space_id`, `starts_on`, `ends_on`, `note` | None |
| New `member_leave` (G-2) | `workspace_id`, `member_id`, `starts_on`, `ends_on`, `delegate_member_id` | None |
| Root-cause enum | add `other`; sessions gain `secondary_root_cause` | None |
| Blocker-type enum | add `approach`, `other` | None |
| Close-decision enum | add `achieved`, `defer` | None |
| `kpis` | `target_type`, `green_value`, `red_value`, `band_low`, `band_high`; aggregate enum adds `last`, `first` | `target_type` from `direction` |
| `cycle_calibrations` | Stop writing in this release. The unique one-per-cycle index is dropped. The table is removed one release later | None |

DATABASE.md and the TECHNICAL-PLAN.md §7.2 importer mapping change in the same task as each migration. For FlowyTeam, its key result `metric_type` maps cleanly: `boolean` and `milestone` become milestone, and everything else becomes metric.

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

Each task copies the named sections of [p9-t00-method-v2.md](p9-t00-method-v2.md) into METHOD.md, with the code that makes `pnpm method:check` agree. The 67 differences the check reports today are all assigned below. Full task text is in IMPLEMENTATION-PLAN.md, Phase 9.

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
| P9-T11b | The kind in the product | None of its own | None |
| P9-T12 | Kinds of key result | §2.10, §3.1, §4.2's opening, KR-2, KR-3 and KR-7 | KR-2 condition table |
| P9-T13 | Changing OKRs mid-cycle: the added-mid-cycle mark, live or draft creation, stop with a reason, annual revisions, calibration retired. Builds on the target history and reason rule P9-T06 introduces | §2.1, §2.9 (the four moves, live or draft, changing a target), §7.6 | The four calibration sentences |
| P9-T13a | Moving an objective to another space (G-1) | §2.9's "When the organisation changes" | None (behaviour) |
| P9-T14 | Adjustable scores and cycles that keep their rules | §3.3, §12 snapshot paragraph | Score band values |
| P9-T15 | A progress signal that knows the date | §3.5, §3.6, §3.7 | "Progress signal pace gaps", "Trend forecast minimum values", "Divergence window" |
| P9-T16 | Alignment on ratios, over the levels in use (G-3) | §4.3, §5 | "Contribution minimum", "Alignment watch threshold"; retire "Alignment penalties" |
| P9-T17 | KPI target types and their own thresholds | §6.1 to §6.4, §6.7 | None (behaviour) |
| P9-T18 | Responding to an unhealthy KPI | §6.5, §6.6 | Recovery proposal delay value |
| P9-T19a | Calmer escalation and cadence | §7.1, §7.2, §7.3, §7.5, the §11 cadence group | Blocker taxonomy and definitions; rituals; weekly steps; "Planning-open lead" for a quarter, 3 to 4 weeks |
| P9-T19b | Holidays, leave, and a rhythm that follows them | §7.4, holidays and leave (G-2) | None (behaviour) |
| P9-T20 | The quarterly review, re-timed, and the annual review | §8 | Review stages and purposes; root causes; close decisions and meanings; rhythm diagnostic; "Diagnostic rhythm threshold"; retire "Diagnostic rhythm-score threshold" |
| P9-T21 | The coach's voice, and METHOD.md fully landed | The preamble and terms, §1, §9, §10, §11 framing, §13 | Trigger catalogue (AI-NATIVE-PLAN.md §6.4) and the P4-T00 coach watch list; deletes `p9-t00-method-v2.md` and METHOD.md's banner |
| P9-T22 | Release 0.2.0 and the demo story, placeable at any date of the Northwind year (G-4) | none | None |

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
