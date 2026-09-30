/**
 * What a cycle workspace write reports back.
 *
 * Its own module because `actions.ts` carries `"use server"`, and a server
 * action module may only export async functions. The shared shape and its
 * initial value therefore cannot live there, even though that is where they are
 * produced.
 */
export interface WriteState {
  /** A refusal in words, or null. Never a stack trace. */
  readonly error: string | null;
  /**
   * What the write did, in words, for a screen that does not otherwise show
   * it (M-05). Closing a cycle from the scorecard feeds a cycle the scorecard
   * never draws, so the sentence is the only place the reader learns where
   * the inheritance went.
   */
  readonly notice?: string | null;
}

export const NO_ERROR: WriteState = { error: null };
