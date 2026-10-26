"use server";

import { callAction } from "@openokr/core";
import type { EntityOption } from "@openokr/ui";
import { getPool } from "./pool";
import { refusalOf } from "./refusal";
import { requireWorkspace } from "./workspace";

/**
 * Goals whose name holds what was typed, for a picker that cannot be handed
 * every goal: a workspace can hold tens of thousands (guided-inputs §4.10).
 * Through `search.entities`, asking for goals alone, so the twenty kept are
 * goals the reader may open rather than whatever else matched first.
 */
export async function searchGoals(text: string): Promise<EntityOption[]> {
  const typed = text.trim();
  if (typed === "") {
    return [];
  }
  const { session, workspace } = await requireWorkspace();
  try {
    const found = await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "search.entities",
      { text: typed.slice(0, 200), kinds: ["goal"], limit: 20 },
    );
    return found.map((one) => ({ id: one.entityId, label: one.title }));
  } catch (error) {
    if (refusalOf(error) === null) {
      throw error;
    }
    return [];
  }
}
