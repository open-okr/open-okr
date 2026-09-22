/**
 * Catalogue keys rendered where a translator cannot place them (P6-G22d-a).
 *
 * **A debt that only shrinks.** Every key here is rendered immediately beside
 * an interpolation, or begins with punctuation no sentence starts with, which
 * are the two shapes of the same defect: the codemod that moved 1,543 strings
 * into the catalogue could not keep a sentence whole when an expression sat in
 * the middle of it, so it cut the sentence at the expression and made an entry
 * of each piece. A translator handed "at" has no way to know what it attaches
 * to, and the JSX around it fixes the pieces in English order whatever their
 * own language needs.
 *
 * **213 keys, 319 places, 85 files, measured 20 September 2026.** Emptying it
 * is P6-G22d-b. What this list does meanwhile is stop the pile growing: a key
 * not named here that is rendered beside a value fails the check, and a key
 * named here that no longer qualifies fails it too, so the list cannot be
 * padded and cannot go stale.
 *
 * The estimate in the plan was 187 and was made by reading the values. An
 * entry reads as a fragment when it starts lowercase, so "pending" and
 * "linked" were counted and they are labels; "Held back, because" was not
 * counted and it is a fragment. The call site is what decides.
 */
export const FRAGMENTED_MESSAGES: readonly string[] = [];
