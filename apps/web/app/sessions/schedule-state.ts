/**
 * What a scheduling write reports back (completeness review H-08).
 *
 * Its own module because `schedule-actions.ts` carries `"use server"`, and a
 * server action module may only export async functions.
 */
export interface ScheduleState {
  /** A refusal in words, or null. Never a stack trace. */
  readonly error: string | null;
  /** What was booked, in words, or null before anything was tried. */
  readonly notice: string | null;
  /** What the cycle still lacks after booking: only weeks already gone. */
  readonly details: readonly string[];
}

export const NO_SCHEDULE: ScheduleState = {
  error: null,
  notice: null,
  details: [],
};
