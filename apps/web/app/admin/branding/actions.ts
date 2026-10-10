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

import { callAction, OperationError, statusHueOf } from "@openokr/core";
import { HEX_COLOUR_PATTERN } from "@openokr/formats";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/auth";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import type { BrandingState } from "./branding-state.ts";

/** What the settings schema accepts. The input's `pattern` is the same rule. */
const HEX = HEX_COLOUR_PATTERN;

/** Why each status family is refused, one whole sentence per family. */
const REFUSED = {
  red: "admin.branding.brandingSettingsForm.refusedRed",
  amber: "admin.branding.brandingSettingsForm.refusedAmber",
  green: "admin.branding.brandingSettingsForm.refusedGreen",
} as const;

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
      await callAction(await context(), "settings.resetWorkspaceSettings", {
        card: "branding",
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
    return { error: t(REFUSED[family], { colour: primaryColor }), saved: null };
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
