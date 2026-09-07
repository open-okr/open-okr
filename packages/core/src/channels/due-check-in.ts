/**
 * The check-in a member is being asked for (P5-T04b-b).
 *
 * **Because nobody reading a message on a phone knows a goal's identifier.** The
 * `checkin` command took one from the start, which is fine in a browser where a
 * link carries it and fine in a chat where somebody pasted it. It is not fine as
 * the answer to a reminder: WhatsApp has no buttons, so the reminder is words,
 * and "reply CHECKIN" has to work.
 *
 * **One or none, never a guess.** A champion with two goals due gets told to say
 * which. Picking the older one would be the product deciding what somebody meant
 * about the thing it is asking them to be honest about.
 *
 * This is not WhatsApp's own: the same reply works in Slack, Teams and Telegram,
 * and it is a better command in all four.
 */
import { activeOnly, goals, type WorkspaceTx } from "@openokr/db";
import { asc, eq, isNotNull, isNull, lte } from "drizzle-orm";

export type DueCheckIn =
  | { readonly kind: "one"; readonly goalId: string; readonly title: string }
  /** None due, which is a good answer rather than a failure. */
  | { readonly kind: "none" }
  | { readonly kind: "several"; readonly titles: readonly string[] };

/**
 * The goals this member champions whose check-in is due.
 *
 * Due means the cadence says so: `next_check_in_at` has passed. A closed goal
 * keeps its cadence and stops being asked about, which is why `closed_at` is in
 * the filter rather than the health band: a goal can be off track and still owe
 * a check-in, and that is exactly when one matters most.
 */
export async function dueCheckInFor(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly memberId: string;
    readonly now: Date;
  },
): Promise<DueCheckIn> {
  const rows = await tx
    .select({ id: goals.id, title: goals.title })
    .from(goals)
    .where(
      activeOnly(
        goals,
        eq(goals.workspaceId, input.workspaceId),
        eq(goals.championId, input.memberId),
        isNotNull(goals.nextCheckInAt),
        lte(goals.nextCheckInAt, input.now),
        // A closed goal keeps its cadence and stops being asked about.
        isNull(goals.closedAt),
      ),
    )
    .orderBy(asc(goals.nextCheckInAt))
    .limit(5);

  if (rows.length === 0) {
    return { kind: "none" };
  }
  if (rows.length > 1) {
    return {
      kind: "several",
      titles: rows.map((row) => row.title),
    };
  }
  const only = rows[0] as { id: string; title: string };
  return { kind: "one", goalId: only.id, title: only.title };
}
