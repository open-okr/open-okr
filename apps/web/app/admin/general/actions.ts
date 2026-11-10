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

import { callAction, trustedEmailDomainsSchema } from "@openokr/core";
import { isFreeMailDomain, isListedTimezone } from "@openokr/formats";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/auth";
import { refusedState } from "../../../lib/refusal";
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

/** The fields the card draws, which show their own refusal (§4.2). */
const DRAWN = ["timezone", "language", "trustedEmailDomains"] as const;

/** The form's own check, said under the one field it is about. */
const on = (field: (typeof DRAWN)[number], message: string): GeneralState => ({
  error: null,
  saved: null,
  fields: { [field]: message },
});

/**
 * A refused save under the field it names, the domain list for any entry in
 * it, and as the card's sentence otherwise. A schema's refusal too, which
 * used to reach the error page. Null for a failure.
 */
function refused(
  error: unknown,
  t: Awaited<ReturnType<typeof getTranslations>>["t"],
  domains: readonly string[],
): GeneralState | null {
  const state = refusedState(
    error,
    t,
    DRAWN,
    Object.fromEntries(
      domains.map((_, index) => [
        `trustedEmailDomains.${index}`,
        "trustedEmailDomains",
      ]),
    ),
  );
  if (state === null) {
    return null;
  }
  return {
    error: state.error ?? null,
    saved: null,
    ...(state.fields ? { fields: state.fields } : {}),
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
      const state = refused(error, t, []);
      if (state === null) {
        throw error;
      }
      return state;
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
    return on(
      "timezone",
      t("admin.general.generalSettingsForm.unknownTimezone", { timezone }),
    );
  }
  // A free mail provider is refused by the action too; said here in the
  // reader's language (docs/design/registration-policy.md D9).
  const free = trustedEmailDomains.find((domain) => isFreeMailDomain(domain));
  if (free !== undefined) {
    return on(
      "trustedEmailDomains",
      t("admin.general.generalSettingsForm.freeMailDomain", { domain: free }),
    );
  }
  const domains = trustedEmailDomainsSchema.safeParse(trustedEmailDomains);
  if (!domains.success) {
    // The schema names the entry it refused by its position in the list.
    const index = domains.error.issues[0]?.path[0];
    const domain =
      typeof index === "number"
        ? (trustedEmailDomains[index] ?? "")
        : trustedEmailDomains.join(", ");
    return on(
      "trustedEmailDomains",
      t("admin.general.generalSettingsForm.notADomain", { domain }),
    );
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
    const state = refused(error, t, trustedEmailDomains);
    if (state === null) {
      throw error;
    }
    return state;
  }

  revalidatePath("/admin/general");
  return { error: null, saved: t("admin.general.generalSettingsForm.saved") };
}
