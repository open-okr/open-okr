/**
 * The account that claims the application instance in the end-to-end run.
 *
 * **Why one shared constant rather than a constant per spec.** The suite runs
 * `workers: 1, fullyParallel: false` against a single application instance that
 * `e2e/prepare-database.ts` deliberately leaves unclaimed, "so it stays open
 * until a spec claims it". Whichever spec runs first claims it, registration
 * closes behind them, and every later spec can only sign in as that same
 * person. Files run alphabetically, so today that is
 * `registration-to-dashboard.spec.ts`.
 *
 * That coupling already existed and was invisible: `sessions.spec.ts` was
 * written for a developer's own machine, where its author had run the wizard
 * with `session-qa@example.com`, and it signed in with that address. On
 * continuous integration the instance belongs to somebody else, so the sign-in
 * failed and the whole file failed with it, from the day it landed. The
 * passwords were already identical; only the address differed, which is exactly
 * the kind of accidental agreement a shared constant turns into a real one.
 *
 * The first-run wizard spec is not a caller. It runs against its own separate
 * instance, one that has never been set up, which is the entire point of the
 * second database.
 */

/** The person every application-instance spec signs in as. */
export const INSTANCE_ACCOUNT = {
  email: "ada@example.com",
  password: "correct horse battery staple",
  name: "Ada Lovelace",
} as const;
