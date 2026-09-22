import { callAction } from "@openokr/core";
import type { ResolvedThresholds } from "@openokr/method";
import { cache } from "react";
import { getPool } from "./auth";
import { requireWorkspace } from "./workspace";

/**
 * The maxima a progress or achievement bar is drawn against (P8-G04).
 *
 * **A bar without one lies twice.** It fills its whole track at a value below
 * the real maximum, and it tells a screen reader through `aria-valuemax` that
 * the track is the most there is, while the figure printed beside it says
 * otherwise. Both were true here: a goal at 150% under a raised ceiling, and a
 * KPI at 180 on every KPI screen since Phase 5.
 *
 * **Resolved once per request.** `cache` is React's per-render memo, so six
 * screens asking for the same number in one render pay for one read. Without
 * it this would be six `rhythm.read` calls on a page that already makes
 * several.
 */

/**
 * The §6.4 achievement ceiling, which is a constant rather than a setting.
 *
 * `packages/method`'s KPI module fixes it at 200 and says why: `lower_better`
 * with an actual of zero divides by zero, so the function needs a ceiling to
 * stay total, and applying the same one to both directions keeps them
 * symmetrical. It is not in the §11 registry, so there is nothing to read.
 */
export const KPI_ACHIEVEMENT_MAX = 200;

/**
 * This workspace's progress ceiling, METHOD.md §11's
 * `scoring.progressCeilingPct`. 100 unless the workspace raised it.
 *
 * `rhythm.read` is declared `view`, which matters: an ordinary member opens
 * every screen that draws a progress bar, and reaching for an admin read here
 * would lock them out of it exactly as P8-G05 did.
 */
export const progressCeiling = cache(async (): Promise<number> => {
  const { session, workspace } = await requireWorkspace();
  const read = await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human" as const, userId: session.user.id },
    },
    "rhythm.read",
    {},
  );
  // `rhythm.read` types its thresholds as an open record at the contract
  // boundary, the same cast the cycle page already makes for the same reason.
  const thresholds = read.thresholds as unknown as ResolvedThresholds;
  return thresholds["scoring.progressCeilingPct"];
});
