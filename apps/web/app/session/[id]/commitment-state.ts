/**
 * What the commitment stage's two writes hand back (P6-G19a).
 *
 * Its own module because `commitment-actions.ts` is a `"use server"` file and
 * those may export only async functions.
 */
export interface CommitmentState {
  readonly error: string | null;
  /** Each refused field's message, shown under it (guided-inputs §4.2). */
  readonly fields?: Readonly<Record<string, string>>;
}

export const NO_ERROR: CommitmentState = { error: null };
