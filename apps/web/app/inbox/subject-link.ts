/**
 * Where an inbox row goes when you click it (S-03, P6-G07a).
 *
 * **Its own module, and pure, so it can be tested without a database.** The
 * acceptance criterion for this screen is that a row "deep-links to the
 * comment", and a link that is computed inline in a server component is a link
 * nothing can assert. The table below is the one place a subject type turns
 * into an address in this application.
 *
 * A subject type with no entry returns null and the row renders without a
 * link, rather than pointing at a route that answers 404. That is the honest
 * failure: a row that says what happened and cannot yet take you there is
 * useful, and a dead link is not.
 */

/**
 * Subject type to a path builder, or null where the product has no screen for
 * that subject yet.
 *
 * `check_in` has no id-addressable screen: `/check-in` is the composer for the
 * reader's own check-ins and `/goals/<id>` is where a check-in is read, so a
 * check-in notification links to nothing until its goal is known. It carries
 * the check-in's id and not the goal's, which is why this is null rather than a
 * guess.
 *
 * `member` is a nudge about the reader's own day (the morning summary), so it
 * points at the inbox it is already in, which would be a link to the current
 * page. Null.
 *
 * `blocker` has no route at all. Blockers are read inside the cycle and the
 * session rather than on a page of their own, and a blocker nudge is the one
 * kind that carries its own words into the message, so the row already says
 * what it is about. This entry is absent rather than pointed at `/cycle`,
 * because a link that lands on the wrong phase of a nine-phase screen is worse
 * than no link.
 */
const PATHS: Readonly<Record<string, (id: string) => string>> = {
  goal: (id) => `/goals/${id}`,
  initiative: (id) => `/initiatives/${id}`,
  task: (id) => `/tasks/${id}`,
  kpi: (id) => `/kpis/${id}`,
  space: (id) => `/spaces/${id}`,
  session: (id) => `/session/${id}`,
  cycle: () => "/cycle",
  document: (id) => `/documents/${id}`,
  workspace: () => "/",
};

/** The subject types this module knows how to address. For the test. */
export const LINKED_SUBJECT_TYPES = Object.keys(PATHS);

export function subjectLink(
  subjectType: string | null,
  subjectId: string | null,
): string | null {
  if (!subjectType || !subjectId) {
    return null;
  }
  return PATHS[subjectType]?.(subjectId) ?? null;
}

/** The word for a subject type, for the group heading above its rows. */
const NAMES: Readonly<Record<string, string>> = {
  goal: "Goal",
  initiative: "Initiative",
  task: "Task",
  kpi: "KPI",
  space: "Space",
  session: "Session",
  cycle: "Cycle",
  blocker: "Blocker",
  document: "Document",
  comment: "Comment",
  check_in: "Check-in",
  member: "You",
  workspace: "Workspace",
};

export function subjectName(subjectType: string | null): string {
  if (!subjectType) {
    return "Other";
  }
  return NAMES[subjectType] ?? subjectType;
}

/** What each reason means, in the words the chip shows. */
export const REASON_LABELS: Readonly<Record<string, string>> = {
  invited: "Invited",
  joined: "Joined",
  mentioned: "Mentioned",
  role: "Role change",
  review: "To review",
  check_in: "Reminder",
};
