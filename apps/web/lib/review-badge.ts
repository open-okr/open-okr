import { ACCESS_LEVELS, callAction, OperationError } from "@openokr/core";
import { getPool } from "./auth";

/**
 * The number on the Review item in the sidebar (UIUX-PLAN.md §3, S-02: "drives
 * the sidebar badge", P3-T08).
 *
 * The same read the page uses, so the badge and the list can never disagree.
 * It counts what needs action now, overdue plus due today, rather than every
 * obligation: a badge that includes next week never reaches zero, and a badge
 * that never reaches zero stops being read.
 *
 * **"Live" today means recomputed on navigation and after the writes that move
 * it**, not pushed. The realtime port has no host running in the application yet
 * (P3-T07 recorded the same gap for the vote reveal), so the honest description
 * of what ships here is server-rendered on every request, with
 * `revalidatePath` from publication, acknowledgement and deletion. When the
 * relay lands, this becomes the initial value for a subscription rather than the
 * only value.
 *
 * A failure returns null and draws no badge. The sidebar is chrome on every
 * authenticated page, and a workspace whose inbox read fails should still be
 * able to reach its settings and fix it.
 */
export async function loadReviewBadge(
  workspaceId: string,
  userId: string,
  level: number,
): Promise<number | null> {
  if (level < ACCESS_LEVELS.view) {
    return null;
  }
  try {
    const inbox = await callAction(
      {
        pool: getPool(),
        workspaceId,
        actor: { kind: "human" as const, userId },
      },
      "review.inbox",
      {},
    );
    // Zero is not drawn: an empty badge beside "Review" is noise, and the page
    // itself already says "you are all caught up" to anybody who looks.
    return inbox.counts.actionable > 0 ? inbox.counts.actionable : null;
  } catch (error) {
    if (error instanceof OperationError) {
      return null;
    }
    throw error;
  }
}
