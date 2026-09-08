"use server";

/**
 * Turning a §6.4 rule down, and holding the whole workspace quiet (P6-G21).
 *
 * **The table had every column and no caller.** `nudge_rules` has held
 * `enabled`, `channel_override`, `escalation_ladder` and `quiet_mode_exempt`
 * since P4-T04b, and `rhythm_settings.quiet_mode` since the same task. The
 * suppression decision has read the first, the fourth and the workspace flag
 * all along, so a workspace being drowned by its own product had the switches
 * and no handles. That is what the gap audit recorded as G-04.
 */

import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/pool";
import { requireWorkspace } from "../../../lib/workspace";

async function context() {
  const { session, workspace } = await requireWorkspace();
  return {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
}

export interface RuleResult {
  readonly error: string | null;
  readonly saved: boolean;
}

export async function setNudgeRuleAction(input: {
  ruleKey: string;
  enabled?: boolean;
  channelOverride?:
    | "app"
    | "email"
    | "slack"
    | "teams"
    | "whatsapp"
    | "telegram"
    | null;
  quietModeExempt?: boolean;
}): Promise<RuleResult> {
  try {
    await callAction(await context(), "nudges.setRule", input);
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message, saved: false };
    }
    throw error;
  }
  revalidatePath("/admin/nudges");
  return { error: null, saved: true };
}

/**
 * Workspace quiet mode (P6-G21).
 *
 * §6.3 puts escalations through it unconditionally, and a rule marked exempt
 * goes through too. Everything else waits, which is the point: this is the
 * switch for a launch week, not a way to turn the practice off.
 */
export async function setQuietModeAction(
  quietMode: boolean,
): Promise<RuleResult> {
  try {
    await callAction(await context(), "rhythm.update", { quietMode });
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message, saved: false };
    }
    throw error;
  }
  revalidatePath("/admin/nudges");
  return { error: null, saved: true };
}
