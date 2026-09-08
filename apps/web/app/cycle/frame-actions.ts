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
