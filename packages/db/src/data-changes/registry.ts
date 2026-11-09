/**
 * Every registered data-change script, in the order `pnpm db:change` runs
 * them (P2-T12). One list for the runner and for its status mode, so the two
 * cannot disagree about what is registered (plan 0.7.0 P9).
 *
 * `encryptionKey` is read straight from the environment by the caller, as
 * `keys:rotate` reads it: the schema `loadEnv` checks has no root key, because
 * the web process resolves its own ring. Absent is fine until there is a
 * token to seal.
 */
import type { DataChangeScript } from "../data-change.ts";
import { backfillMemberTimezone } from "./0001_backfill_member_timezone.ts";
import { backfillWorkspaceStandardBinding } from "./0002_backfill_workspace_standard_binding.ts";
import { backfillDefaultSpace } from "./0003_backfill_default_space.ts";
import { backfillRhythmAndCycle } from "./0004_backfill_rhythm_and_cycle.ts";
import { backfillCheckInReviewer } from "./0005_backfill_check_in_reviewer.ts";
import { seedChampionAgent } from "./0006_seed_champion_agent.ts";
import { seedCoachAgent } from "./0007_seed_coach_agent.ts";
import { backfillBlockerGoal } from "./0008_backfill_blocker_goal.ts";
import { bindAgentsToSpacelessItems } from "./0009_bind_agents_to_spaceless_items.ts";
import { scrubErasedMemberNames } from "./0010_scrub_erased_member_names.ts";
import { sealAccountTokens } from "./0011_seal_account_tokens.ts";
import { backfillWorkspaceRoles } from "./0012_backfill_workspace_roles.ts";
import { dropSpaceEditOnGoals } from "./0013_drop_space_edit_on_goals.ts";
import { carryStrategicIssueMinimum } from "./0014_carry_strategic_issue_minimum.ts";
import { carryObjectiveLengthLimit } from "./0015_carry_objective_length_limit.ts";
import { carryCoachStrictness } from "./0016_carry_coach_strictness.ts";
import { keyResultKindFromDirection } from "./0017_key_result_kind_from_direction.ts";
import { keyResultScoreComputed } from "./0018_key_result_score_computed.ts";
import { dropAlignmentPenalties } from "./0019_drop_alignment_penalties.ts";
import { kpiTargetTypeFromDirection } from "./0020_kpi_target_type_from_direction.ts";
import { kpiRecoveringToBand } from "./0021_kpi_recovering_to_band.ts";
import { kpiNamedOwner } from "./0022_kpi_named_owner.ts";
import { blockerClockToCheckIn } from "./0023_blocker_clock_to_check_in.ts";
import { retireRhythmScoreThreshold } from "./0024_retire_rhythm_score_threshold.ts";
import { verifyFirstAccount } from "./0025_verify_first_account.ts";
import { kpiCorridorFollowsWorkspace } from "./0026_kpi_corridor_follows_workspace.ts";
import { sessionShiftsDocument } from "./0027_session_shifts_document.ts";
import { decisionTextDocument } from "./0028_decision_text_document.ts";
import { managementAnswerDocument } from "./0029_management_answer_document.ts";
import { stageNoteDocuments } from "./0030_stage_note_documents.ts";
import { digestNoteDocument } from "./0031_digest_note_document.ts";
import { revalidationNoteDocuments } from "./0032_revalidation_note_documents.ts";
import { attachmentRowsFromText } from "./0033_attachment_rows_from_text.ts";

export function registeredDataChanges(
  encryptionKey: string | undefined,
): readonly DataChangeScript[] {
  return [
    backfillMemberTimezone,
    backfillWorkspaceStandardBinding,
    backfillDefaultSpace,
    backfillRhythmAndCycle,
    backfillCheckInReviewer,
    seedChampionAgent,
    seedCoachAgent,
    backfillBlockerGoal,
    bindAgentsToSpacelessItems,
    scrubErasedMemberNames,
    // The one script that needs the root key; see above.
    sealAccountTokens(encryptionKey),
    backfillWorkspaceRoles,
    // After 0012, never before it: 0012 is what gives everybody the role
    // that replaces the binding this removes.
    dropSpaceEditOnGoals,
    // Phase 9's three, numbered after main's 0013 when main was merged in
    // on 5 October 2026: the ledger keys a script by its whole name, and
    // 0013 had already run on instances built from main.
    carryStrategicIssueMinimum,
    carryObjectiveLengthLimit,
    carryCoachStrictness,
    keyResultKindFromDirection,
    keyResultScoreComputed,
    dropAlignmentPenalties,
    kpiTargetTypeFromDirection,
    kpiRecoveringToBand,
    kpiNamedOwner,
    blockerClockToCheckIn,
    retireRhythmScoreThreshold,
    verifyFirstAccount,
    kpiCorridorFollowsWorkspace,
    // Guided inputs change 11a: the monthly review's prose as documents.
    sessionShiftsDocument,
    decisionTextDocument,
    // Change 11b: the quarterly review's prose as documents.
    managementAnswerDocument,
    stageNoteDocuments,
    // Change 11c: the weekly coordinator note as a document.
    digestNoteDocument,
    // Change 12: the quarterly revalidation's two notes as documents.
    revalidationNoteDocuments,
    // 0.7.0 R2: attachment rows for files already in comment and document
    // text, after migration 0155 (rich-text-editor.md §11, Q1).
    attachmentRowsFromText,
  ];
}
