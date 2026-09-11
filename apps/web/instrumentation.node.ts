import { EnvironmentError, loadEnv } from "@openokr/config";
import { startRelay } from "./lib/relay";
import { startScheduler } from "./lib/scheduler";
import { installTelemetry } from "./lib/telemetry";

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

/**
 * Starts the scheduler, which is what runs the agents on a clock (P6-G01a).
 *
 * The relay above delivers what a write enqueued. This is the other half: work
 * that begins because an hour arrived rather than because somebody typed. Until
 * this existed, no nudge the product can produce had ever been sent without an
 * administrator pressing a button.
 *
 * Skipped during `next build` and non-fatal on failure, both for the same
 * reasons the relay is.
 */
export function startRecurringWork(): void {
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }
  try {
    startScheduler();
  } catch (error) {
    process.stderr.write(
      `scheduler: could not start: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

/**
 * Installs the meter every action is measured through (P7-T06a).
 *
 * Before the relay and the scheduler rather than after, because both of them
 * do work this instance should be able to see from its first second. Skipped
 * during `next build` for the reason the other two are: a build worker has
 * nothing to measure and should not hold a meter open.
 *
 * Constructing a meter opens no socket and reads no database. An instance
 * with `observability.metrics` off gets the driver that does nothing, which
 * is why there is no branch here.
 */
export function startTelemetry(): void {
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }
  try {
    installTelemetry();
  } catch (error) {
    // Non-fatal, and for a stronger reason than the relay's. A product that
    // refused to serve because it could not measure itself would have turned
    // an observability feature into an availability risk.
    process.stderr.write(
      `telemetry: could not start: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}
