"use server";

/**
 * Saving the METHOD.md §12 practice for one workspace (P9-T05).
 *
 * Two writes, each through the action the API and the command line use, so
 * the screen can do nothing they cannot and is refused the same way.
 */

import { callAction } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/auth";
import { refusalFields } from "../../../lib/refusal";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { diffPractice, type PracticeState } from "./practice-state.ts";

async function context() {
  const { session, workspace } = await requireWorkspace();
  return {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
}

/** A refusal's own sentence, or the error itself when it is not a refusal. */
/**
 * A refusal as the card's sentence. Every setting here is a choice from the
 * method's own list, so a refusal is about the practice as a whole rather
 * than one box; a schema's refusal too, which used to reach the error page
 * (plan U1b).
 */
async function refused(error: unknown): Promise<PracticeState> {
  const refusal = refusalFields(error, (await getTranslations()).t);
  if (refusal === null) {
    throw error;
  }
  return { error: refusal.message, saved: null };
}

/**
 * Saves what a card changed, and only that.
 *
 * The page's one form submits every select it renders. `diffPractice` keeps
 * the differences, and sends `null` for a value set back to the profile's own
 * on an overridden key, which clears the override (the same write the removed
 * per-card reset made).
 */
export async function savePractice(
  _previous: PracticeState,
  form: FormData,
): Promise<PracticeState> {
  const { t } = await getTranslations();
  const ctx = await context();
  const current = await callAction(ctx, "practice.read", {});

  const submitted: [string, string][] = [];
  for (const [field, raw] of form.entries()) {
    if (field.startsWith("practice:")) {
      submitted.push([field.slice("practice:".length), String(raw)]);
    }
  }
  const changed = diffPractice(current, submitted);
  const count = Object.keys(changed).length;
  if (count === 0) {
    return { error: null, saved: t("common.noChanges") };
  }

  try {
    await callAction(ctx, "practice.update", { overrides: changed });
  } catch (error) {
    return refused(error);
  }
  revalidatePath("/admin/practice");
  return {
    error: null,
    saved: t("admin.practice.actions.saved", { count }),
  };
}

/** Chooses a profile, with the thresholds it sets. */
export async function applyProfile(
  _previous: PracticeState,
  form: FormData,
): Promise<PracticeState> {
  const { t } = await getTranslations();
  const profile = String(form.get("profile") ?? "");
  const ctx = await context();
  const current = await callAction(ctx, "practice.read", {});
  const chosen = current.profiles.find((entry) => entry.key === profile);
  if (!chosen) {
    return { error: t("admin.practice.actions.noProfile"), saved: null };
  }

  let applied: Awaited<ReturnType<typeof callAction<"practice.applyProfile">>>;
  try {
    applied = await callAction(ctx, "practice.applyProfile", {
      profile: chosen.key,
    });
  } catch (error) {
    return refused(error);
  }
  revalidatePath("/admin/practice");
  // A profile can move a threshold, and the rhythm card shows those.
  revalidatePath("/admin/rhythm");

  const count = applied.thresholdsChanged.length;
  return {
    error: null,
    saved:
      count === 0
        ? t("admin.practice.actions.applied", { profile: chosen.label })
        : t("admin.practice.actions.appliedThresholds", {
            profile: chosen.label,
            count,
          }),
  };
}
