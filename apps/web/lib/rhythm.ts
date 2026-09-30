import { callAction, OperationError } from "@openokr/core";
import { canonThresholds, resolveTerminology } from "@openokr/method";
import { cache } from "react";
import { getPool } from "./pool";
import { requireWorkspace } from "./workspace";

/**
 * This workspace's rhythm settings, read once per request.
 *
 * Two things on almost every screen come from it: the progress ceiling a bar
 * is drawn against (`ceilings.ts`) and the workspace's own words for the
 * method's terms (`workspace-presentation.ts`, M-14). `cache` is React's
 * per-render memo, so both pay for one `rhythm.read` between them.
 *
 * `rhythm.read` is declared `view`, which matters: an ordinary member opens
 * every screen that reads it, and an admin read here would lock them out of
 * them exactly as P8-G05 found.
 */
/** The two fields every caller reads, typed as the contract hands them over. */
export interface RhythmPresentation {
  readonly thresholds: unknown;
  readonly terminology: unknown;
}

export const readRhythmForRequest = cache(
  async (): Promise<RhythmPresentation> => {
    const { session, workspace } = await requireWorkspace();
    try {
      const read = await callAction(
        {
          pool: getPool(),
          workspaceId: workspace.workspaceId,
          actor: { kind: "human" as const, userId: session.user.id },
        },
        "rhythm.read",
        {},
      );
      return { thresholds: read.thresholds, terminology: read.terminology };
    } catch (error) {
      // **A guest reads the canon's numbers and words** (completeness review
      // L-23). A guest holds nothing on the workspace itself (M-22), so
      // `rhythm.read` answers not-found, and the goals on their own space
      // page failed to draw. The root layout already fell back to the
      // canon's terms for them; the bars and the Work Map's row chips now do
      // the same, rather than showing "We could not load".
      if (error instanceof OperationError && error.code === "not_found") {
        return {
          thresholds: canonThresholds(),
          terminology: resolveTerminology(),
        };
      }
      throw error;
    }
  },
);
