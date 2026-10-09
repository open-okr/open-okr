"use server";

/**
 * The check-in composer's writes (P3-T07).
 *
 * The narrative is collected as plain text and becomes editor JSON through the one
 * shared constructor. Storage is always editor JSON, never Markdown. The TipTap
 * editor replaces the textarea when the goal surfaces land at P3-T10; what it
 * cannot replace is the refusal, which stays on the server.
 */
import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../lib/auth";
import { readRichTextField } from "../../lib/rich-text-form";
import { getTranslations } from "../../lib/translations";
import { requireWorkspace } from "../../lib/workspace";
import { NO_ERROR, type WriteState } from "../cycle/write-state.ts";

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
  revalidatePath("/check-in");
  revalidatePath("/cycle");
  // Publishing, acknowledging and deleting all move an obligation, so the inbox
  // and the sidebar badge it drives are recomputed with them (P3-T08).
  revalidatePath("/review");
  return NO_ERROR;
}

/**
 * Reads the per-key-result values out of the form.
 *
 * Fields are named `value:<id>` and `confidence:<id>`, so the composer can carry
 * any number of key results without the action knowing how many. A blank field is
 * omitted rather than sent as zero: leaving a value alone and setting it to zero
 * are different statements.
 */
function composerValues(formData: FormData) {
  const values = new Map<
    string,
    { keyResultId: string; value?: number; confidence?: number; done?: boolean }
  >();

  for (const [key, raw] of formData.entries()) {
    const [field, id] = key.split(":");
    // A milestone's done (METHOD.md §2.10): asked on the form, and ticked or
    // not, which a checkbox can only say by being there or absent.
    if (field === "asked" && id && raw === "done") {
      const entry = values.get(id) ?? { keyResultId: id };
      entry.done = formData.has(`done:${id}`);
      values.set(id, entry);
      continue;
    }
    if (!id || (field !== "value" && field !== "confidence")) {
      continue;
    }
    const text = String(raw).trim();
    if (text === "") {
      continue;
    }
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) {
      continue;
    }
    const entry = values.get(id) ?? { keyResultId: id };
    if (field === "value") {
      entry.value = parsed;
    } else {
      entry.confidence = parsed;
    }
    values.set(id, entry);
  }

  return [...values.values()];
}

export async function publishCheckIn(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const id = String(formData.get("checkInId") ?? "");
  // The composer's narrative is the compact editor's document since
  // guided-inputs §4.7, so what was written bold stays bold.
  const narrative = readRichTextField(formData, "narrative");

  if (narrative.state !== "document") {
    // The same refusal the action makes, said before the round trip so it lands
    // beside the empty field.
    const { t } = await getTranslations();
    return {
      error:
        narrative.state === "malformed"
          ? t("checkIn.actions.narrativeUnreadable")
          : t("checkIn.actions.needsANarrative"),
    };
  }

  return run((context) =>
    callAction(context, "goals.publishCheckIn", {
      id,
      status: String(formData.get("status") ?? "on_track") as
        | "on_track"
        | "caution"
        | "off_track",
      confidence: Number(formData.get("confidence") ?? 0.5),
      narrative: narrative.document,
      values: composerValues(formData),
    }),
  );
}

export async function editCheckIn(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const id = String(formData.get("checkInId") ?? "");
  // Left untouched, the narrative is not sent and stays as it was; emptied,
  // it stays too, since a check-in needs one.
  const narrative = readRichTextField(formData, "narrative");
  if (narrative.state === "malformed") {
    const { t } = await getTranslations();
    return { error: t("checkIn.actions.narrativeUnreadable") };
  }

  return run((context) =>
    callAction(context, "goals.editCheckIn", {
      id,
      status: String(formData.get("status") ?? "on_track") as
        | "on_track"
        | "caution"
        | "off_track",
      confidence: Number(formData.get("confidence") ?? 0.5),
      ...(narrative.state === "document"
        ? { narrative: narrative.document }
        : {}),
      values: composerValues(formData),
    }),
  );
}

export async function acknowledgeCheckIn(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const id = String(formData.get("checkInId") ?? "");
  return run((context) =>
    callAction(context, "goals.acknowledgeCheckIn", { id }),
  );
}

export async function deleteCheckIn(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const id = String(formData.get("checkInId") ?? "");
  return run((context) => callAction(context, "goals.deleteCheckIn", { id }));
}

export async function castVote(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const keyResultId = String(formData.get("keyResultId") ?? "");
  const confidence = Number(formData.get("confidence"));
  if (!Number.isFinite(confidence)) {
    const { t } = await getTranslations();
    return { error: t("checkIn.actions.voteBetweenZeroAndOne") };
  }
  return run((context) =>
    callAction(context, "goals.vote", { keyResultId, confidence }),
  );
}

export async function revealVotes(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const keyResultId = String(formData.get("keyResultId") ?? "");
  return run((context) =>
    callAction(context, "goals.revealVotes", { keyResultId }),
  );
}
