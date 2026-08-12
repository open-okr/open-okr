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
}

export const NO_ERROR: WriteState = { error: null };
