import type { Conflict } from "../../lib/conflict.ts";

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
  /** Each refused field's message, shown under it (guided-inputs §4.2). */
  readonly fields?: Readonly<Record<string, string>>;
  /**
   * What the write did, in words, for a screen that does not otherwise show
   * it (M-05). Closing a cycle from the scorecard feeds a cycle the scorecard
   * never draws, so the sentence is the only place the reader learns where
   * the inheritance went.
   */
  readonly notice?: string | null;
  /**
   * Somebody changed a field this save changes since the form read it
   * (optimistic-concurrency.md V4). Nothing was written; the screen offers
   * keep mine and take theirs.
   */
  readonly conflict?: Conflict;
}

export const NO_ERROR: WriteState = { error: null };
