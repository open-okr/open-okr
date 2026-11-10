/**
 * Which review minutes a closed cycle links to (sessions.md §9, S-12 phase 7,
 * release 0.7.0 S3).
 *
 * The only link to the minutes was on the session page, so a reader arriving
 * at a closed cycle had to know which space held its review and find the
 * session there. This picks them out of the sessions the reader can already
 * see, so the cycle cannot link to a review its reader may not open.
 *
 * - One link per review. A workspace that holds the review and the
 *   retrospective apart has two sessions for one review, and either half's
 *   minutes are the whole review's (`sessions.minutes`), so the link goes to
 *   the review half, or to the retrospective when the review half is not
 *   visible.
 * - Only a review somebody held. A booked review that never started has
 *   empty minutes, and a link to an empty record reads as a lost one.
 */

export interface CycleSession {
  readonly id: string;
  readonly cycleId: string | null;
  readonly kind: string;
  readonly title: string;
  readonly spaceName: string;
  readonly state: string;
  readonly reviewPart: "review" | "retrospective" | null;
  readonly reviewSessionId: string | null;
  readonly scheduledFor: string;
  readonly startedAt: string | null;
}

interface ReviewMinutesLink {
  readonly sessionId: string;
  readonly title: string;
  readonly spaceName: string;
  /** When the review first started. */
  readonly heldOn: string;
}

export function reviewMinutesFor(
  cycleId: string,
  sessions: readonly CycleSession[],
): ReviewMinutesLink[] {
  const reviews = sessions.filter(
    (one) =>
      one.cycleId === cycleId &&
      one.kind === "quarterly" &&
      one.state !== "skipped",
  );
  const byId = new Map(reviews.map((one) => [one.id, one]));

  const groups = new Map<string, CycleSession[]>();
  for (const one of reviews) {
    const key =
      one.reviewPart === "retrospective" && one.reviewSessionId
        ? one.reviewSessionId
        : one.id;
    groups.set(key, [...(groups.get(key) ?? []), one]);
  }

  const links: ReviewMinutesLink[] = [];
  for (const [key, halves] of groups) {
    const held = halves
      .map((one) => one.startedAt)
      .filter((at): at is string => at !== null)
      .sort();
    const first = held[0];
    if (first === undefined) {
      continue;
    }
    const target = byId.get(key) ?? halves[0];
    if (!target) {
      continue;
    }
    links.push({
      sessionId: target.id,
      title: target.title,
      spaceName: target.spaceName,
      heldOn: first,
    });
  }
  return links.sort((left, right) => left.heldOn.localeCompare(right.heldOn));
}
