"use server";

/**
 * The review inbox's writes (P3-T08, M-08).
 *
 * S-02 promises "a one-click action" on every row, and for an acknowledgement
 * that is the whole interaction: there is nothing to type. The refusal still
 * comes from the action rather than from this file, so a member who lost the
 * reviewer role between the page rendering and the button being pressed is told
 * why instead of silently succeeding.
 *
 * Three paths are revalidated because one acknowledgement changes all three: the
 * inbox loses a row, the goal's timeline gains an acknowledged stamp, and the
 * sidebar badge counts one fewer.
 */
import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../lib/auth";
import { requireWorkspace } from "../../lib/workspace";
import { NO_ERROR, type WriteState } from "../cycle/write-state.ts";

export async function acknowledge(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const id = String(formData.get("checkInId") ?? "");
  const { session, workspace } = await requireWorkspace();
  try {
    await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "goals.acknowledgeCheckIn",
      { id },
    );
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
  revalidatePath("/review");
  revalidatePath("/check-in");
  revalidatePath("/");
  return NO_ERROR;
}

/**
 * Apply or dismiss one agent proposal, where the inbox listed it
 * (completeness review M-08).
 *
 * The row used to link to `/admin/agents`, which refuses anybody below `full`,
 * so an ordinary member was told they owed a decision and could not reach it.
 * One form with two buttons, because a proposal has exactly two answers and
 * either one takes it off the list. The refusal comes from the action, as the
 * acknowledgement's does: a proposal somebody else decided a moment ago, or a
 * proposed change the member may not make, is explained rather than swallowed.
 *
 * Revalidated like an acknowledgement, and for the same three reasons: the
 * inbox loses a row, whatever the change touched may be on the Work Map, and
 * the sidebar badge counts one fewer.
 *
 * **The button pressed is required, never assumed.** It arrives as the
 * submitter's `decision`. A post that names neither answer is refused rather
 * than read as an apply, because the one default a write must not have is
 * "go ahead".
 */
export async function decideProposal(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const id = String(formData.get("proposalId") ?? "");
  const decision = formData.get("decision");
  if (decision !== "apply" && decision !== "dismiss") {
    throw new Error(
      "A proposal is applied or dismissed, and this said neither.",
    );
  }
  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  try {
    if (decision === "dismiss") {
      await callAction(context, "proposals.dismiss", { id });
    } else {
      await callAction(context, "proposals.apply", { id });
    }
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
  revalidatePath("/review");
  revalidatePath("/check-in");
  revalidatePath("/");
  return NO_ERROR;
}

/**
 * Snooze the nudges about one subject, without touching what is owed.
 *
 * Takes its arguments directly rather than through a `FormData`, because the
 * provenance list is a client component with a button per row and nothing to
 * type. Only the inbox path is revalidated: the obligation list does not move,
 * and that is the behaviour rather than an oversight.
 */
export async function snoozeNudge(
  nudgeId: string,
  until: string,
): Promise<void> {
  const { session, workspace } = await requireWorkspace();
  await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "nudges.snooze",
    { nudgeId, until },
  );
  revalidatePath("/review");
}
