import { callAction } from "@openokr/core";
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
export const readRhythmForRequest = cache(async () => {
  const { session, workspace } = await requireWorkspace();
  return callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human" as const, userId: session.user.id },
    },
    "rhythm.read",
    {},
  );
});
