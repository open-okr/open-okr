import { EnvironmentError, loadEnv } from "@openokr/config";
import { startRelay } from "./lib/relay";

/**
 * Node-only boot checks. Kept out of `instrumentation.ts` so the edge bundle
 * never sees `process.exit`, which the edge runtime forbids.
 */
export function validateEnvironment(): void {
  try {
    loadEnv();
  } catch (error) {
    if (error instanceof EnvironmentError) {
      process.stderr.write(`\nOpenOKR cannot start.\n\n${error.message}\n`);
      process.exit(1);
      // Unreachable in production. Tests stub process.exit, and without this
      // the error below would escape and hide the message we just wrote.
      return;
    }

    throw error;
  }
}

/**
 * Starts the outbox relay, which is what actually delivers the side effects
 * every write enqueues (P5-T01a). Called after the environment is validated,
 * because the relay needs `DATABASE_URL` and the toggle parsed.
 *
 * Failures here are logged, not fatal: a relay that cannot start is a
 * deployment that stops delivering invitations and live events, and that is
 * worse to discover through a serving outage than through a log line.
 */
export function startOutboxRelay(): void {
  // `next build` calls register() in its own workers. Those run with the
  // placeholder DATABASE_URL the Dockerfile sets and have to exit when the
  // build finishes, and the relay polls on a chained timer that would keep
  // them alive. Nothing to deliver during a build anyway.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }
  try {
    startRelay();
  } catch (error) {
    process.stderr.write(
      `relay: could not start: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}
