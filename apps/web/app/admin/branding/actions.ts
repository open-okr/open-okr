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
 * **One action for both buttons.** Save and Reset are two submit buttons in
 * one form, told apart by the `intent` the pressed button carries, because a
 * form cannot nest inside another and the two belong on one row.
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

export async function submitBranding(
  _previous: BrandingState,
  form: FormData,
): Promise<BrandingState> {
  const { t } = await getTranslations();

  if (form.get("intent") === "reset") {
    try {
      // The colour alone. A card reset would clear the logo and favicon too,
      // and this button is on the colour card
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

  // Empty means the product's own palette, not an unanswered question, so
  // clearing the field is a valid save.
  const primaryColor = String(form.get("primaryColor") ?? "").trim();
  if (primaryColor !== "" && !HEX.test(primaryColor)) {
    return {
      error: t("admin.branding.brandingSettingsForm.sixHexDigits"),
      saved: null,
    };
  }
  // Asked here as well as by the action's schema, so the refusal reaches the
  // administrator in their own language rather than as the schema's English.
  const family = primaryColor === "" ? null : statusHueOf(primaryColor);
  if (family !== null) {
    return {
      error: t(REFUSED_HUE[family], { colour: primaryColor }),
      saved: null,
    };
  }

  try {
    await callAction(await context(), "settings.updateWorkspaceBranding", {
      branding: primaryColor === "" ? {} : { primaryColor },
    });
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message, saved: null };
    }
    throw error;
  }

  revalidatePath("/", "layout");
  return { error: null, saved: t("admin.branding.brandingSettingsForm.saved") };
}

const slotOf = (form: FormData): BrandingImageSlot | null => {
  const slot = form.get("slot");
  return slot === "logo" || slot === "favicon" ? slot : null;
};

/**
 * Stores a chosen logo or favicon and makes it the workspace's
 * (docs/design/workspace-logo-favicon.md §3).
 *
 * The type and size are asked here first only so a wrong file is refused
 * before it is stored and left behind. `settings.setWorkspaceBrandingImage`
 * asks again and is the enforcement.
 */
export async function uploadBrandingImage(
  _previous: BrandingImageResult | null,
  form: FormData,
): Promise<BrandingImageResult> {
  const { t } = await getTranslations();
  const slot = slotOf(form);
  const file = form.get("image");
  if (slot === null || !(file instanceof File) || file.size === 0) {
    return { ok: false, message: t("admin.branding.images.chooseFirst") };
  }
  if (!BRANDING_IMAGE_TYPES.has(file.type)) {
    return { ok: false, message: t("admin.branding.images.wrongType") };
  }
  if (file.size > BRANDING_IMAGE_MAX_BYTES) {
    return { ok: false, message: t("admin.branding.images.tooLarge") };
  }

  const ctx = await context();
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
    await callAction(ctx, "settings.setWorkspaceBrandingImage", {
      slot,
      blobId: stored.blobId,
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
    if (error instanceof OperationError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }

  // The sidebar and the tab icon are drawn by the root layout.
  revalidatePath("/", "layout");
  return {
    ok: true,
    message: t(
      slot === "logo"
        ? "admin.branding.images.logoSaved"
        : "admin.branding.images.faviconSaved",
    ),
  };
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
