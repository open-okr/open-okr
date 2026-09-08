"use server";

import { callAction } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../lib/pool";
import { requireWorkspace } from "../../lib/workspace";

/**
 * Profile and org-field writes for the people pages (P6-G09, screen S-33).
 *
 * `updateProfile` is the self-edit path: timezone, avatar, bio, primary
 * channel and quiet hours. `updateMemberFields` is the admin path: name,
 * title and manager. Both revalidate the profile page so the reader sees
 * their own change without a manual reload.
 */

async function actionContext() {
  const { session, workspace } = await requireWorkspace();
  return {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
}

export interface ProfileResult {
  readonly ok: boolean;
  readonly message: string;
}

export async function updateProfile(
  _previous: ProfileResult | null,
  form: FormData,
): Promise<ProfileResult> {
  const memberId = String(form.get("memberId") ?? "");
  try {
    const ctx = await actionContext();
    const input: Record<string, unknown> = {};

    const timezone = form.get("timezone");
    if (timezone) input.timezone = String(timezone);

    const primaryChannel = form.get("primaryChannel");
    if (primaryChannel) input.primaryChannel = String(primaryChannel);

    const quietStart = form.get("quietStart");
    const quietEnd = form.get("quietEnd");
    if (quietStart && quietEnd) {
      input.quietHours = { start: String(quietStart), end: String(quietEnd) };
    } else if (quietStart === "" && quietEnd === "") {
      input.quietHours = null;
    }

    const bioRaw = form.get("bio");
    if (bioRaw !== null) {
      input.bio = bioRaw === "" ? null : JSON.parse(String(bioRaw));
    }

    const avatarBlobId = form.get("avatarBlobId");
    if (avatarBlobId !== null) {
      input.avatarBlobId = avatarBlobId === "" ? null : String(avatarBlobId);
    }

    await callAction(ctx, "people.updateOwnProfile", input);
    revalidatePath(`/people/${memberId}`);
    return { ok: true, message: "Profile updated." };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Update failed.",
    };
  }
}

export async function updateMemberFields(
  _previous: ProfileResult | null,
  form: FormData,
): Promise<ProfileResult> {
  const memberId = String(form.get("memberId") ?? "");
  try {
    const ctx = await actionContext();
    const input: {
      memberId: string;
      name?: string;
      title?: string | null;
      managerId?: string | null;
    } = { memberId };

    const name = form.get("name");
    if (name) input.name = String(name);

    const title = form.get("title");
    if (title !== null) input.title = title === "" ? null : String(title);

    const managerId = form.get("managerId");
    if (managerId !== null) {
      input.managerId = managerId === "" ? null : String(managerId);
    }

    await callAction(ctx, "people.updateMember", input);
    revalidatePath(`/people/${memberId}`);
    return { ok: true, message: "Member updated." };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Update failed.",
    };
  }
}
