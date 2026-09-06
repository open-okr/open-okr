"use server";

import { callAction } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/pool";
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
  readonly mode: "workspace" | "personal";
  readonly email?: string;
}

export interface InviteResult {
  readonly link?: IssuedLink;
  readonly error?: string;
}

const reason = (error: unknown): string =>
  error instanceof Error ? error.message : "Something went wrong.";

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
    return { link: { id: link.id, token: link.token, mode: "workspace" } };
  } catch (error) {
    return { error: reason(error) };
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
      link: { id: link.id, token: link.token, mode: "personal", email },
    };
  } catch (error) {
    return { error: reason(error) };
  }
}

export async function revokeLinkAction(linkId: string): Promise<void> {
  await callAction(await context(), "invitations.revokeLink", { linkId });
  revalidatePath("/admin/invitations");
}
