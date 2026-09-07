/**
 * The workspace's AI drafter, built once and shared (P4-T06c).
 *
 * Two surfaces need one: the admin run controls and the goal page's rewrite
 * assist. Sharing it means a workspace resolves one provider, one model and one
 * cap wherever an agent speaks, rather than two copies that can disagree about
 * which model is "balanced".
 *
 * The host is where the provider is built, and that is the boundary rule rather
 * than a convenience. `packages/core` declares `AgentDrafter` and may not import
 * a driver; `packages/adapters` holds every driver; `packages/agents` joins
 * them. This file, in the application, supplies the finished thing.
 *
 * Null means the provider is off, which is the normal case and a complete
 * product: every trigger, ladder, gate and corridor works without it.
 */
import { createAIProvider } from "@openokr/adapters";
import { createProviderDrafter } from "@openokr/agents";
import { loadEnv } from "@openokr/config";
import {
  type AgentDrafter,
  findSeededModel,
  resolveAICredential,
  resolveTierRoute,
} from "@openokr/core";
import { getPool } from "./auth";
import { getKeyRing } from "./secrets";

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
export async function drafterFor(
  workspaceId: string,
): Promise<AgentDrafter | null> {
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
