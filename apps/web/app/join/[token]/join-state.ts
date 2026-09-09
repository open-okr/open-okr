/**
 * What the join form gets back (P6-G06b).
 *
 * Its own module because `actions.ts` carries `"use server"`, and such a
 * module may export nothing but async functions. The same reason
 * `account/channels/link-state.ts` and `cycle/write-state.ts` exist.
 */
export interface JoinState {
  readonly error: string | null;
}

export const NO_ERROR: JoinState = { error: null };
