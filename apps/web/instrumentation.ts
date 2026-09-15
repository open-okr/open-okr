/**
 * Next.js calls this once, before the first request is served.
 *
 * Validating here means a misconfigured deployment dies at boot with a message
 * naming the variable, rather than serving traffic until the first query fails.
 */
export async function register(): Promise<void> {
  // The edge runtime holds no database connection and forbids process.exit, so
  // the checks live in a Node-only module loaded behind this guard.
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const {
    validateEnvironment,
    startTelemetry,
    startOutboxRelay,
    startRecurringWork,
    resolveAdmission,
    resolveAuthPolicy,
  } = await import("./instrumentation.node");
  validateEnvironment();
  // Before the relay and the scheduler, so the work they do from the first
  // second is measured rather than missed (P7-T06a).
  startTelemetry();
  // Before the relay and the scheduler, because both call actions and an
  // unlimited first minute is the minute a burst arrives in (P8-T06a).
  await resolveAdmission();
  startOutboxRelay();
  startRecurringWork();
  // Last, and awaited: the first request must not reach Better Auth with
  // the answer still unresolved, or a mail-capable instance would serve one
  // sign-in without the requirement it is configured for (P8-T02b).
  await resolveAuthPolicy();
}
