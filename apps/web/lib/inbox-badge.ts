import { ACCESS_LEVELS, callAction, OperationError } from "@openokr/core";
import { getPool } from "./auth";

/**
 * The number on the Inbox item in the sidebar (UIUX-PLAN.md §3, S-03,
 * P6-G07a).
 *
 * A sibling of `loadReviewBadge` and deliberately identical in shape, so the
 * two numbers beside each other in the primary block behave the same way and
 * neither can quietly become the exception.
 *
 * It counts unread and unsnoozed, which is the same set the screen's default
 * view lists, so the badge and the list cannot disagree. A snoozed row is not
 * counted: a snooze that left the badge standing would be a snooze that did
 * nothing the reader asked for.
 *
 * **"Live" today means recomputed on navigation and after the writes that move
 * it**, not pushed, for the reason `review-badge.ts` records at length: the
 * realtime port has a host for the board and the session and not for the shell.
 * `revalidatePath("/inbox")` from mark-read, snooze and mute is what moves it,
 * and the subscription that makes it push is P6-G07b.
 *
 * A failure returns null and draws no badge. The sidebar is chrome on every
 * authenticated page, and a workspace whose notification read fails should
 * still be able to reach its settings and fix it.
 */
export async function loadInboxBadge(
  workspaceId: string,
  userId: string,
  level: number,
): Promise<number | null> {
  if (level < ACCESS_LEVELS.view) {
    return null;
  }
  try {
    const { unread } = await callAction(
      {
        pool: getPool(),
        workspaceId,
        actor: { kind: "human" as const, userId },
      },
      "notifications.unreadCount",
      {},
    );
    // Zero is not drawn, for the same reason Review's is not: an empty badge
    // beside the word "Inbox" is noise, and the page says "nothing new" to
    // anybody who looks.
    return unread > 0 ? unread : null;
  } catch (error) {
    if (error instanceof OperationError) {
      return null;
    }
    throw error;
  }
}
