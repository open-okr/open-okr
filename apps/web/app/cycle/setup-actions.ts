"use server";

/**
 * The phase 1, 2, 3 and 5 writes that had no browser caller (completeness
 * review H-09).
 *
 * `cycles.update` (sponsor, facilitator, session dates), `setBaselineHealth`,
 * `setRevalidation` and `setCapacityNotes` all shipped, and the coverage test
 * excused the last three as "an AI draft, offered through the phase assists",
 * which none of them is. The phases that read them could not go green from the
 * browser, so every publish needed the override. The focus key results had
 * neither a write nor a screen.
 *
 * Same shape as the other cycle writes: one registry call per form, and a
 * refusal returned as a sentence.
 */
import {
  callAction,
  isBlankText,
  OperationError,
  richTextFromPlainText,
} from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../lib/auth";
import { getTranslations } from "../../lib/translations";
import { requireWorkspace } from "../../lib/workspace";
import { NO_ERROR, type WriteState } from "./write-state.ts";

async function run(
  fn: (context: {
    pool: ReturnType<typeof getPool>;
    workspaceId: string;
    actor: { kind: "human"; userId: string };
  }) => Promise<unknown>,
): Promise<WriteState> {
  const { session, workspace } = await requireWorkspace();
  try {
    await fn({
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    });
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
  revalidatePath("/", "layout");
  return NO_ERROR;
}

const text = (formData: FormData, name: string): string =>
  String(formData.get(name) ?? "").trim();

/** The four planning sessions §2.4 books before the cycle starts. */
const SESSION_KEYS = [
  "diagnose",
  "set-direction",
  "draft",
  "align-and-commit",
] as const;

export async function saveCycleSetup(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const sponsorId = text(formData, "sponsorId");
  const facilitatorId = text(formData, "facilitatorId");
  return run((context) =>
    callAction(context, "cycles.update", {
      id: text(formData, "cycleId"),
      sponsorId: sponsorId === "" ? null : sponsorId,
      facilitatorId: facilitatorId === "" ? null : facilitatorId,
      firstCycle: formData.get("firstCycle") === "on",
      sessionDates: SESSION_KEYS.map((key) => ({
        key,
        on: text(formData, `session-${key}`),
      })).filter((entry) => entry.on !== ""),
    }),
  );
}

export async function saveBaselineHealth(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const { t } = await getTranslations();
  const columns = {
    stable: text(formData, "stable"),
    declining: text(formData, "declining"),
    businessAsUsual: text(formData, "businessAsUsual"),
  };
  if (Object.values(columns).every(isBlankText)) {
    // A row with three empty columns would read as "recorded" to phase 2.
    return { error: t("cycle.baseline.writeOne") };
  }
  const rich = (value: string) =>
    isBlankText(value) ? null : richTextFromPlainText(value);
  return run((context) =>
    callAction(context, "workflow.setBaselineHealth", {
      cycleId: text(formData, "cycleId"),
      stable: rich(columns.stable),
      declining: rich(columns.declining),
      businessAsUsual: rich(columns.businessAsUsual),
    }),
  );
}

export async function saveRevalidation(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const changed = text(formData, "verdict") === "changed";
  const changeNote = text(formData, "changeNote");
  const focusNote = text(formData, "focusNote");
  return run((context) =>
    callAction(context, "workflow.setRevalidation", {
      cycleId: text(formData, "cycleId"),
      holds: !changed,
      changed,
      changeNote: changeNote === "" ? null : changeNote,
      focusNote: focusNote === "" ? null : focusNote,
    }),
  );
}

export async function saveFocusKeyResults(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  return run((context) =>
    callAction(context, "workflow.setFocusKeyResults", {
      cycleId: text(formData, "cycleId"),
      keyResultIds: formData
        .getAll("keyResultId")
        .map((value) => String(value)),
    }),
  );
}

export async function saveCapacityCuts(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const { t } = await getTranslations();
  const cuts = text(formData, "cuts");
  if (isBlankText(cuts)) {
    // §5.5: "If the answer is nothing, capacity was not checked."
    return { error: t("cycle.cuts.writeSomething") };
  }
  return run((context) =>
    callAction(context, "workflow.setCapacityNotes", {
      cycleId: text(formData, "cycleId"),
      cuts: richTextFromPlainText(cuts),
    }),
  );
}
