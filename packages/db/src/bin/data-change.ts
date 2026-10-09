#!/usr/bin/env node
/**
 * `pnpm db:change`: runs every registered data-change script, batched and
 * resumable, skipping any already complete.
 *
 * Connects with DATABASE_ADMIN_URL when set, the same fallback `migrate.ts`
 * uses — the owner role, which owns the tables, with DATABASE_URL as the
 * single-role local fallback.
 */
import { loadEnv } from "@openokr/config";
import pg from "pg";
import { runDataChanges } from "../data-change.ts";
import { backfillMemberTimezone } from "../data-changes/0001_backfill_member_timezone.ts";
import { backfillWorkspaceStandardBinding } from "../data-changes/0002_backfill_workspace_standard_binding.ts";
import { backfillDefaultSpace } from "../data-changes/0003_backfill_default_space.ts";
import { backfillRhythmAndCycle } from "../data-changes/0004_backfill_rhythm_and_cycle.ts";
import { backfillCheckInReviewer } from "../data-changes/0005_backfill_check_in_reviewer.ts";
import { seedChampionAgent } from "../data-changes/0006_seed_champion_agent.ts";
import { seedCoachAgent } from "../data-changes/0007_seed_coach_agent.ts";
import { backfillBlockerGoal } from "../data-changes/0008_backfill_blocker_goal.ts";
import { bindAgentsToSpacelessItems } from "../data-changes/0009_bind_agents_to_spaceless_items.ts";
import { scrubErasedMemberNames } from "../data-changes/0010_scrub_erased_member_names.ts";
import { sealAccountTokens } from "../data-changes/0011_seal_account_tokens.ts";
import { backfillWorkspaceRoles } from "../data-changes/0012_backfill_workspace_roles.ts";
import { dropSpaceEditOnGoals } from "../data-changes/0013_drop_space_edit_on_goals.ts";
import { carryStrategicIssueMinimum } from "../data-changes/0014_carry_strategic_issue_minimum.ts";
import { carryObjectiveLengthLimit } from "../data-changes/0015_carry_objective_length_limit.ts";
import { carryCoachStrictness } from "../data-changes/0016_carry_coach_strictness.ts";
import { keyResultKindFromDirection } from "../data-changes/0017_key_result_kind_from_direction.ts";
import { keyResultScoreComputed } from "../data-changes/0018_key_result_score_computed.ts";
import { dropAlignmentPenalties } from "../data-changes/0019_drop_alignment_penalties.ts";
import { kpiTargetTypeFromDirection } from "../data-changes/0020_kpi_target_type_from_direction.ts";
import { kpiRecoveringToBand } from "../data-changes/0021_kpi_recovering_to_band.ts";
import { kpiNamedOwner } from "../data-changes/0022_kpi_named_owner.ts";
import { blockerClockToCheckIn } from "../data-changes/0023_blocker_clock_to_check_in.ts";
import { retireRhythmScoreThreshold } from "../data-changes/0024_retire_rhythm_score_threshold.ts";
import { verifyFirstAccount } from "../data-changes/0025_verify_first_account.ts";

const env = loadEnv();
const url = env.DATABASE_ADMIN_URL ?? env.DATABASE_URL;

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const outcomes = await runDataChanges(client, {
    scripts: [
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
      // Read straight from the environment, as `keys:rotate` reads it: the
      // schema `loadEnv` checks has no root key, because the web process
      // resolves its own ring. Absent is fine until there is a token to seal.
      sealAccountTokens(process.env.OPENOKR_ENCRYPTION_KEY),
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
    ],
  });
  process.stdout.write(
    outcomes.length === 0
      ? "Nothing to run. Every registered script is already complete.\n"
      : `Ran ${outcomes.length} script(s):\n${outcomes
          .map(
            (outcome) =>
              `  ${outcome.name}: ${outcome.batches} batch(es), ${outcome.rowsChanged} row(s) changed`,
          )
          .join("\n")}\n`,
  );
} finally {
  await client.end();
}
