"use server";

/**
 * Closing last week's commitments and setting this week's (§7.2 step 3,
 * P6-G19a).
 *
 * `sessions.setCommitments` and `sessions.closeCommitments` shipped at P4-T08
 * and had no caller. The stage that uses them did not exist, which is what the
 * gap audit recorded as part of B-10: the weekly session told the room its
 * tables were already there and offered nothing that read them.
 */

import { callAction, OperationError } from "@openokr/core";
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
 * Records a delivered or not-delivered verdict on each commitment the room
 * answered.
 *
 * **Unanswered ones are left open on purpose.** A verdict nobody gave is not
 * "not delivered": it is a commitment the room ran out of time for, and it
 * comes back next week rather than being marked failed by the clock.
 */
export async function closeCommitmentsAction(
  _previous: CommitmentState,
  form: FormData,
): Promise<CommitmentState> {
  const sessionId = String(form.get("sessionId") ?? "");
  const items = form
    .getAll("verdict")
    .map((value) => String(value))
    .map((value) => {
      const [id, delivered] = value.split(":");
      return { id: id ?? "", delivered: delivered === "yes" };
    })
    .filter((item) => item.id !== "");

  if (items.length === 0) {
    return { error: "Nothing was answered, so nothing was closed." };
  }

  try {
    await callAction(await context(), "sessions.closeCommitments", { items });
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
  revalidatePath(`/session/${sessionId}`);
  return NO_ERROR;
}

/**
 * Adds this week's commitments, each with an owner and an optional key result.
 *
 * **It appends rather than replaces**, because `sessions.setCommitments`
 * inserts. That is why the stage shows what is already set and offers one more
 * row instead of the whole form again: pressing save twice on a filled form
 * would have written every commitment a second time.
 */
export async function setCommitmentsAction(
  _previous: CommitmentState,
  form: FormData,
): Promise<CommitmentState> {
  const sessionId = String(form.get("sessionId") ?? "");
  const texts = form.getAll("text").map((value) => String(value).trim());
  const owners = form.getAll("ownerId").map((value) => String(value));
  const keyResults = form.getAll("keyResultId").map((value) => String(value));

  const items = texts
    .map((text, index) => ({
      text,
      ownerId: owners[index] ?? "",
      keyResultId: keyResults[index] ?? "",
    }))
    // A row nobody filled in is a row nobody filled in, not an empty
    // commitment. An owner is required by the action, so a line of text with
    // nobody against it is refused here rather than at the schema.
    .filter((item) => item.text !== "")
    .map((item) => ({
      text: item.text,
      ownerId: item.ownerId,
      ...(item.keyResultId === "" ? {} : { keyResultId: item.keyResultId }),
    }));

  if (items.length === 0) {
    return { error: "Write at least one commitment before saving." };
  }
  const ownerless = items.find((item) => item.ownerId === "");
  if (ownerless) {
    return {
      error: `"${ownerless.text}" has nobody against it. Every commitment names one person.`,
    };
  }

  try {
    await callAction(await context(), "sessions.setCommitments", {
      sessionId,
      items,
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

/**
 * Advances the stage, and hands back the gate's own words when it refuses.
 *
 * `advanceStageAction` throws, which sends every refusal to the error
 * boundary. §7.2's gates are meant to be read: "every low-confidence key
 * result needs a blocker", "at least 2 commitments are required". This
 * wrapper is what puts them in front of the facilitator instead. It replaces
 * `advanceStageAction`, which had no other caller.
 *
 * The action returns the realtime channel name for the SSE route to publish
 * on. A server action runs in the same process as the app, so once a relay
 * host exists this is the call site for that publish; until then
 * `revalidatePath` refreshes the caller and the SSE stream carries the rest.
 */
export async function advanceStageWithReason(
  _previous: CommitmentState,
  form: FormData,
): Promise<CommitmentState> {
  const sessionId = String(form.get("sessionId") ?? "");
  try {
    await callAction(await context(), "sessions.advanceStage", {
      id: sessionId,
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
