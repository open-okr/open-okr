import { EnvironmentError, loadEnv } from "@openokr/config";
import { quietAbandonedResponses } from "./lib/abandoned-responses";
import { installAdmission } from "./lib/admission";
import { resolveSignupPolicy } from "./lib/auth";
import { announceCallerAddress } from "./lib/caller-address";
import { installErrorReports } from "./lib/error-reporting";
import { installPromptEvaluator } from "./lib/prompt-evaluation";
import { startRelay } from "./lib/relay";
import { startScheduler } from "./lib/scheduler";
import { installShutdown } from "./lib/shutdown";
import { resolveSSOProviders } from "./lib/sso";
import { installStatusThresholds } from "./lib/status-thresholds";
import { installTelemetry } from "./lib/telemetry";
import { tenantFloor } from "./lib/tenant-floor";

/**
 * Takes SIGTERM and SIGINT, so a stop drains the work in flight rather than
 * dropping it (plan 0.8.0 H10a, docs/design/worker-deployment.md D4).
 * `lib/shutdown.ts` says why the server owns the signal rather than Next.
 *
 * Skipped during `next build`: a build worker is stopped by its parent with a
 * signal, and a handler that does not exit there (the build sets no
 * NEXT_MANUAL_SIG_HANDLE) would keep it alive. It has nothing to drain anyway.
 */
export function takeSignals(): void {
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }
  installShutdown();
}

/**
 * Keeps responses the browser cancelled out of the error log (completeness
 * review L-04). `lib/abandoned-responses.ts` says why this is the log's
 * problem and not the renderer's.
 */
export function quietCancelledResponses(): void {
  quietAbandonedResponses();
}

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

/**
 * Installs error reporting (docs/design/error-reporting.md, plan 0.7.0 E1):
 * the release and region every report carries, and the process's own
 * last-resort hooks. Sends nothing anywhere; the log line and the counter
 * are local.
 *
 * Skipped during `next build` like the meter, and non-fatal for the meter's
 * reason: a product that refused to serve because it could not report its
 * errors would have made reporting the outage.
 */
export function startErrorReporting(): void {
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }
  try {
    installErrorReports();
  } catch (error) {
    process.stderr.write(
      `errors: could not start reporting: ${error instanceof Error ? error.name : "unknown"}\n`,
    );
  }
}

/**
 * Installs the evaluation set that gates a new prompt version (plan 0.7.0 A9,
 * docs/design/ai-evaluation.md §7).
 *
 * Pure: it reads nothing and opens nothing, so it is installed in every phase
 * and cannot fail the boot. Before the first request, because until it is in
 * place `ai.updatePrompt` refuses every version rather than store one
 * unchecked.
 */
export function startPromptEvaluation(): void {
  installPromptEvaluator();
}

/**
 * Resolves whether a sign-in must wait for a verified address (P8-T02b).
 *
 * One database read, before anything is served, because Better Auth reads the
 * answer off an options object built once per process and `getAuth()` is
 * synchronous. Nothing else in the boot sequence depends on it, so it runs
 * last and its own failure is handled inside.
 *
 * A build worker has the placeholder `DATABASE_URL` the Dockerfile sets and
 * no database behind it, the same reason the relay skips that phase.
 */
export async function resolveAuthPolicy(): Promise<void> {
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }
  await resolveSignupPolicy();
}

/**
 * Resolves this instance's per-tenant admission limits (P8-T06a).
 *
 * One database read, before anything is served, for the same reason the
 * signup policy is resolved here: admission runs on every action from every
 * surface and reading a setting per call would cost the connection the limit
 * exists to protect.
 *
 * **Its failure is fatal to the boot and deliberately so.** A number below
 * its floor means an operator asked for a limit the product refuses to
 * apply, and carrying on would serve traffic unlimited while the settings
 * screen says otherwise. Every other step here logs and continues because
 * the product still works without a relay or a meter; it does not work
 * honestly with a limit somebody set and nothing enforcing.
 *
 * A build worker has the placeholder `DATABASE_URL` the Dockerfile sets and
 * no database behind it, the same reason the relay skips that phase.
 */
export async function resolveAdmission(): Promise<void> {
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }
  await installAdmission();
  // The status thresholds resolve beside the limits and fail the boot the same
  // way: docs/design/status-and-capacity.md §4 asks for them to be checked at
  // resolve time, like the admission floors (plan 0.7.0 P8).
  await installStatusThresholds();
}

/**
 * Says so, loudly, when the database would not enforce the tenant floor
 * (completeness review H-01).
 *
 * Not fatal. An existing install that connects as a superuser must keep
 * serving through an upgrade, and `/admin/general` shows an administrator the
 * same finding as a notice, so nobody has to read the log to learn it. The Compose target no longer
 * does this; a Helm install pointed at a superuser URL still can.
 */
export async function checkTenantFloor(): Promise<void> {
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }
  try {
    if ((await tenantFloor()) === "bypassed") {
      process.stderr.write(
        "\ndatabase: WARNING. This instance connects as a role that bypasses " +
          "row-level security (a superuser, or a role with BYPASSRLS). The " +
          "tenant floor is not enforced. Connect as a role with neither; " +
          "docs/install explains how.\n\n",
      );
    }
  } catch (error) {
    process.stderr.write(
      `database: could not check the tenant floor: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

/**
 * Says which reading of the caller's address is in force, and records a change
 * of it on the instance chain (docs/design/trusted-proxies.md D10, D11).
 *
 * After the environment is validated, so a malformed range has already refused
 * the boot by name. Skipped during `next build` for the relay's reason, and
 * never fatal: the reading is in force whether or not its row was written.
 */
export async function recordCallerAddress(): Promise<void> {
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }
  try {
    await announceCallerAddress();
  } catch (error) {
    process.stderr.write(
      `caller address: could not announce the reading: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

/**
 * Loads SSO connections from the database and caches them for `getAuth()`
 * (P8-T07). A connection saved later is read by the next sign-in without a
 * restart (completeness review L-15); this only means the first one does not
 * have to wait for it.
 *
 * Non-fatal on failure: an instance that cannot read its SSO connections
 * still serves password and passkey sign-in, and the next sign-in tries again.
 *
 * A build worker has the placeholder `DATABASE_URL` and no key ring, so
 * this is skipped during `next build`.
 */
export async function resolveSSO(): Promise<void> {
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }
  try {
    await resolveSSOProviders();
  } catch (error) {
    process.stderr.write(
      `sso: could not load SSO connections: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}
