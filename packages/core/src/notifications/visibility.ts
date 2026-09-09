import type { WorkspaceTx } from "@openokr/db";
import { getAccessScoped, hasSubjectResolver } from "../access/reads.ts";

/**
 * Whether a reader may still see what a notification is about (P6-G07a,
 * shared at P6-G01b).
 *
 * **A notification outlives the access that produced it.** Somebody watching a
 * goal in a space they are later removed from keeps every row that was written
 * while they could see it, and serving those is a slow leak of the kind the
 * access getter exists to close: the row names a subject and the subject's
 * title reaches a screen, or worse, an email.
 *
 * Two answers, needing opposite handling. A subject type the getter knows is
 * checked, and the row is dropped when the check fails. A subject type it does
 * not know has no context of its own, so the workspace floor is the whole of
 * its visibility and the reader is a member by construction: kept. That is the
 * group every nudge is about, and failing closed on it would empty both the
 * inbox and the digest of the product's own proactive messages.
 *
 * **Shared rather than copied.** It was a private function in
 * `actions/notifications.ts` until the mailed digest needed the same rule, and
 * two copies of an access decision is one copy that will be forgotten.
 */
export async function readerMaySeeSubject(
  tx: WorkspaceTx,
  workspaceId: string,
  memberId: string,
  subjectType: string | null,
  subjectId: string | null,
): Promise<boolean> {
  if (!subjectType || !subjectId) {
    // Nothing to check. The row is addressed to this member and says only that
    // something happened, which is what a row with no subject can honestly say.
    return true;
  }
  if (!hasSubjectResolver(subjectType)) {
    return true;
  }
  try {
    await getAccessScoped(tx, {
      workspaceId,
      memberId,
      resourceType: subjectType,
      resourceId: subjectId,
    });
    return true;
  } catch {
    return false;
  }
}
