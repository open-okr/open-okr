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
