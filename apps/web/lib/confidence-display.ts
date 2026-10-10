import { callAction, OperationError } from "@openokr/core";
import { defaultPractice, type ResolvedPractice } from "@openokr/method";
import type { ConfidenceDisplay } from "@openokr/ui";
import { cache } from "react";
import { getPool } from "./pool";
import { requireWorkspace } from "./workspace";

/**
 * How this workspace shows a confidence, read once per request: the
 * practice setting "Confidence shown as" (METHOD.md §12, guided-inputs §4.8),
 * "x in 10" unless somebody changed it.
 *
 * For a server component that draws confidence and is not handed the
 * practice by its page. A guest reads the default, as `rhythm.ts` gives a
 * guest the canon's numbers: `practice.read` answers them not-found.
 */
export const confidenceDisplay = cache(async (): Promise<ConfidenceDisplay> => {
  const { session, workspace } = await requireWorkspace();
  try {
    const read = await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human" as const, userId: session.user.id },
      },
      "practice.read",
      {},
    );
    return (read.practice as unknown as ResolvedPractice)["confidence.display"];
  } catch (error) {
    if (error instanceof OperationError && error.code === "not_found") {
      return defaultPractice()["confidence.display"];
    }
    throw error;
  }
});
