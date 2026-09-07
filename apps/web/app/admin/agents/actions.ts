"use server";

import { callAction } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/auth";
import { drafterFor } from "../../../lib/drafter";
import { requireWorkspace } from "../../../lib/workspace";

/**
 * Running an agent by hand (P4-T05c-b).
 *
 * **This was the only caller of the drafter, and it existed because nothing
 * else called the agents at all.** `registerAgentSchedules` declared four crons
 * from P4-T05a and this repository had no worker to execute them, so an
 * administrator asking for a run was the only way an agent ever spoke. The
 * dead-code gate found the drafter unreachable, which was correct: an
 * implementation with no host is a capability the product does not have.
 *
 * `apps/web/lib/scheduler.ts` is that host now (P6-G01a), and it calls the same
 * two actions on the same cadences §6.1 and §6.2 declare. This stays, because
 * an administrator who wants a run before the next hour should have one, and
 * because an instance running with `OPENOKR_SCHEDULER=off` has nothing else.
 *
 * The host is where the provider is built, and that is the boundary rule rather
 * than a convenience. `packages/core` declares `AgentDrafter` and may not import
 * a driver; `packages/adapters` holds every driver; `packages/agents` joins
 * them. This file, in the application, is what supplies the finished thing to
 * an action call.
 */

export async function runChampionAction(
  cadence: "hourly" | "daily" | "weekly" | "cycle",
) {
  const { session, workspace } = await requireWorkspace();
  const drafter = await drafterFor(workspace.workspaceId);
  await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
      ...(drafter ? { drafter } : {}),
    },
    "agents.runChampion",
    { cadence },
  );
  revalidatePath("/admin/agents");
}

export async function runCoachAction() {
  const { session, workspace } = await requireWorkspace();
  const drafter = await drafterFor(workspace.workspaceId);
  await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
      ...(drafter ? { drafter } : {}),
    },
    "agents.runCoach",
    {},
  );
  revalidatePath("/admin/agents");
}

/**
 * Turning an agent on or off (P6-G13a).
 *
 * **The control CLAUDE.md's least-privilege rule assumes exists.** `setEnabled`
 * shipped at P2-T17 with no caller, so an agent that was saying the wrong thing
 * could only be silenced from the command line. Disabling is the answer to a
 * noisy agent that does not also throw away its bindings, which is what
 * deleting it would do.
 */
export async function setAgentEnabledAction(
  id: string,
  enabled: boolean,
): Promise<void> {
  const { session, workspace } = await requireWorkspace();
  await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "agents.setEnabled",
    { id, enabled },
  );
  revalidatePath("/admin/agents");
}

/**
 * Stopping a run that is still going (P6-G13a).
 *
 * A halt is not a failure and the run log already says so: the Champion's cost
 * cap cancels a run rather than failing it. This is the same state reached on
 * purpose, and an administrator watching an agent work through a list it should
 * not have started needs it.
 */
export async function cancelRunAction(id: string): Promise<void> {
  const { session, workspace } = await requireWorkspace();
  await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "agents.cancelRun",
    { id },
  );
  revalidatePath("/admin/agents");
}

/**
 * Applying or dismissing proposals (P6-G13a).
 *
 * **This is the missing half of a hard rule.** CLAUDE.md: "Propose by default.
 * Agents produce proposals into the review queue." The queue had no screen, so
 * `proposals.list`, `bulkApply` and `bulkDismiss` all shipped at P2-T17 with no
 * caller and a proposal could be created and never seen by anybody.
 *
 * Bulk by design, and the answer is per proposal. `bulkApply` reports what
 * applied and what refused, each with its reason, because applying ten
 * proposals where the third is stale must not abandon the other nine.
 */
export async function applyProposalsAction(ids: readonly string[]): Promise<{
  applied: number;
  failed: readonly { id: string; error: string }[];
}> {
  const { session, workspace } = await requireWorkspace();
  const result = await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "proposals.bulkApply",
    { ids: [...ids] },
  );
  revalidatePath("/admin/agents");
  return { applied: result.applied.length, failed: result.failed };
}

export async function dismissProposalsAction(
  ids: readonly string[],
): Promise<{ dismissed: number }> {
  const { session, workspace } = await requireWorkspace();
  const result = await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "proposals.bulkDismiss",
    { ids: [...ids] },
  );
  revalidatePath("/admin/agents");
  return { dismissed: result.dismissed.length };
}
