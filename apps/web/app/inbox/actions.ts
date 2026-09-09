"use server";

/**
 * The inbox's three writes (S-03, P6-G07a).
 *
 * Mark read, snooze and mute. All three already existed in the registry and
 * none had a caller: `notifications.markRead`, `notifications.snooze` and
 * `subscriptions.toggle` were built at P2-T06 and the screen that would press
 * them was never built, which is what the gap audit of 7 September 2026
 * recorded as B-06.
 *
 * The refusal comes from the action rather than from here, so a member whose
 * access to a subject changed between the page rendering and the button being
 * pressed is told why instead of silently succeeding.
 *
 * Both paths are revalidated on every one of them: the list loses or moves a
 * row, and the sidebar badge counts differently. `/` too, because the overview
 * links to the inbox and shows the same count.
 */
import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../lib/auth";
import { requireWorkspace } from "../../lib/workspace";
import { NO_ERROR, type WriteState } from "../cycle/write-state.ts";

function revalidateInbox(): void {
  revalidatePath("/inbox");
  revalidatePath("/");
}

export async function markRead(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const notificationId = String(formData.get("notificationId") ?? "");
  const { session, workspace } = await requireWorkspace();
  try {
    await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "notifications.markRead",
      { notificationId },
    );
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
  revalidateInbox();
  return NO_ERROR;
}

export async function snooze(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const notificationId = String(formData.get("notificationId") ?? "");
  const untilMinutes = Number(formData.get("untilMinutes") ?? 0);
  const { session, workspace } = await requireWorkspace();
  try {
    await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "notifications.snooze",
      { notificationId, untilMinutes },
    );
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
  revalidateInbox();
  return NO_ERROR;
}

/**
 * Stop new rows about one subject, and keep the ones already here.
 *
 * "Mute" is `subscriptions.toggle` with `subscribe: false`, which cancels the
 * subscription rather than deleting it. That is what makes muting reversible
 * and what makes the history survive it: the rows already written are not the
 * subscription, and a member who mutes a noisy goal is asking about the future.
 */
export async function mute(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const subjectType = String(formData.get("subjectType") ?? "");
  const subjectId = String(formData.get("subjectId") ?? "");
  const subscribe = String(formData.get("subscribe") ?? "") === "true";
  const { session, workspace } = await requireWorkspace();
  try {
    await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "subscriptions.toggle",
      { subjectType, subjectId, subscribe },
    );
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
  revalidateInbox();
  return NO_ERROR;
}
