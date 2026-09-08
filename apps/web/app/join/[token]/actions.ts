"use server";

/**
 * Accepting an invitation from the browser (P6-G06b).
 *
 * The workspace comes from the token rather than from the caller, which is the
 * whole point of `previewInvite`: a signed-in visitor following a link has no
 * membership in the workspace that invited them, so there is no active
 * workspace to run this under and nothing they could be asked to choose.
 *
 * The cookie is cleared either way. It exists to carry the token through
 * sign-up, and once acceptance has been attempted it is a stale secret sitting
 * in a browser.
 */
import {
  callAction,
  INVITE_COOKIE,
  INVITE_COOKIE_MAX_AGE_SECONDS,
  OperationError,
  previewInvite,
} from "@openokr/core";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPool } from "../../../lib/pool";
import { requireSession } from "../../../lib/session";
import { ACTIVE_WORKSPACE_COOKIE } from "../../../lib/workspace";
import type { JoinState } from "./join-state.ts";

export async function acceptInvitation(
  _previous: JoinState,
  form: FormData,
): Promise<JoinState> {
  const token = String(form.get("token") ?? "");
  const session = await requireSession();

  const invitation = await previewInvite(getPool(), {
    token,
    now: new Date(),
  });
  if (invitation.kind !== "usable") {
    return { error: "That invitation cannot be used." };
  }

  try {
    await callAction(
      {
        pool: getPool(),
        workspaceId: invitation.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "invitations.acceptLink",
      { token },
    );
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }

  const jar = await cookies();
  jar.delete(INVITE_COOKIE);
  // Land in the workspace they just joined rather than whichever one they had
  // open. Somebody who follows an invitation is asking to be there.
  jar.set(ACTIVE_WORKSPACE_COOKIE, invitation.workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  redirect("/");
}

/**
 * Stores the token and sends the visitor to sign up (P6-G06b).
 *
 * **A server action rather than the page's own render, because Next forbids
 * the alternative**: "Cookies can only be modified in a Server Action or
 * Route Handler". The first draft set it while rendering and the page threw,
 * which the end-to-end spec caught as the root error card where the invitation
 * should have been.
 *
 * Better this way regardless. Storing a credential is now something the
 * visitor does by pressing a button, not something that happens because a page
 * was looked at, and a link that only ever navigates cannot leave a token in a
 * browser that never went on to sign up.
 */
export async function startSignUp(
  _previous: JoinState,
  form: FormData,
): Promise<JoinState> {
  const token = String(form.get("token") ?? "");
  const invitation = await previewInvite(getPool(), {
    token,
    now: new Date(),
  });
  if (invitation.kind !== "usable") {
    return { error: "That invitation cannot be used." };
  }

  const jar = await cookies();
  jar.set(INVITE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: INVITE_COOKIE_MAX_AGE_SECONDS,
    secure: process.env.NODE_ENV === "production",
  });
  redirect("/sign-up");
}
