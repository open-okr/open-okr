"use server";

/**
 * The list filter assist, from the browser (P4-T15d).
 *
 * A read, so there is nothing to revalidate: the component navigates to the URL
 * the filter describes and the page re-renders from its own query. Null means no
 * provider, a switch turned off, or a model that fell over, and the surface says
 * the filters above still work, which they do.
 */
import { callAction } from "@openokr/core";
import { getPool } from "../../lib/auth";
import { drafterFor } from "../../lib/drafter";
import { requireWorkspace } from "../../lib/workspace";

export async function parseFilterAction(sentence: string) {
  const { session, workspace } = await requireWorkspace();
  const base = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  const drafter = await drafterFor(workspace.workspaceId);
  return callAction(
    drafter ? { ...base, drafter } : base,
    "goals.parseFilter",
    { sentence },
  );
}

/** Whether a provider can parse a sentence at all. False is the normal case. */
export async function filterAssistAvailableAction(): Promise<boolean> {
  const { workspace } = await requireWorkspace();
  return (await drafterFor(workspace.workspaceId)) !== null;
}
