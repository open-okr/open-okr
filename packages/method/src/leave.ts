/**
 * METHOD.md §7.4, a member's leave (P9-T19b-b, the Northwind year's gap G-2).
 *
 * "A member marks their own leave, with a delegate. While they are away
 * nobody nudges them, their reviews and acknowledgements go to the delegate,
 * and a check-in on a goal they champion is the delegate's to post, so their
 * absence never breaks the space's streak."
 *
 * Pure, so who stands in for whom on a given day is decided once, here, and
 * the nudge engine and the check-in's reviewer of record cannot disagree.
 * Dates are local `YYYY-MM-DD` strings, both days included.
 */

export interface Leave {
  readonly memberId: string;
  readonly startsOn: string;
  readonly endsOn: string;
  /** Who stands in while they are away. */
  readonly delegateId: string;
}

/**
 * The rules a delegate takes over: the check-in on a goal the absent member
 * champions, and the review and acknowledgement of one they would have
 * received. Every other nudge to somebody away is held, not passed on.
 */
export const DELEGATED_TRIGGERS: readonly string[] = [
  "checkin.due_soon",
  "checkin.due",
  "checkin.overdue",
  "checkin.stale",
  "ack.owed",
  "ack.overdue",
];

/** The leave a member is on that day, or null. */
export function leaveOn(
  memberId: string,
  on: string,
  leaves: readonly Leave[],
): Leave | null {
  return (
    leaves.find(
      (leave) =>
        leave.memberId === memberId &&
        leave.startsOn <= on &&
        on <= leave.endsOn,
    ) ?? null
  );
}

/**
 * Who answers for a member that day: the member, or their delegate, or the
 * delegate's own delegate when the delegate is away too. Null when the chain
 * comes back round or runs out, because handing an obligation to somebody
 * who is also away is the silence leave exists to prevent.
 */
export function standInFor(
  memberId: string,
  on: string,
  leaves: readonly Leave[],
): string | null {
  const seen = new Set<string>();
  let current = memberId;
  // Bounded by the people in the chain: each is visited once.
  for (;;) {
    const away = leaveOn(current, on, leaves);
    if (!away) {
      return current;
    }
    seen.add(current);
    if (seen.has(away.delegateId)) {
      return null;
    }
    current = away.delegateId;
  }
}
