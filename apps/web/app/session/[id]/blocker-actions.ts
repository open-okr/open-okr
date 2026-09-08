"use server";

/**
 * Raising, resolving and reassigning a blocker (§6.2 and §7.2 step 2,
 * P6-G19b).
 *
 * All three actions shipped at P4-T07c and had no caller. The stage that needs
 * them rendered nothing, and the gate below it refuses to advance while a
 * low-confidence key result has no blocker, so the weekly ritual could not be
 * finished from the browser in any week that was going badly. That is the
 * second half of what the gap audit recorded as B-10.
 */

import { callAction, OperationError } from "@openokr/core";
import { BLOCKER_TYPE_DEFINITIONS } from "@openokr/method";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/auth";
import { requireWorkspace } from "../../../lib/workspace";
import { type CommitmentState, NO_ERROR } from "./commitment-state.ts";

async function context() {
  const { session, workspace } = await requireWorkspace();
  return {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
}

/**
 * The session the page should revalidate after a blocker changed.
 *
 * `sessions.resolveBlocker` and `sessions.reassignBlocker` take the blocker's
 * own id and answer with it, so the session id travels in the form. It is used
 * for the revalidate path and nothing else: the action authorises against the
 * blocker, not against what this field says.
 */
function sessionPath(form: FormData): string {
  return `/session/${String(form.get("sessionId") ?? "")}`;
}

export async function raiseBlockerAction(
  _previous: CommitmentState,
  form: FormData,
): Promise<CommitmentState> {
  const sessionId = String(form.get("sessionId") ?? "");
  const keyResultId = String(form.get("keyResultId") ?? "");
  const type = String(form.get("type") ?? "");
  const ownerId = String(form.get("ownerId") ?? "");
  const nextAction = String(form.get("nextAction") ?? "").trim();

  // Named one at a time rather than "fill in every field", because a form
  // with four controls should say which one is empty.
  if (keyResultId === "") {
    return { error: "Name the key result this is blocking." };
  }
  // Checked against §6.2's taxonomy rather than cast. A select is not a
  // guarantee: the value arrives in a form body like any other string, and
  // `sessions.createBlocker` takes the enum.
  const known = BLOCKER_TYPE_DEFINITIONS.find((one) => one.type === type);
  if (!known) {
    return { error: "Choose what kind of blocker it is." };
  }
  if (ownerId === "") {
    return { error: "Somebody owns clearing it. §6.2 has no unowned blocker." };
  }
  if (nextAction === "") {
    return {
      error:
        "Write the next action. §7.2 gives it twenty-four hours, which needs it to be a thing somebody can do.",
    };
  }

  try {
    await callAction(await context(), "sessions.createBlocker", {
      sessionId,
      keyResultId,
      type: known.type,
      ownerId,
      nextAction,
    });
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
  revalidatePath(sessionPath(form));
  return NO_ERROR;
}

export async function resolveBlockerAction(
  _previous: CommitmentState,
  form: FormData,
): Promise<CommitmentState> {
  try {
    await callAction(await context(), "sessions.resolveBlocker", {
      id: String(form.get("blockerId") ?? ""),
    });
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
  revalidatePath(sessionPath(form));
  return NO_ERROR;
}

export async function reassignBlockerAction(
  _previous: CommitmentState,
  form: FormData,
): Promise<CommitmentState> {
  const ownerId = String(form.get("ownerId") ?? "");
  if (ownerId === "") {
    return { error: "Choose who it moves to." };
  }
  try {
    await callAction(await context(), "sessions.reassignBlocker", {
      id: String(form.get("blockerId") ?? ""),
      ownerId,
    });
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
  revalidatePath(sessionPath(form));
  return NO_ERROR;
}

/**
 * The coordinator's note on the digest (§7.2 step 4, P6-G19b).
 *
 * `sessions.setCoordinatorNote` shipped at P4-T08 and had no caller, though
 * the digest has rendered the stored note since P4-T15b: the line was there
 * and nothing could write it. §7.2's own sentence gives the note to the
 * coordinator, for leadership, which is why it sits on the digest stage rather
 * than in the minutes.
 */
export async function setCoordinatorNoteAction(
  _previous: CommitmentState,
  form: FormData,
): Promise<CommitmentState> {
  const sessionId = String(form.get("sessionId") ?? "");
  const note = String(form.get("note") ?? "").trim();
  // The action schema asks for at least one character, so an empty box would
  // come back as a Zod error rather than a sentence. There is no action for
  // clearing a note that is already written; saying so is better than a
  // control that looks as though it does.
  if (note === "") {
    return {
      error:
        "Write the note before saving it. An empty note cannot clear one already published.",
    };
  }
  try {
    await callAction(await context(), "sessions.setCoordinatorNote", {
      sessionId,
      note,
    });
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
  revalidatePath(`/session/${sessionId}`);
  return NO_ERROR;
}
