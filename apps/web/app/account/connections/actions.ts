"use server";

import { callAction } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/pool";
import { requireWorkspace } from "../../../lib/workspace";
import type { RevokeResult } from "./revoke-state.ts";

/**
 * Ending a connection (P5-T08c).
 *
 * Revalidates, unlike the device approval: the list is what a person is looking
 * at, and the row has to come back marked revoked with its reason. That is the
 * whole confirmation.
 */
export async function revoke(
  _previous: RevokeResult | null,
  form: FormData,
): Promise<RevokeResult> {
  const id = String(form.get("id") ?? "").trim();
  if (id === "") {
    return { ok: false, message: "Nothing to revoke." };
  }

  const { session, workspace } = await requireWorkspace();
  try {
    await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "connections.revoke",
      { id },
    );
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "That connection could not be revoked.",
    };
  }

  revalidatePath("/account/connections");
  return { ok: true, message: "" };
}
