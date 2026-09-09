/**
 * How long a snooze lasts, and what the button says (S-03, P6-G07a).
 *
 * Its own module because `actions.ts` carries `"use server"` and such a module
 * may export nothing but async functions. The same reason `spaces/write-state.ts`
 * exists (P6-G18a).
 *
 * Three choices rather than a picker. `notifications.snooze` takes minutes, and
 * a reader deciding how long to be left alone is choosing between "not now",
 * "not today" and "not this week", not entering a duration.
 */
export const SNOOZE_CHOICES = [
  { minutes: 60, label: "1 hour" },
  { minutes: 60 * 24, label: "Tomorrow" },
  { minutes: 60 * 24 * 7, label: "Next week" },
] as const;
