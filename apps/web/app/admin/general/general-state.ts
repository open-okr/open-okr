/**
 * What a save on the general card hands back.
 *
 * Its own module because `actions.ts` is a `"use server"` file and those may
 * export only async functions, the same split the branding card makes.
 */
export interface GeneralState {
  /** Why the save was refused, in words the administrator can act on. */
  readonly error: string | null;
  /** The confirmation. Empty before a save. */
  readonly saved: string | null;
}

export const NOTHING_SAVED: GeneralState = { error: null, saved: null };
