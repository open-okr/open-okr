"use server";

/**
 * Saving and resetting the §11 registry for one workspace (P6-G20).
 *
 * **The refusal used to be swallowed.** The previous version of this save
 * caught `OperationError` and returned, so an out-of-range threshold looked
 * exactly like a successful save: the page came back unchanged and said
 * nothing. `rhythm.update` refuses with the key and the bound in the sentence,
 * and this is what carries that sentence to the screen.
 */

import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/auth";
import { requireWorkspace } from "../../../lib/workspace";
import { NOTHING_SAVED, type RhythmState } from "./rhythm-state.ts";

async function context() {
  const { session, workspace } = await requireWorkspace();
  return {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
}

/**
 * A number, or null for "return this one to the canon".
 *
 * A blank field is the only way to un-set an override, so blank has to mean
 * null rather than zero. `Number("")` is 0, which would have written a real
 * override of zero every time somebody cleared a box.
 */
function numberOrNull(raw: string): number | null {
  const value = raw.trim();
  return value === "" ? null : Number(value);
}

/**
 * Rebuilds a composite parameter from its parts.
 *
 * Ladders, band sets, corridors and bounds pairs are flat objects of numbers,
 * and each part arrives as its own field named `composite:<key>:<part>`. A
 * composite is written whole or not at all: a ladder with one rung filled in
 * is worse than the canon's, and the action would take it.
 *
 * **Two of them are arrays, not objects**, and the form says so in the field
 * name. `cadence.publicationCountdownDays` and
 * `sessions.quarterlyStageMinutes` are `z.array` in §11, so reassembling them
 * from `{"0": n, "1": n}` into an object would be refused by the schema. The
 * order is the part name read as an index.
 */
interface Composite {
  readonly parts: Record<string, number | null>;
  /** Whether §11 declares this one as an array. */
  readonly isList: boolean;
}

function composites(
  entries: Iterable<[string, FormDataEntryValue]>,
): Map<string, Composite> {
  const found = new Map<string, Composite>();
  for (const [field, raw] of entries) {
    if (!field.startsWith("composite:") && !field.startsWith("list:")) {
      continue;
    }
    const isList = field.startsWith("list:");
    const rest = field.slice(isList ? "list:".length : "composite:".length);
    const split = rest.lastIndexOf(":");
    if (split === -1) {
      continue;
    }
    const key = rest.slice(0, split);
    const part = rest.slice(split + 1);
    const current = found.get(key) ?? { parts: {}, isList };
    current.parts[part] = numberOrNull(String(raw));
    found.set(key, current);
  }
  return found;
}

export async function saveRhythm(
  _previous: RhythmState,
  form: FormData,
): Promise<RhythmState> {
  const overrides: Record<string, unknown> = {};
  const labels: Record<string, { singular: string; plural: string }> = {};

  for (const [field, raw] of form.entries()) {
    const value = String(raw);

    if (field.startsWith("threshold:")) {
      overrides[field.slice("threshold:".length)] = numberOrNull(value);
      continue;
    }
    if (field.startsWith("label:")) {
      const [, term, shape] = field.split(":");
      if (!term || !shape) {
        continue;
      }
      const existing = labels[term] ?? { singular: "", plural: "" };
      labels[term] = { ...existing, [shape]: value.trim() };
    }
  }

  for (const [key, { parts, isList }] of composites(form.entries())) {
    // Every part blank means "return the whole parameter to the canon". Any
    // part blank while others are filled is a half-written ladder, and the
    // canon's is better than that, so the whole thing goes back.
    const values = Object.values(parts);
    if (values.every((part) => part === null)) {
      overrides[key] = null;
      continue;
    }
    if (values.some((part) => part === null)) {
      return {
        error: `${key}: fill in every part or leave them all blank. A half-written set is worse than the canon's.`,
        saved: null,
      };
    }
    overrides[key] = isList
      ? Object.keys(parts)
          .map((part) => Number(part))
          .sort((left, right) => left - right)
          .map((index) => parts[String(index)])
      : parts;
  }

  // Only a rename with both forms filled in. A partial one is refused by the
  // action anyway, and sending it would fail the whole save over a row nobody
  // meant to touch.
  const renames = Object.fromEntries(
    Object.entries(labels).filter(
      ([, label]) => label.singular !== "" && label.plural !== "",
    ),
  );

  try {
    await callAction(await context(), "rhythm.update", {
      defaultCheckInFrequency: form.get("defaultCheckInFrequency") as
        | "daily"
        | "weekly"
        | "biweekly"
        | "monthly"
        | "quarterly",
      checkInAnchorDay: Number(form.get("checkInAnchorDay")),
      coachStrictness: form.get("coachStrictness") as
        | "advisory"
        | "warn"
        | "strict",
      overrides,
      labels: renames,
    });
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message, saved: null };
    }
    throw error;
  }

  revalidatePath("/admin/rhythm");
  const changed = Object.values(overrides).filter(
    (value) => value !== null,
  ).length;
  return {
    error: null,
    saved:
      changed === 0
        ? "Saved. Every threshold is the canon's."
        : `Saved. ${changed} threshold${changed === 1 ? "" : "s"} differ${changed === 1 ? "s" : ""} from the canon.`,
  };
}

/**
 * Returns one card's thresholds to the canon.
 *
 * Called from a button rather than submitted as a form, because the save form
 * wraps every card and a form inside a form is not markup a browser will
 * honour. The same reason the invitation revoke button is a button.
 *
 * Sent as nulls rather than as the canon's numbers, which is the difference
 * between "this workspace has no opinion" and "this workspace has chosen
 * exactly what the canon happens to say today". The second would survive a
 * change to the canon and quietly hold the old number.
 */
export async function resetGroup(
  keys: readonly string[],
): Promise<RhythmState> {
  const wanted = keys.filter((key) => key !== "");
  if (wanted.length === 0) {
    return { error: "Nothing to reset in this card.", saved: null };
  }

  try {
    await callAction(await context(), "rhythm.update", {
      overrides: Object.fromEntries(wanted.map((key) => [key, null])),
    });
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message, saved: null };
    }
    throw error;
  }

  revalidatePath("/admin/rhythm");
  return {
    ...NOTHING_SAVED,
    saved: `Returned ${wanted.length} threshold${wanted.length === 1 ? "" : "s"} to the canon.`,
  };
}
