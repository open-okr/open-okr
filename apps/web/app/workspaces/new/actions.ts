"use server";

import { callAction } from "@openokr/core";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPool } from "../../../lib/pool";
import { refusalOf } from "../../../lib/refusal";
import {
  ACTIVE_WORKSPACE_COOKIE,
  requireWorkspace,
} from "../../../lib/workspace";

/**
 * Starting a workspace of your own (docs/design/hosting-profiles.md §3).
 *
 * The action holds every rule, so this is only the door: a refusal comes back as
 * its sentence, naming the free limit when that is why. On success the new one
 * becomes the active workspace, and its owner goes to its first-run setup.
 */
export interface NewOwnWorkspaceState {
  readonly error?: string;
}

export async function createOwnWorkspaceAction(
  formData: FormData,
): Promise<NewOwnWorkspaceState> {
  const { session, workspace } = await requireWorkspace();
  let workspaceId: string;
  try {
    const created = await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "workspace.provision",
      { name: String(formData.get("name") ?? "") },
    );
    workspaceId = created.workspaceId;
  } catch (error) {
    const refusal = refusalOf(error);
    if (refusal === null) {
      throw error;
    }
    return { error: refusal };
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/welcome");
}
