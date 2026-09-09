/**
 * What a rhythm save hands back (P6-G20).
 *
 * Its own module because `rhythm-actions.ts` is a `"use server"` file and
 * those may export only async functions.
 */
export interface RhythmState {
  /** The refusal, as `rhythm.update` worded it. */
  readonly error: string | null;
  /** What changed, for the line that confirms it. Empty before a save. */
  readonly saved: string | null;
}

export const NOTHING_SAVED: RhythmState = { error: null, saved: null };
