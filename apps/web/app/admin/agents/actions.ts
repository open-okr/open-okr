"use server";

import { callAction } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/auth";
import { drafterFor } from "../../../lib/drafter";
import { requireWorkspace } from "../../../lib/workspace";

/**
 * Running an agent by hand (P4-T05c-b).
 *
 * **This is the only caller of the drafter, and it exists because nothing else
 * calls the agents at all.** `registerAgentSchedules` declares four crons and
 * this repository has no worker to execute them, so until one exists an
 * administrator asking for a run is how an agent ever speaks. The dead-code
 * gate found the drafter unreachable, which was correct: an implementation with
 * no host is a capability the product does not have.
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
