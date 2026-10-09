"use server";

/**
 * Saving and resetting the general admin card (screen S-36): timezone,
 * language, trusted email domains and the second-factor policy.
 *
 * **A refusal used to send the administrator to the error page.** The save
 * caught `OperationError` and returned nothing, so a refusal said nothing, and
 * a mistyped timezone or domain failed the action's input schema with an error
 * that was not an `OperationError` and was thrown on. Both are asked here
 * first, so the refusal comes back as a sentence in the administrator's own
 * language, naming what was wrong. The action's schema is still what enforces
 * them.
 *
 * **One action for both buttons**, told apart by the pressed button's
 * `intent`, as the branding card does.
 */

import {
  callAction,
  OperationError,
  trustedEmailDomainsSchema,
} from "@openokr/core";
import { isListedTimezone } from "@openokr/formats";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/auth";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import type { GeneralState } from "./general-state.ts";

async function context() {
  const { session, workspace } = await requireWorkspace();
  return {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
}

export async function submitGeneral(
  _previous: GeneralState,
  form: FormData,
): Promise<GeneralState> {
  const { t } = await getTranslations();

  if (form.get("intent") === "reset") {
    try {
      await callAction(await context(), "settings.resetWorkspaceSettings", {
        card: "general",
      });
    } catch (error) {
      if (error instanceof OperationError) {
        return { error: error.message, saved: null };
      }
      throw error;
    }
    revalidatePath("/admin/general");
    return {
      error: null,
      saved: t("admin.general.generalSettingsForm.returnedToDefaults"),
    };
  }

  const timezone = String(form.get("timezone") ?? "").trim();
  const language = String(form.get("language") ?? "").trim();
  const trustedEmailDomains = String(form.get("trustedEmailDomains") ?? "")
    .split(",")
    .map((domain) => domain.trim())
    .filter((domain) => domain.length > 0);

  if (timezone !== "" && !isListedTimezone(timezone)) {
    return {
      error: t("admin.general.generalSettingsForm.unknownTimezone", {
        timezone,
      }),
      saved: null,
    };
  }
  const domains = trustedEmailDomainsSchema.safeParse(trustedEmailDomains);
  if (!domains.success) {
    // The schema names the entry it refused by its position in the list.
    const index = domains.error.issues[0]?.path[0];
    const domain =
      typeof index === "number"
        ? (trustedEmailDomains[index] ?? "")
        : trustedEmailDomains.join(", ");
    return {
      error: t("admin.general.generalSettingsForm.notADomain", { domain }),
      saved: null,
    };
  }

  try {
    await callAction(await context(), "settings.updateWorkspaceGeneral", {
      timezone: timezone === "" ? undefined : timezone,
      language: language === "" ? undefined : language,
      trustedEmailDomains,
      // A checkbox that is off sends nothing at all, so the absence is the
      // value rather than a missing one (P8-T09).
      requireSecondFactor: form.get("requireSecondFactor") === "on",
    });
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message, saved: null };
    }
    throw error;
  }

  revalidatePath("/admin/general");
  return { error: null, saved: t("admin.general.generalSettingsForm.saved") };
}
