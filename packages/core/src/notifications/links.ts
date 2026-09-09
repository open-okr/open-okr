/**
 * Where a notification's subject lives, as a path (P6-G01b).
 *
 * **One map, because two surfaces address the same subject.** The inbox links
 * a row to its target and the mailed digest links a line to the same target,
 * and a digest that pointed somewhere the inbox does not would be a product
 * that disagrees with itself about where a goal is. This map was written in
 * `apps/web/app/inbox/subject-link.ts` at P6-G07a and moved here the moment the
 * digest needed it.
 *
 * `packages/core` is the right home even though a path looks like presentation.
 * A route is the product's own addressing: the command line prints these, the
 * channel messages carry them, and `blockerDraft` already builds one by hand
 * for the same reason. What stays in `apps/web` is the wording around them.
 *
 * A subject type with no entry returns null, and every caller renders without a
 * link rather than pointing at a route that answers 404. That is the honest
 * failure: a line that says what happened and cannot take you there is useful,
 * and a dead link is not.
 */

/**
 * Subject type to a path builder, or absent where the product has no screen.
 *
 * `check_in` has no id-addressable screen: `/check-in` is the composer for the
 * reader's own check-ins and a check-in is read on its goal's page, and the
 * notification carries the check-in's id rather than the goal's, so this is
 * absent rather than a guess.
 *
 * `member` is a nudge about the reader's own day, which points at the inbox the
 * row is already in.
 *
 * `blocker` has no route at all. Blockers are read inside the cycle and the
 * session rather than on a page of their own, and a blocker nudge already
 * carries the blocker's own words into its message. Pointing it at `/cycle`
 * would land the reader on the wrong phase of a nine-phase screen, which is
 * worse than no link.
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

/** The subject types this module knows how to address. For the tests. */
export const LINKED_SUBJECT_TYPES: readonly string[] = Object.keys(PATHS);

/** The path for one subject, or null when nothing addresses it. */
export function subjectPath(
  subjectType: string | null | undefined,
  subjectId: string | null | undefined,
): string | null {
  if (!subjectType || !subjectId) {
    return null;
  }
  return PATHS[subjectType]?.(subjectId) ?? null;
}

/**
 * The same path with an instance in front of it, for a message that leaves the
 * browser.
 *
 * Returns null when the subject has no path, so a caller cannot accidentally
 * mail out a bare base URL as though it were a link to something.
 */
export function subjectUrl(
  baseUrl: string,
  subjectType: string | null | undefined,
  subjectId: string | null | undefined,
): string | null {
  const path = subjectPath(subjectType, subjectId);
  if (path === null) {
    return null;
  }
  // The base may or may not carry a trailing slash, and `/goals/x` always
  // carries a leading one, so trimming here is what keeps `//goals/x` out of
  // every email the product sends.
  let end = baseUrl.length;
  while (end > 0 && baseUrl.charCodeAt(end - 1) === 47) {
    end--;
  }
  return `${baseUrl.slice(0, end)}${path}`;
}
