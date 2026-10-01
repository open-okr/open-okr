"use server";

/**
 * Joining a workspace because it trusts your domain, from the browser
 * (completeness review M-34).
 *
 * The workspace arrives in the form, so it is checked against the person's own
 * offers before anything runs: a request can name any workspace it likes, and
 * the page and the write have to agree about which ones are on offer. The
 * action then checks everything again under that workspace, which is the
 * check that matters.
 */
import {
  callAction,
  OperationError,
  provisionWorkspaceForUser,
  trustedDomainOffers,
} from "@openokr/core";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPool } from "../../lib/pool";
import { requireSession } from "../../lib/session";
import { getTranslations } from "../../lib/translations";
import { ACTIVE_WORKSPACE_COOKIE } from "../../lib/workspace";
import type { JoinState } from "./[token]/join-state.ts";

/** Lands the next request in this workspace rather than the one they had open. */
async function landIn(workspaceId: string): Promise<void> {
  const jar = await cookies();
  jar.set(ACTIVE_WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
}

export async function joinTrustedWorkspace(
  _previous: JoinState,
  form: FormData,
): Promise<JoinState> {
  const workspaceId = String(form.get("workspaceId") ?? "");
  const session = await requireSession();
  const pool = getPool();

  const offered = await trustedDomainOffers(pool, session.user.id);
  if (!offered.some((offer) => offer.workspaceId === workspaceId)) {
    // One sentence whatever the reason, as the invitation page does: saying
    // "that workspace does not trust you" to a crafted request would confirm
    // the workspace exists.
    const { t } = await getTranslations();
    return { error: t("join.trusted.notOnOffer") };
  }

  try {
    await callAction(
      {
        pool,
        workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "invitations.joinByTrustedDomain",
      {},
    );
  } catch (error) {
    // A full workspace, or one frozen between the page and the press. Worth
    // reading, and specific to now.
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }

  await landIn(workspaceId);
  redirect("/");
}

/**
 * Makes the person a workspace of their own instead (completeness review M-34).
 *
 * Sign-up held this off because a workspace trusted their domain, so the join
 * page is where they say they would rather not join it. The same idempotent
 * provisioning the front door would have run, so pressing it twice, or after
 * joining somewhere, makes nothing new.
 */
export async function startOwnWorkspace(): Promise<void> {
  const session = await requireSession();
  const workspace = await provisionWorkspaceForUser(getPool(), {
    id: session.user.id,
    name: session.user.name,
  });
  await landIn(workspace.workspaceId);
  redirect("/");
}
