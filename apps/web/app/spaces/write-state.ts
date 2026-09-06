/**
 * What a space write reports back (P6-G18a).
 *
 * Its own module because `actions.ts` carries `"use server"`, and a server
 * action module may only export async functions. The same reason the cycle
 * workspace's `write-state.ts` exists, and the same shape.
 */
export interface SpaceWriteState {
  /** A refusal in words, or null. Never a stack trace. */
  readonly error: string | null;
  /** The id a create produced, so the form can link at what it just made. */
  readonly createdId?: string;
}

export const NO_SPACE_ERROR: SpaceWriteState = { error: null };
