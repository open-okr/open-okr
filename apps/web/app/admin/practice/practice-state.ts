/**
 * What a practice card's save, reset or profile switch reports back.
 *
 * Its own module rather than inside `practice-actions.ts`, because a
 * `"use server"` file may export only async functions.
 */
export interface PracticeState {
  readonly error: string | null;
  readonly saved: string | null;
}

export const NOTHING_SAVED: PracticeState = { error: null, saved: null };
