/**
 * The trial's two outbox topics (docs/design/tenant-lifecycle.md §11 Q2, plan
 * 0.7.0 P4c), in a module that imports nothing.
 *
 * The outbox handler table reads them when it is built, and the trial sweep
 * imports billing, which reaches back to the handlers: a topic defined in the
 * sweep's own module read as undefined there, and the table filed both
 * handlers under "undefined".
 */

/** The reminder seven days before a trial ends. */
export const TRIAL_REMINDER_TOPIC = "workspace.trialReminder";
/** What the end of a trial did. */
export const TRIAL_ENDED_TOPIC = "workspace.trialEnded";
