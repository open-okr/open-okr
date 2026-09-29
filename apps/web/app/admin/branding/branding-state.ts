/**
 * What a branding save hands back (completeness review M-14).
 *
 * Its own module because `actions.ts` is a `"use server"` file and those may
 * export only async functions, the same split the rhythm card makes.
 */
export interface BrandingState {
  /** Why the colour was refused, in words the administrator can act on. */
  readonly error: string | null;
  /** The confirmation. Empty before a save. */
  readonly saved: string | null;
}

export const NOTHING_SAVED: BrandingState = { error: null, saved: null };
