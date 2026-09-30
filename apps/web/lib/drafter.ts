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
import { createProviderDrafter } from "@openokr/agents";
import { type AgentDrafter, resolveAgentRunCostCap } from "@openokr/core";
import type { ModelTier } from "@openokr/db";
import { providerForTier } from "./ai-provider";
import { getPool } from "./auth";

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
  // **Through core, and inside the tenant setting, since the audit of
  // 18 September 2026.** This read ran on a bare pool against a table that
  // carries `tenant_isolation`, so it matched nothing on every instance and
  // the fallback took over: `agentRunCostCapUsd` did nothing whatever an
  // administrator set. It lives in core now for the second half of the same
  // reason, which is that this app has no Drizzle and should not write SQL.
  return resolveAgentRunCostCap(pool, workspaceId);
}

/**
 * The drafter for this workspace, or nothing when the provider is off.
 *
 * `tier` is `balanced` unless a caller names another. AI-NATIVE-PLAN §3.4
 * gives decomposition the `deep` tier (completeness review M-09), and a
 * feature names a tier rather than a model, so the one assist that asks for
 * more says so here and every other caller is unchanged.
 */
export async function drafterFor(
  workspaceId: string,
  tier: ModelTier = "balanced",
): Promise<AgentDrafter | null> {
  const pool = getPool();
  const costCapUsd = await runCostCapFor(pool, workspaceId);

  // `balanced` by default rather than `fast`: a check-in somebody publishes
  // under their own name is worth a better model than the cheapest one, and
  // the run cap bounds what that can cost. Whichever provider the workspace
  // routes that tier to, not OpenRouter always (completeness review H-27).
  const routed = await providerForTier(workspaceId, tier);
  if (!routed) {
    return null;
  }
  // A workspace whose egress controls let nothing reach this provider has no
  // drafter, exactly as one with no provider has none (M-10): its assists are
  // hidden and its agents run in their deterministic form, rather than
  // offering buttons the guard would refuse every time. `assist` is the
  // narrowest purpose, so nothing is permitted when it is not.
  if (!routed.provider.permits("assist")) {
    return null;
  }

  return createProviderDrafter({
    provider: routed.provider,
    model: routed.modelId,
    // §4.14's `agentRunCostCapUsd`, read from the workspace rather than from a
    // constant, so a workspace that lowered it stops the drafter mid-run
    // rather than only being refused at the door.
    costCapUsd,
    costInPerMillion: routed.costInPerMillion,
    costOutPerMillion: routed.costOutPerMillion,
  });
}
