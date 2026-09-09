"use server";

/**
 * Writing the annual frame (S-05, P6-G14).
 *
 * `frame.set` has been registered since P3-T02 and had no caller anywhere in
 * `apps/web`, which is the data half of what the gap audit recorded as B-03:
 * phase 0 could not be filled in from the browser at all.
 *
 * The four prose fields arrive as plain text from textareas and are wrapped
 * into editor JSON here, because that is what the column holds and what the
 * shared rich-text module validates. A member who wants formatting writes a
 * document; a mission is three sentences.
 */
import type { RichTextDocument } from "@openokr/core";
import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../lib/pool";
import { requireWorkspace } from "../../lib/workspace";
import { NO_ERROR, type WriteState } from "./write-state.ts";

/**
 * Plain text as editor JSON, or null for an empty box.
 *
 * One paragraph per line, which is the shape the editor produces for the same
 * typing and what `isValidRichText` accepts. An empty field is null rather
 * than an empty document: "we have not written a vision yet" and "our vision
 * is blank" are different answers and the column can hold both.
 */
function asDocument(value: string): RichTextDocument | null {
  const text = value.trim();
  if (text === "") {
    return null;
  }
  return {
    type: "doc",
    content: text.split(/\r?\n/).map((line) => ({
      type: "paragraph",
      ...(line.trim() === ""
        ? {}
        : { content: [{ type: "text", text: line }] }),
    })),
  };
}

export async function setFrame(
  _previous: WriteState,
  form: FormData,
): Promise<WriteState> {
  const { session, workspace } = await requireWorkspace();

  // The two lists arrive positionally, one entry per row of the fieldset, and
  // a row with no text is a row nobody filled in rather than a strategy with
  // an empty name.
  const texts = form.getAll("strategyText").map((value) => String(value));
  const notes = form.getAll("strategyNote").map((value) => String(value));
  const strategies = texts
    .map((text, index) => ({
      text: text.trim(),
      note: (notes[index] ?? "").trim(),
    }))
    .filter((entry) => entry.text !== "")
    .map((entry) => ({
      text: entry.text,
      note: entry.note === "" ? null : entry.note,
    }));

  const horizon = String(form.get("horizonLabel") ?? "").trim();

  try {
    await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "frame.set",
      {
        yearLabel: String(form.get("yearLabel") ?? "").trim(),
        horizonLabel: horizon === "" ? null : horizon,
        agreed: form.get("agreed") !== null,
        mission: asDocument(String(form.get("mission") ?? "")),
        vision: asDocument(String(form.get("vision") ?? "")),
        strategy: asDocument(String(form.get("strategy") ?? "")),
        notDoing: asDocument(String(form.get("notDoing") ?? "")),
        strategies,
      },
    );
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
  revalidatePath("/cycle");
  return NO_ERROR;
}

/**
 * Carries this cycle's scores and flagged items into the next one (S-12,
 * P6-G16).
 *
 * `cycles.feedForward` has been registered since P3-T15 with no caller. It
 * takes both cycle ids, so the next one has to exist: `cycles.ensureCurrent`
 * is what creates it when the calendar has moved on, and calling that first is
 * why this action can be pressed without choosing anything.
 *
 * Idempotent, which the button's own copy promises. Running it twice changes
 * nothing, so a facilitator unsure whether it worked can press it again rather
 * than going to look in the database.
 */
export async function runFeedForward(
  _previous: WriteState,
  form: FormData,
): Promise<WriteState> {
  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  const fromCycleId = String(form.get("fromCycleId") ?? "");

  try {
    const next = await callAction(context, "cycles.ensureCurrent", {});
    if (next.id === fromCycleId) {
      return {
        error:
          "The next cycle has not started yet, so there is nowhere to carry these into.",
      };
    }
    await callAction(context, "cycles.feedForward", {
      fromCycleId,
      toCycleId: next.id,
    });
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
  revalidatePath("/cycle");
  return NO_ERROR;
}

/**
 * Opens a quarterly objective under an annual one (§2.1, P6-G14b).
 *
 * **Not a new action, and deliberately.** Sending an annual objective forward
 * is creating a quarterly objective parented to it, which `goals.create`
 * already does: the parent pointer is the link the alignment engine reads, and
 * a second way to write it would be a second thing to keep correct.
 *
 * The title is copied and the champion carried over, because the room that
 * agreed the annual objective is the room deciding this, and a blank form in
 * front of them is a worse start than an editable copy.
 *
 * **The quarter is asked for by name.** `cycles.ensureCurrent` defaults to the
 * most recent cycle's cadence, and a workspace that has just opened an annual
 * cycle for its frame has an annual one as its most recent, so a bare call
 * here built the annual period containing today and put "this quarter's
 * objective" in it. Found by the test that counted what came back.
 */
export async function sendForward(
  _previous: WriteState,
  form: FormData,
): Promise<WriteState> {
  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  const goalId = String(form.get("goalId") ?? "");
  const title = String(form.get("title") ?? "").trim();
  const championId = String(form.get("championId") ?? "");
  const reviewerId = String(form.get("reviewerId") ?? "");

  if (title === "") {
    return { error: "The quarterly objective needs a title." };
  }

  try {
    const quarter = await callAction(context, "cycles.ensureCurrent", {
      cadence: "quarterly",
    });
    await callAction(context, "goals.create", {
      title,
      cycleId: quarter.id,
      level: "company",
      ownerKind: "workspace",
      championId,
      reviewerId,
      parentGoalId: goalId,
      weight: 1,
    });
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
  revalidatePath("/cycle");
  return NO_ERROR;
}

/**
 * Says which strategy an annual objective serves (§2.1, P6-G14b).
 *
 * On phase 0 rather than on the goal page, because the strategies are here:
 * choosing one means reading them, and a picker on the goal page would show
 * five sentences out of the context that makes them mean anything.
 */
export async function linkToStrategy(
  _previous: WriteState,
  form: FormData,
): Promise<WriteState> {
  const { session, workspace } = await requireWorkspace();
  const chosen = String(form.get("strategyId") ?? "");

  try {
    await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "goals.update",
      {
        id: String(form.get("goalId") ?? ""),
        // Empty means "serving nothing named", which is a real answer and the
        // one §2.1 wants surfaced rather than quietly kept.
        strategyId: chosen === "" ? null : chosen,
      },
    );
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
  revalidatePath("/cycle");
  return NO_ERROR;
}
