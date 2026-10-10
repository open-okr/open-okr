"use server";

import {
  callAction,
  IMAGE_CONTENT_TYPES,
  ImageRefusedError,
  MAX_IMAGE_PIXELS,
  storeUpload,
} from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../lib/pool";
import { quietHoursFromForm } from "../../lib/quiet-hours";
import { getStorage } from "../../lib/storage";
import { getTranslations } from "../../lib/translations";
import { getImageProcessor } from "../../lib/upload-ports";
import { requireWorkspace } from "../../lib/workspace";

/**
 * Profile and org-field writes for the people pages (P6-G09, screen S-33).
 *
 * `updateProfile` is the self-edit path: timezone, bio, primary channel and
 * quiet hours. `uploadAvatar` and `removeAvatar` are the same path for the
 * picture (completeness review M-22). `updateMemberFields` is the admin path:
 * name, title and manager. All of them revalidate the profile page so the
 * reader sees their own change without a manual reload.
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
  const { t } = await getTranslations();
  const memberId = String(form.get("memberId") ?? "");
  try {
    const ctx = await actionContext();
    const input: Record<string, unknown> = {};

    const timezone = form.get("timezone");
    if (timezone) input.timezone = String(timezone);

    const primaryChannel = form.get("primaryChannel");
    if (primaryChannel) input.primaryChannel = String(primaryChannel);

    const quietHours = quietHoursFromForm(form);
    if (!quietHours.ok) {
      return { ok: false, message: t("common.quietHoursNeedBothTimes") };
    }
    if (quietHours.value !== undefined) {
      input.quietHours = quietHours.value;
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
    return { ok: true, message: t("people.actions.profileUpdated") };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : t("people.actions.updateFailed"),
    };
  }
}

/**
 * A new picture for the signed-in member (completeness review M-22).
 *
 * **Through `storeUpload`, the one upload path**, so the picture is re-encoded
 * with its metadata left behind and given the thumbnail the profile shows, and
 * a file that is not the image it claims to be is refused before anything is
 * stored. `people.updateOwnProfile` then checks the file again: this action is
 * one caller, and the rule has to hold for all of them.
 *
 * The type is checked here first only so that a PDF is refused before it is
 * stored and left behind unused. The action's own check is the enforcement.
 */
export async function uploadAvatar(
  _previous: ProfileResult | null,
  form: FormData,
): Promise<ProfileResult> {
  const { t } = await getTranslations();
  const file = form.get("avatar");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: t("people.actions.chooseAPictureFirst") };
  }
  if (!IMAGE_CONTENT_TYPES.has(file.type)) {
    return { ok: false, message: t("people.actions.pictureMustBeAnImage") };
  }

  const { session, workspace } = await requireWorkspace();
  const ctx = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  try {
    const stored = await storeUpload(
      ctx,
      { storage: getStorage(), images: getImageProcessor() },
      {
        filename: file.name,
        contentType: file.type,
        bytes: Buffer.from(await file.arrayBuffer()),
      },
    );
    await callAction(ctx, "people.updateOwnProfile", {
      avatarBlobId: stored.blobId,
    });
  } catch (error) {
    if (error instanceof ImageRefusedError) {
      return {
        ok: false,
        message:
          error.reason === "too_many_pixels"
            ? t("attachmentActions.imageTooLarge", {
                megapixels: MAX_IMAGE_PIXELS / 1_000_000,
              })
            : t("attachmentActions.imageUnreadable"),
      };
    }
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : t("people.actions.updateFailed"),
    };
  }
  revalidatePath(`/people/${workspace.memberId}`);
  return { ok: true, message: t("people.actions.pictureUpdated") };
}

/** Takes the signed-in member's picture down, back to their initials. */
export async function removeAvatar(): Promise<ProfileResult> {
  const { t } = await getTranslations();
  const { session, workspace } = await requireWorkspace();
  try {
    await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human" as const, userId: session.user.id },
      },
      "people.updateOwnProfile",
      { avatarBlobId: null },
    );
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : t("people.actions.updateFailed"),
    };
  }
  revalidatePath(`/people/${workspace.memberId}`);
  return { ok: true, message: t("people.actions.pictureRemoved") };
}

export async function updateMemberFields(
  _previous: ProfileResult | null,
  form: FormData,
): Promise<ProfileResult> {
  const { t } = await getTranslations();
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
    return { ok: true, message: t("people.actions.memberUpdated") };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : t("people.actions.updateFailed"),
    };
  }
}

/**
 * A member's leave, written whole (METHOD.md §7.4, P9-T19b-b). A member's own
 * goes through `people.setLeave`; an administrator's write for somebody else
 * through `people.setMemberLeave`, which is the self-versus-others split the
 * profile already has.
 */
export async function setLeaveAction(
  memberId: string,
  self: boolean,
  leave: readonly {
    readonly startsOn: string;
    readonly endsOn: string;
    readonly delegateId: string;
  }[],
): Promise<ProfileResult> {
  const { t } = await getTranslations();
  try {
    const ctx = await actionContext();
    const spans = leave.map((span) => ({
      startsOn: span.startsOn,
      endsOn: span.endsOn,
      delegateId: span.delegateId,
    }));
    if (self) {
      await callAction(ctx, "people.setLeave", { leave: spans });
    } else {
      await callAction(ctx, "people.setMemberLeave", {
        memberId,
        leave: spans,
      });
    }
    revalidatePath(`/people/${memberId}`);
    return { ok: true, message: t("people.detail.leave.saved") };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : t("people.actions.updateFailed"),
    };
  }
}
