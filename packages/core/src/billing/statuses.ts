/**
 * Which subscription statuses mean a workspace is paying (docs/design/
 * billing.md §6), in a module that imports nothing.
 *
 * The trial sweep asks it too (tenant-lifecycle.md §11, plan 0.7.0 P4), and
 * reaching it through the webhook made a cycle: the webhook imports tenancy,
 * which holds the sweep.
 */

/** Paying, or about to be. */
export const LIVE_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "trialing",
]);
