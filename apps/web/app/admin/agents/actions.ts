"use server";

import { createAIProvider } from "@openokr/adapters";
import { createProviderDrafter } from "@openokr/agents";
import { loadEnv } from "@openokr/config";
import {
  type AgentDrafter,
  callAction,
  findSeededModel,
  resolveAICredential,
  resolveTierRoute,
} from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/auth";
import { getKeyRing } from "../../../lib/secrets";
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

/**
 * §4.14's per-run spend cap for this workspace.
 *
 * Zero is a real answer and means the agent may not spend, which the run itself
 * also enforces before it starts. Read here as well so a drafter cannot keep
 * calling after the budget is gone inside a single run.
 */
async function runCostCapFor(
  pool: ReturnType<typeof getPool>,
  workspaceId: string,
): Promise<number> {
  const { rows } = await pool.query<{ cap: number | null }>(
    "select (settings->>'agentRunCostCapUsd')::numeric as cap from workspaces where id = $1",
    [workspaceId],
  );
  const stored = rows[0]?.cap;
  return stored === null || stored === undefined ? 2 : Number(stored);
}

/** The drafter for this workspace, or nothing when the provider is off. */
async function drafterFor(workspaceId: string): Promise<AgentDrafter | null> {
  const pool = getPool();
  // The application's own ring rather than one built here, so a credential
  // sealed by any other surface opens with the same key.
  const ring = getKeyRing();
  const costCapUsd = await runCostCapFor(pool, workspaceId);
  const resolved = await resolveAICredential(pool, ring, process.env, {
    workspaceId,
    provider: "openrouter",
  });
  if (resolved.source === "off") {
    return null;
  }

  // `balanced` rather than `fast`: a check-in somebody publishes under their
  // own name is worth a better model than the cheapest one, and the run cap
  // bounds what that can cost.
  const route = await resolveTierRoute(pool, { workspaceId, tier: "balanced" });
  if (!route) {
    return null;
  }
  // Prices come from the catalogue rather than from the route, because a
  // workspace may point a tier at a model the seed list prices and the policy
  // does not. An unpriced model meters as zero, which would make the cap
  // meaningless, so it is refused instead.
  const priced = findSeededModel(route.provider, route.modelId);
  if (!priced) {
    return null;
  }

  return createProviderDrafter({
    provider: createAIProvider({
      provider: "openrouter",
      apiKey: resolved.apiKey,
      appName: "OpenOKR",
      appUrl: loadEnv().BETTER_AUTH_URL,
    }),
    model: route.modelId,
    // §4.14's `agentRunCostCapUsd`, read from the workspace rather than from a
    // constant, so a workspace that lowered it stops the drafter mid-run
    // rather than only being refused at the door.
    costCapUsd,
    costInPerMillion: priced.costInPerMillion,
    costOutPerMillion: priced.costOutPerMillion,
  });
}

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
