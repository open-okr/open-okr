"use server";

/**
 * Saving and resetting the workspace's brand colour (screen S-36, completeness
 * review M-14).
 *
 * **The refusal used to be swallowed**, as the rhythm card's once was: the save
 * caught `OperationError` and returned, so a colour the action refused and a
 * colour it stored looked exactly alike. A status hue is refused now, and an
 * administrator who typed one has to be told why and what to choose instead.
 *
 * **One action for both buttons.** Save and Reset are two submit buttons of
 * one form, told apart by the `intent` the pressed button carries.
 *
 * **One Save for the whole look** (docs/design/branding-page.md §3). The
 * colour, the logo and the favicon are one form, and Save writes whatever of
 * the three changed. Everything is checked before anything is written, so a
 * wrong file does not leave a new colour behind it.
 */

import {
  BRANDING_IMAGE_MAX_BYTES,
  BRANDING_IMAGE_TYPES,
  callAction,
  ImageRefusedError,
  MAX_IMAGE_PIXELS,
  OperationError,
  storeUpload,
} from "@openokr/core";
import { HEX_COLOUR_PATTERN, statusHueOf } from "@openokr/formats";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/auth";
import { getStorage } from "../../../lib/storage";
import { getTranslations } from "../../../lib/translations";
import { getImageProcessor } from "../../../lib/upload-ports";
import { requireWorkspace } from "../../../lib/workspace";
import {
  type BrandingImageResult,
  type BrandingImageSlot,
  type BrandingState,
  REFUSED_HUE,
} from "./branding-state.ts";

/** What the settings schema accepts. The input's `pattern` is the same rule. */
const HEX = HEX_COLOUR_PATTERN;

async function context() {
  const { session, workspace } = await requireWorkspace();
  return {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
}

const SLOTS: readonly BrandingImageSlot[] = ["logo", "favicon"];

/** A file the form carried, or null when that picker was left empty. */
const fileIn = (form: FormData, name: string): File | null => {
  const value = form.get(name);
  return value instanceof File && value.size > 0 ? value : null;
};

export async function saveBranding(
  _previous: BrandingState,
  form: FormData,
): Promise<BrandingState> {
  const { t } = await getTranslations();

  if (form.get("intent") === "reset") {
    try {
      // The colour alone. A card reset would clear the logo and favicon too,
      // and this button belongs to the colour
      // (docs/design/workspace-logo-favicon.md §3).
      await callAction(await context(), "settings.updateWorkspaceBranding", {
        branding: {},
      });
    } catch (error) {
      if (error instanceof OperationError) {
        return { error: error.message, saved: null };
      }
      throw error;
    }
    // Every screen is drawn in the colour, starting with the root layout's
    // style sheet, so the whole tree is stale rather than this page.
    revalidatePath("/", "layout");
    return {
      error: null,
      saved: t("admin.branding.brandingSettingsForm.returnedToDefault"),
    };
  }

  // Written only when it differs from what the page was drawn with, so saving
  // a logo never touches the colour. Empty means the product's own palette,
  // so emptying a stored colour is a change like any other.
  const primaryColor = String(form.get("primaryColor") ?? "").trim();
  const storedColour = String(form.get("storedColour") ?? "").trim();
  const colourChanged =
    primaryColor.toLowerCase() !== storedColour.toLowerCase();
  if (colourChanged && primaryColor !== "" && !HEX.test(primaryColor)) {
    return {
      error: t("admin.branding.brandingSettingsForm.sixHexDigits"),
      saved: null,
    };
  }
  // Asked here as well as by the action's schema, so the refusal reaches the
  // administrator in their own language rather than as the schema's English.
  const family =
    !colourChanged || primaryColor === "" ? null : statusHueOf(primaryColor);
  if (family !== null) {
    return {
      error: t(REFUSED_HUE[family], { colour: primaryColor }),
      saved: null,
    };
  }

  // The type and size are asked here first so a wrong file is refused before
  // anything is stored. `settings.setWorkspaceBrandingImage` asks again and is
  // the enforcement.
  const files = SLOTS.map((slot) => ({ slot, file: fileIn(form, slot) }));
  for (const { file } of files) {
    if (file && !BRANDING_IMAGE_TYPES.has(file.type)) {
      return { error: t("admin.branding.images.wrongType"), saved: null };
    }
    if (file && file.size > BRANDING_IMAGE_MAX_BYTES) {
      return { error: t("admin.branding.images.tooLarge"), saved: null };
    }
  }

  // Written only when it differs from the name the page was drawn with, like
  // the colour. An emptied name is refused: a workspace always has one.
  const workspaceName = String(form.get("workspaceName") ?? "").trim();
  const storedName = String(form.get("storedName") ?? "").trim();
  const nameChanged = workspaceName !== storedName;
  if (nameChanged && workspaceName === "") {
    return { error: t("admin.branding.workspaceName.required"), saved: null };
  }

  if (
    !nameChanged &&
    !colourChanged &&
    files.every(({ file }) => file === null)
  ) {
    return { error: null, saved: t("admin.branding.nothingToSave") };
  }

  const ctx = await context();
  try {
    if (nameChanged) {
      await callAction(ctx, "workspace.rename", { name: workspaceName });
    }
    if (colourChanged) {
      await callAction(ctx, "settings.updateWorkspaceBranding", {
        branding: primaryColor === "" ? {} : { primaryColor },
      });
    }
    for (const { slot, file } of files) {
      if (!file) {
        continue;
      }
      const stored = await storeUpload(
        ctx,
        { storage: getStorage(), images: getImageProcessor() },
        {
          filename: file.name,
          contentType: file.type,
          bytes: Buffer.from(await file.arrayBuffer()),
        },
      );
      await callAction(ctx, "settings.setWorkspaceBrandingImage", {
        slot,
        blobId: stored.blobId,
      });
    }
  } catch (error) {
    // Whatever was written before the refusal stays written, and the page is
    // redrawn so it shows it.
    revalidatePath("/", "layout");
    if (error instanceof ImageRefusedError) {
      return {
        error:
          error.reason === "too_many_pixels"
            ? t("attachmentActions.imageTooLarge", {
                megapixels: MAX_IMAGE_PIXELS / 1_000_000,
              })
            : t("attachmentActions.imageUnreadable"),
        saved: null,
      };
    }
    if (error instanceof OperationError) {
      return { error: error.message, saved: null };
    }
    throw error;
  }

  revalidatePath("/", "layout");
  return { error: null, saved: t("admin.branding.brandingSettingsForm.saved") };
}

/** Takes the logo or favicon down, back to the default. */
export async function removeBrandingImage(
  slot: BrandingImageSlot,
): Promise<BrandingImageResult> {
  const { t } = await getTranslations();
  try {
    await callAction(await context(), "settings.setWorkspaceBrandingImage", {
      slot,
      blobId: null,
    });
  } catch (error) {
    if (error instanceof OperationError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
  revalidatePath("/", "layout");
  return { ok: true, message: t("admin.branding.images.removed") };
}
