import { checkIns, cycles, goals } from "@openokr/db";
import { isNull, ne, or, type SQL, sql } from "drizzle-orm";

/**
 * Which open check-ins still owe an acknowledgement (METHOD.md §2.5).
 *
 * One per goal, on its latest published check-in. The review inbox and the
 * acknowledgement ladder both ask this, and two copies of the rule would be one
 * copy that drifts: the inbox would list a debt the ladder no longer chases, or
 * the reverse.
 *
 * Each condition reads `check_ins`, `goals` and `cycles` from the outer query,
 * so the caller joins `goals` on the check-in's subject and left-joins `cycles`
 * on the goal's cycle.
 */

/**
 * No later published check-in on the same goal. A backlog left behind a later
 * check-in, acknowledged or not, is covered by it: the latest says where the
 * goal stands, and acknowledging it closes the rest.
 */
export function isLatestPublishedOnGoal(): SQL {
  return sql`not exists (
    select 1 from check_ins later
     where later.workspace_id = ${checkIns.workspaceId}
       and later.subject_id = ${checkIns.subjectId}
       and later.state = 'published'
       and later.deleted_at is null
       and later.published_at > ${checkIns.publishedAt}
  )`;
}

/** The goal is open, and so is its cycle, where it has one. */
export function goalStillOpen(): SQL {
  return sql`${isNull(goals.closedAt)} and ${or(
    isNull(goals.cycleId),
    ne(cycles.status, "closed"),
  )}`;
}

/** How many earlier check-ins on the same goal are still open behind this one. */
export function earlierOpenOnGoal(): SQL<number> {
  return sql<number>`(
    select count(*)::int from check_ins earlier
     where earlier.workspace_id = ${checkIns.workspaceId}
       and earlier.subject_id = ${checkIns.subjectId}
       and earlier.state = 'published'
       and earlier.deleted_at is null
       and earlier.acknowledged_at is null
       and earlier.published_at < ${checkIns.publishedAt}
  )`;
}

/**
 * Published within the acknowledgement window (§11, OKRGoal UX review H4).
 * Older than that, an unacknowledged check-in has lapsed: the inbox stops
 * listing it and the ladder stops asking, and nothing records it as given.
 */
export function withinAcknowledgementWindow(now: Date, days: number): SQL {
  return sql`${checkIns.publishedAt} > ${new Date(now.getTime() - days * 86_400_000)}`;
}
