/**
 * What the commitment stage's two writes hand back (P6-G19a).
 *
 * Its own module because `commitment-actions.ts` is a `"use server"` file and
 * those may export only async functions.
 */
export interface CommitmentState {
  readonly error: string | null;
}

export const NO_ERROR: CommitmentState = { error: null };
