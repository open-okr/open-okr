"use server";

/**
 * Saving the METHOD.md §12 practice for one workspace (P9-T05).
 *
 * Three writes, each through the action the API and the command line use, so
 * the screen can do nothing they cannot and is refused the same way.
 */

import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/auth";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { NOTHING_SAVED, type PracticeState } from "./practice-state.ts";

async function context() {
  const { session, workspace } = await requireWorkspace();
  return {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
}

/** A refusal's own sentence, or the error itself when it is not a refusal. */
function refused(error: unknown): PracticeState {
  if (error instanceof OperationError) {
    return { error: error.message, saved: null };
  }
  throw error;
}

/**
 * Saves what a card changed, and only that.
 *
 * A card submits every select it renders. Sending them all would record every
 * one as changed in the audit trail, so the form is compared with what the
 * workspace runs now and only the differences go. A value set back to the
 * profile's own is still a difference, and `practice.update` stores it as no
 * change at all, which is what returning a setting to its profile means.
 */
export async function savePractice(
  _previous: PracticeState,
  form: FormData,
): Promise<PracticeState> {
  const { t } = await getTranslations();
  const ctx = await context();
  const current = await callAction(ctx, "practice.read", {});

  const changed: Record<string, string> = {};
  for (const [field, raw] of form.entries()) {
    if (!field.startsWith("practice:")) {
      continue;
    }
    const key = field.slice("practice:".length);
    const value = String(raw);
    if (current.practice[key] !== value) {
      changed[key] = value;
    }
  }
  const count = Object.keys(changed).length;
  if (count === 0) {
    return { error: null, saved: t("admin.practice.actions.nothingChanged") };
  }

  try {
    await callAction(ctx, "practice.update", { overrides: changed });
  } catch (error) {
    return refused(error);
  }
  revalidatePath("/admin/practice");
  return {
    error: null,
    saved:
      count === 1
        ? t("admin.practice.actions.savedOne", { count })
        : t("admin.practice.actions.savedOther", { count }),
  };
}

/**
 * Returns one card's settings to the profile.
 *
 * A button rather than a form, for the reason the rhythm card's reset gives:
 * it sits inside the card's own form, and a form inside a form is not markup a
 * browser honours. Only the settings this workspace changed are sent, so the
 * audit row names what was actually reset.
 */
export async function resetPractice(
  keys: readonly string[],
): Promise<PracticeState> {
  const { t } = await getTranslations();
  const ctx = await context();
  const current = await callAction(ctx, "practice.read", {});
  const wanted = keys.filter((key) => key in current.overrides);
  if (wanted.length === 0) {
    return { error: t("admin.practice.actions.nothingToReset"), saved: null };
  }

  try {
    await callAction(ctx, "practice.update", {
      overrides: Object.fromEntries(wanted.map((key) => [key, null])),
    });
  } catch (error) {
    return refused(error);
  }
  revalidatePath("/admin/practice");
  return {
    ...NOTHING_SAVED,
    saved:
      wanted.length === 1
        ? t("admin.practice.actions.resetOne", { count: wanted.length })
        : t("admin.practice.actions.resetOther", { count: wanted.length }),
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
        : count === 1
          ? t("admin.practice.actions.appliedThresholdsOne", {
              profile: chosen.label,
              count,
            })
          : t("admin.practice.actions.appliedThresholdsOther", {
              profile: chosen.label,
              count,
            }),
  };
}
