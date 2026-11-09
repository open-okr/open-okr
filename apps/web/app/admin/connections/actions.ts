"use server";

import { callAction } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/pool";
import { refusalOf } from "../../../lib/refusal";
import { requireWorkspace } from "../../../lib/workspace";
import type { RevokeResult } from "../../account/connections/revoke-state.ts";

/**
 * Ending a member's agent connection or agent token, as an administrator
 * (agent-connections-admin.md, plan 0.7.0 A4). The action re-checks the
 * level and refuses any call that is not the signed-in browser.
 */
export async function endConnection(
  _previous: RevokeResult | null,
  form: FormData,
): Promise<RevokeResult> {
  const kind = String(form.get("kind") ?? "");
  const id = String(form.get("id") ?? "").trim();
  const { session, workspace } = await requireWorkspace();
  try {
    await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "connections.revokeAsAdmin",
      { kind: kind === "token" ? "token" : "grant", id },
    );
  } catch (error) {
    const refusal = refusalOf(error);
    if (refusal === null) {
      throw error;
    }
    return { ok: false, message: refusal };
  }
  revalidatePath("/admin/connections");
  return { ok: true, message: "" };
}
