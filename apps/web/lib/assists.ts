/**
 * Whether an assist is offered, and the context one runs in (completeness
 * review M-09).
 *
 * **Six assists were built and nothing in the browser called them**, and the
 * screens that did call an assist each asked "is there a drafter?" in its own
 * words. This is the one question, asked the same way everywhere:
 *
 * - a drafter exists, which already means a provider is configured for the
 *   tier and the workspace's egress controls let an assist reach it (M-10);
 * - and this assist's own switch on the AI console is on, and no budget that
 *   applies to it is spent.
 *
 * Either answer "no" and the affordance is not drawn at all, which is
 * UIUX-PLAN §3's "no dead buttons". The action refuses on its own whatever
 * this says, so hiding the button is a courtesy and not the control.
 */
import { checkFeatureAvailability } from "@openokr/core";
import type { ModelTier } from "@openokr/db";
import { getPool } from "./auth";
import { drafterFor } from "./drafter";
import { requireWorkspace } from "./workspace";

/**
 * Whether this assist would run for this reader right now.
 *
 * `forUser` is the reader, because their own key can be what makes it run on
 * a workspace that holds none (completeness review M-36).
 */
export async function assistOffered(
  workspaceId: string,
  featureKey: string,
  tier: ModelTier = "balanced",
  forUser?: string,
): Promise<boolean> {
  if ((await drafterFor(workspaceId, tier, forUser)) === null) {
    return false;
  }
  const availability = await checkFeatureAvailability(getPool(), {
    workspaceId,
    featureKey,
    defaultTier: tier,
  });
  return availability.available;
}

/**
 * The reader, and the drafter when there is one.
 *
 * Absent drafter means the provider is off or withheld, and every assist
 * action then answers null: the caller shows its ordinary surface.
 */
export async function assistContext(tier: ModelTier = "balanced") {
  const { session, workspace } = await requireWorkspace();
  const base = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  // The reader's own key where they stored one (M-36).
  const drafter = await drafterFor(
    workspace.workspaceId,
    tier,
    session.user.id,
  );
  return drafter ? { ...base, drafter } : base;
}
