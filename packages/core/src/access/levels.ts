/**
 * Access levels (TECHNICAL-PLAN §4.1).
 *
 * Graded rather than named roles, so overlapping grants compose by taking the
 * maximum. The numbers are spaced to leave room between them without
 * renumbering what already ships.
 *
 * The relationship model that resolves a member to a level is P2-T01 and
 * P2-T02. These constants exist now because the action registry declares the
 * level each action requires, and that declaration should not have to change
 * when the resolver behind it does.
 */
export const ACCESS_LEVELS = {
  view: 10,
  comment: 40,
  edit: 70,
  full: 100,
} as const;

export type AccessLevel = (typeof ACCESS_LEVELS)[keyof typeof ACCESS_LEVELS];
