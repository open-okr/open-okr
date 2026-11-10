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
 * refusal returned under the field it is about, or as a sentence.
 */
import { callAction } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../lib/auth";
import { conflictOf, onlyChanged, readFromForm } from "../../lib/conflict.ts";
import { refusedByField } from "../../lib/refusal";
import { documentOrNull, unreadableFields } from "../../lib/rich-text-form.ts";
import { getTranslations } from "../../lib/translations";
import { requireWorkspace } from "../../lib/workspace";
import { NO_ERROR, type WriteState } from "./write-state.ts";

async function run(
  fn: (context: {
    pool: ReturnType<typeof getPool>;
    workspaceId: string;
    actor: { kind: "human"; userId: string };
  }) => Promise<unknown>,
  /** A refused input path to the form field it was typed in, where they differ. */
  fieldOf: (path: string) => string = (path) => path,
  /** What an edit sent, which a conflict shows beside what is stored. */
  sent?: Readonly<Record<string, unknown>>,
): Promise<WriteState> {
  const { session, workspace } = await requireWorkspace();
  try {
    await fn({
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    });
  } catch (error) {
    const conflict = conflictOf(error, sent);
    if (conflict) {
      return { error: null, conflict };
    }
    const refused = refusedByField(error, (await getTranslations()).t);
    if (refused === null) {
      throw error;
    }
    return refused.fields === undefined
      ? refused
      : {
          error: refused.error,
          fields: Object.fromEntries(
            Object.entries(refused.fields).map(([path, message]) => [
              fieldOf(path),
              message,
            ]),
          ),
        };
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
  const sessionDates = SESSION_KEYS.map((key) => ({
    key,
    on: text(formData, `session-${key}`),
  })).filter((entry) => entry.on !== "");
  // Only what the person changed, with what the form read for it, so a
  // field somebody else changed since is refused rather than overwritten
  // (optimistic-concurrency.md V4).
  const { set, read } = onlyChanged(
    {
      sponsorId: sponsorId === "" ? null : sponsorId,
      facilitatorId: facilitatorId === "" ? null : facilitatorId,
      firstCycle: formData.get("firstCycle") === "on",
      sessionDates,
    },
    readFromForm(formData),
  );
  if (read && Object.keys(set).length === 0) {
    return NO_ERROR;
  }
  return run(
    (context) =>
      callAction(context, "cycles.update", {
        id: text(formData, "cycleId"),
        ...set,
        ...(read ? { read } : {}),
      }),
    // A refused date is the one typed into that session's field, which the
    // input names by its place in the list of dates filled in.
    (path) => {
      const at = /^sessionDates\.(\d+)(\.|$)/.exec(path);
      const entry = at ? sessionDates[Number(at[1])] : undefined;
      return entry ? `session-${entry.key}` : path;
    },
    set,
  );
}

export async function saveBaselineHealth(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const { t } = await getTranslations();
  // The compact editor's documents, every column sent as it stands
  // (guided-inputs §4.7), so an empty column is null and a kept one is kept.
  const stable = documentOrNull(formData, "stable");
  const declining = documentOrNull(formData, "declining");
  const businessAsUsual = documentOrNull(formData, "businessAsUsual");
  if (
    stable === "malformed" ||
    declining === "malformed" ||
    businessAsUsual === "malformed"
  ) {
    return {
      error: null,
      fields: unreadableFields(
        { stable, declining, businessAsUsual },
        t("fields.richTextUnreadable"),
      ),
    };
  }
  if (stable === null && declining === null && businessAsUsual === null) {
    // A row with three empty columns would read as "recorded" to phase 2.
    return { error: t("cycle.baseline.writeOne") };
  }
  return run((context) =>
    callAction(context, "workflow.setBaselineHealth", {
      cycleId: text(formData, "cycleId"),
      stable,
      declining,
      businessAsUsual,
    }),
  );
}

export async function saveRevalidation(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const changed = text(formData, "verdict") === "changed";
  // The compact editor's documents since guided-inputs change 12, both sent
  // as they stand, so an empty note is null and a kept one is kept.
  const changeNote = documentOrNull(formData, "changeNote");
  const focusNote = documentOrNull(formData, "focusNote");
  if (changeNote === "malformed" || focusNote === "malformed") {
    const { t } = await getTranslations();
    return {
      error: null,
      fields: unreadableFields(
        { changeNote, focusNote },
        t("fields.richTextUnreadable"),
      ),
    };
  }
  return run((context) =>
    callAction(context, "workflow.setRevalidation", {
      cycleId: text(formData, "cycleId"),
      holds: !changed,
      changed,
      changeNote,
      focusNote,
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
  const cuts = documentOrNull(formData, "cuts");
  if (cuts === "malformed") {
    return { error: null, fields: { cuts: t("fields.richTextUnreadable") } };
  }
  if (cuts === null) {
    // §5.5: "If the answer is nothing, capacity was not checked."
    return { error: null, fields: { cuts: t("cycle.cuts.writeSomething") } };
  }
  return run((context) =>
    callAction(context, "workflow.setCapacityNotes", {
      cycleId: text(formData, "cycleId"),
      cuts,
    }),
  );
}
