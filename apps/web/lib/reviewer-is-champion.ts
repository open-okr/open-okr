/**
 * Whether one person both champions and reviews a goal (plan 0.7.0, O3).
 *
 * okr-core-domain.md §4.1: warned, never refused, because a one-person team
 * has no other option. METHOD.md §2.5 asks for a different person where
 * possible and makes no rule of it, so this is a plain warning rather than a
 * quality check. It is derived from the two ids alone, so every screen that
 * sets or shows both says the same thing and nothing has to store it.
 *
 * Kept apart from the note that renders it, because a server component cannot
 * call a function exported from a client module.
 */
export function reviewerIsChampion(
  championId: string | null | undefined,
  reviewerId: string | null | undefined,
): boolean {
  return (
    championId !== null &&
    championId !== undefined &&
    championId !== "" &&
    reviewerId === championId
  );
}
