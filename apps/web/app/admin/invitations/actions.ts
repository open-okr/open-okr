"use server";

import { loadEnv } from "@openokr/config";
import { callAction } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";

/**
 * Issuing and revoking invitations (P6-G06).
 *
 * Every write here needs `full`, which the action declares and the admin
 * layout also enforces before the page renders. Two layers on purpose: the
 * layout decides what somebody sees, and `can()` decides what happens, and a
 * hidden control is cosmetic.
 *
 * **A token is returned once and never again.** `invitations.list` does not
 * carry one, because the table holds a digest. So the created link travels back
 * through the form's own state rather than through a revalidated read, and the
 * screen says so before the button rather than after.
 */
async function context() {
  const { session, workspace } = await requireWorkspace();
  return {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
}

interface IssuedLink {
  readonly id: string;
  readonly token: string;
  /**
   * The address to send somebody (P6-G06b).
   *
   * Built here rather than in the form, because the instance's own origin is
   * server-side configuration and a client component guessing it from
   * `window.location` would print whichever host the administrator happened to
   * be using, including `localhost`.
   */
  readonly url: string;
  readonly mode: "workspace" | "personal";
  readonly email?: string;
}

/** `<origin>/join/<token>`, the address `sendInvitation` has always mailed. */
function joinUrl(token: string): string {
  const base = loadEnv().BETTER_AUTH_URL;
  let end = base.length;
  while (end > 0 && base.charCodeAt(end - 1) === 47) {
    end--;
  }
  return `${base.slice(0, end)}/join/${token}`;
}

export interface InviteResult {
  readonly link?: IssuedLink;
  readonly error?: string;
}

async function reason(error: unknown): Promise<string> {
  if (error instanceof Error) {
    return error.message;
  }
  const { t } = await getTranslations();
  return t("admin.agents.proposalQueue.somethingWentWrong");
}

export async function createWorkspaceLinkAction(
  formData: FormData,
): Promise<InviteResult> {
  const maxUses = Number(formData.get("maxUses"));
  const expiresInDays = Number(formData.get("expiresInDays"));
  const domains = String(formData.get("allowedDomains") ?? "")
    .split(/[\s,]+/)
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value !== "");

  try {
    const link = await callAction(
      await context(),
      "invitations.createWorkspaceLink",
      {
        ...(Number.isFinite(maxUses) && maxUses > 0 ? { maxUses } : {}),
        ...(Number.isFinite(expiresInDays) && expiresInDays > 0
          ? { expiresInDays }
          : {}),
        ...(domains.length > 0 ? { allowedDomains: domains } : {}),
      },
    );
    revalidatePath("/admin/invitations");
    return {
      link: {
        id: link.id,
        token: link.token,
        url: joinUrl(link.token),
        mode: "workspace",
      },
    };
  } catch (error) {
    return { error: await reason(error) };
  }
}

export async function createPersonalLinkAction(
  formData: FormData,
): Promise<InviteResult> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const expiresInDays = Number(formData.get("expiresInDays"));

  try {
    const link = await callAction(
      await context(),
      "invitations.createPersonalLink",
      {
        email,
        ...(Number.isFinite(expiresInDays) && expiresInDays > 0
          ? { expiresInDays }
          : {}),
      },
    );
    revalidatePath("/admin/invitations");
    return {
      link: {
        id: link.id,
        token: link.token,
        url: joinUrl(link.token),
        mode: "personal",
        email,
      },
    };
  } catch (error) {
    return { error: await reason(error) };
  }
}

/**
 * Invites one address as a guest of one space (completeness review M-22).
 *
 * The same action as a personal invitation, with the space named, so a guest
 * is one more kind of invitation rather than a second flow. Accepting makes a
 * guest with nothing on the workspace and `view` on that space, and nothing
 * here can widen it: the level is the action's, not the form's.
 */
export async function createGuestLinkAction(
  formData: FormData,
): Promise<InviteResult> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const spaceId = String(formData.get("spaceId") ?? "");
  const expiresInDays = Number(formData.get("expiresInDays"));
  if (spaceId === "") {
    const { t } = await getTranslations();
    return { error: t("admin.invitations.chooseTheSpaceFirst") };
  }

  try {
    const link = await callAction(
      await context(),
      "invitations.createPersonalLink",
      {
        email,
        guestSpaceId: spaceId,
        ...(Number.isFinite(expiresInDays) && expiresInDays > 0
          ? { expiresInDays }
          : {}),
      },
    );
    revalidatePath("/admin/invitations");
    return {
      link: {
        id: link.id,
        token: link.token,
        url: joinUrl(link.token),
        mode: "personal",
        email,
      },
    };
  } catch (error) {
    return { error: await reason(error) };
  }
}

export async function revokeLinkAction(linkId: string): Promise<void> {
  await callAction(await context(), "invitations.revokeLink", { linkId });
  revalidatePath("/admin/invitations");
}
