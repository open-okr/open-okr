"use server";

/**
 * Saving and resetting the limits card on S-36 (plan 0.7.0 B10).
 *
 * The card posts the storage quota in gigabytes, because nobody types a
 * byte count; this is where it becomes bytes. On a cloud the card does not
 * post the two provider limits at all, and the action refuses them anyway,
 * because a server action is reachable whatever the page rendered.
 */

import { callAction } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/auth";
import { refusalOf } from "../../../lib/refusal";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import type { GeneralState } from "./general-state.ts";

const GIGABYTE = 1024 ** 3;

async function context() {
  const { session, workspace } = await requireWorkspace();
  return {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
}

/** A posted number, or undefined when the field was not on the form. */
function numberField(form: FormData, name: string): number | undefined {
  const raw = form.get(name);
  if (raw === null) {
    return undefined;
  }
  const text = String(raw).trim();
  return text === "" ? Number.NaN : Number(text);
}

export async function submitLimits(
  _previous: GeneralState,
  form: FormData,
): Promise<GeneralState> {
  const { t } = await getTranslations();
  try {
    if (form.get("intent") === "reset") {
      await callAction(await context(), "settings.resetWorkspaceSettings", {
        card: "limits",
      });
      revalidatePath("/admin/general");
      return {
        error: null,
        saved: t("admin.general.limits.returnedToDefaults"),
      };
    }

    const storageGigabytes = numberField(form, "storageQuotaGigabytes");
    const input = {
      ...(storageGigabytes === undefined
        ? {}
        : { storageQuotaBytes: Math.round(storageGigabytes * GIGABYTE) }),
      exportInlineRowLimit: numberField(form, "exportInlineRowLimit"),
      importRowLimit: numberField(form, "importRowLimit"),
      messageLogRetentionDays: numberField(form, "messageLogRetentionDays"),
      agentRunCostCapUsd: numberField(form, "agentRunCostCapUsd"),
    };
    const posted = Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    );
    await callAction(
      await context(),
      "settings.updateWorkspaceLimits",
      posted as never,
    );
  } catch (error) {
    const refusal = refusalOf(error);
    if (refusal === null) {
      throw error;
    }
    return { error: refusal, saved: null };
  }
  revalidatePath("/admin/general");
  return { error: null, saved: t("admin.general.limits.saved") };
}
