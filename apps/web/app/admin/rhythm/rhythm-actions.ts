"use server";

/**
 * Saving the §11 registry for one workspace (P6-G20).
 *
 * **The refusal used to be swallowed.** The previous version of this save
 * caught `OperationError` and returned, so an out-of-range threshold looked
 * exactly like a successful save: the page came back unchanged and said
 * nothing. `rhythm.update` refuses with the key and the bound in the sentence,
 * and this is what carries that sentence to the screen.
 */

import { callAction } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/auth";
import { refusalFields } from "../../../lib/refusal";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import type { RhythmState } from "./rhythm-state.ts";

/**
 * A refused save as the card reads it, or null for a failure.
 *
 * The card already puts a refusal under the parameter it names: it reads the
 * key from a sentence written `${key}: ${message}`, as `rhythm.update` words
 * its own (P8-G11a). A schema's refusal, which used to reach the error page,
 * is written the same way here when its path is one parameter's override, so
 * it lands under that parameter too (guided-inputs §4.2, plan U1b). A key is
 * `group.name`, so the path's second and third parts are the key.
 */
function refusedParameter(
  error: unknown,
  t: Awaited<ReturnType<typeof getTranslations>>["t"],
): string | null {
  const refusal = refusalFields(error, t);
  if (refusal === null) {
    return null;
  }
  for (const [path, message] of Object.entries(refusal.fields)) {
    const [root, group, name] = path.split(".");
    if (root === "overrides" && group && name) {
      return `${group}.${name}: ${message}`;
    }
  }
  return refusal.message;
}

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

/**
 * Saves whatever the submitted form carries, and nothing else (P8-G11).
 *
 * The page is one form with one save bar, so every card arrives at once and
 * is written or refused as one. **Every field of `rhythm.update` is optional
 * and `overrides` merges**, so the payload is still built from what arrived
 * rather than read at fixed names: a form that holds no cadence dropdown
 * sends no cadence setting.
 *
 * "Reset to defaults" on a card is not a server call. It blanks that card's
 * fields in the browser and this save then sends each blank as `null`, which
 * is the difference between having no opinion and having chosen today's
 * default and keeping it after the canon moves.
 */
export async function saveRhythm(
  _previous: RhythmState,
  form: FormData,
): Promise<RhythmState> {
  const { t } = await getTranslations();
  const overrides: Record<string, unknown> = {};
  const labels: Record<string, { singular: string; plural: string }> = {};
  /** This workspace's own word list terms, per list (P8-G11b). */
  const words = new Map<string, Record<string, readonly string[]>>();
  let sawThreshold = false;
  let sawLabel = false;

  for (const [field, raw] of form.entries()) {
    const value = String(raw);

    if (field.startsWith("threshold:")) {
      overrides[field.slice("threshold:".length)] = numberOrNull(value);
      sawThreshold = true;
      continue;
    }
    // `words:<key>:<list>`, a comma-separated line of this workspace's own
    // terms. **Added to the method's, never instead of them**: §11 words the
    // parameter as "a workspace may add terms; the canon terms remain", and
    // `resolveThresholds` merges for that reason, so an empty box here means
    // "this workspace adds nothing to that list" rather than "empty that
    // list". A workspace cannot switch a quality rule off from this screen,
    // and that is the method's decision rather than this form's.
    if (field.startsWith("words:")) {
      const rest = field.slice("words:".length);
      const split = rest.lastIndexOf(":");
      if (split !== -1) {
        const key = rest.slice(0, split);
        const list = rest.slice(split + 1);
        const terms = value
          .split(",")
          .map((term) => term.trim().toLowerCase())
          .filter((term) => term !== "");
        const held = words.get(key) ?? {};
        // Deduplicated, because "ship, Ship" is one term typed twice and
        // storing both would show the reader a list that repeats itself.
        held[list] = [...new Set(terms)];
        words.set(key, held);
        sawThreshold = true;
      }
      continue;
    }
    if (field.startsWith("label:")) {
      const [, term, shape] = field.split(":");
      if (!term || !shape) {
        continue;
      }
      const existing = labels[term] ?? { singular: "", plural: "" };
      labels[term] = { ...existing, [shape]: value.trim() };
      sawLabel = true;
    }
  }

  for (const [key, { parts, isList }] of composites(form.entries())) {
    sawThreshold = true;
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
        error: `${key}: fill in every part or leave them all blank. A half-written set is worse than the default.`,
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

  for (const [key, lists] of words) {
    // Every list empty means this workspace adds nothing, which is the same
    // thing as having no opinion, so the whole parameter goes back rather
    // than being stored as a map of empty arrays.
    overrides[key] = Object.values(lists).some((terms) => terms.length > 0)
      ? lists
      : null;
  }

  // Only a rename with both forms filled in. A partial one is refused by the
  // action anyway, and sending it would fail the whole save over a row nobody
  // meant to touch.
  const renames = Object.fromEntries(
    Object.entries(labels).filter(
      ([, label]) => label.singular !== "" && label.plural !== "",
    ),
  );

  // Absent means "this card does not hold that setting", which is different
  // from "set it to nothing". Only what arrived is sent.
  const patch: Parameters<typeof callAction<"rhythm.update">>[2] = {};
  if (form.has("defaultCheckInFrequency")) {
    patch.defaultCheckInFrequency = String(
      form.get("defaultCheckInFrequency"),
    ) as "daily" | "weekly" | "biweekly" | "monthly" | "quarterly";
  }
  if (form.has("checkInAnchorDay")) {
    patch.checkInAnchorDay = Number(form.get("checkInAnchorDay"));
  }
  if (sawThreshold) {
    patch.overrides = overrides;
  }
  if (sawLabel) {
    patch.labels = renames;
  }

  if (Object.keys(patch).length === 0) {
    return { error: t("admin.rhythm.actions.nothingToSave"), saved: null };
  }

  try {
    await callAction(await context(), "rhythm.update", patch);
  } catch (error) {
    const refused = refusedParameter(error, t);
    if (refused === null) {
      throw error;
    }
    return { error: refused, saved: null };
  }

  revalidatePath("/admin/rhythm");
  // A rename is read on every screen, starting with the sidebar and the root
  // layout's catalogue, so the whole tree is stale rather than this page (M-14).
  if (sawLabel) {
    revalidatePath("/", "layout");
  }

  // Counted over what was submitted. A form carrying no threshold at all gets
  // the plain confirmation instead of "every threshold is the canon's", which
  // would be a claim about fields it never saw.
  if (!sawThreshold) {
    return { error: null, saved: t("admin.rhythm.actions.saved") };
  }
  const changed = Object.values(overrides).filter(
    (value) => value !== null,
  ).length;
  return {
    error: null,
    saved:
      changed === 0
        ? t("admin.rhythm.actions.savedAllDefault")
        : t("admin.rhythm.actions.savedDiffer", { count: changed }),
  };
}
