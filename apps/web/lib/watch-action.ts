"use server";

/**
 * Turning a watch on or off (S-03, P6-G07b).
 *
 * Returns the subject's new state rather than nothing, so the control can show
 * the watcher count and the reason without a page load. The toggle and the
 * read are two actions and one round trip: a control that toggled and then
 * refetched would show a stale count for as long as the second call took.
 */

import { callAction, OperationError } from "@openokr/core";
import { getPool } from "./pool";
import type { WatchState } from "./watch-control.tsx";
import { requireWorkspace } from "./workspace";

export async function setWatching(input: {
  subjectType: string;
  subjectId: string;
  subscribe: boolean;
}): Promise<WatchState | { error: string }> {
  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };

  try {
    await callAction(context, "subscriptions.toggle", input);
    const state = await callAction(context, "subscriptions.read", {
      subjectType: input.subjectType,
      subjectId: input.subjectId,
    });
    return state;
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
}
