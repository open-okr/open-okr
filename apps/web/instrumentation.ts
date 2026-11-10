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
    quietCancelledResponses,
    validateEnvironment,
    startTelemetry,
    startErrorReporting,
    startPromptEvaluation,
    startOutboxRelay,
    startRecurringWork,
    resolveAdmission,
    resolveAuthPolicy,
    resolveSSO,
    checkTenantFloor,
    recordCallerAddress,
  } = await import("./instrumentation.node");
  // First, before anything can log: a filter installed halfway through boot
  // would leave the log judged by two rules.
  quietCancelledResponses();
  validateEnvironment();
  // Before the relay and the scheduler, so the work they do from the first
  // second is measured rather than missed (P7-T06a).
  startTelemetry();
  // After the meter, so the first error is counted on the meter the endpoint
  // serves, and before the relay and the scheduler, which report into it
  // (plan 0.7.0 E1).
  startErrorReporting();
  // Before anything can call `ai.updatePrompt`, which refuses every version
  // until the evaluation set is installed (plan 0.7.0 A9).
  startPromptEvaluation();
  // Before the relay and the scheduler, because both call actions and an
  // unlimited first minute is the minute a burst arrives in (P8-T06a).
  await resolveAdmission();
  await checkTenantFloor();
  // Which caller address every per-address limit counts, in the log and, when
  // it changed, on the instance chain (docs/design/trusted-proxies.md D10).
  await recordCallerAddress();
  startOutboxRelay();
  startRecurringWork();
  // Before the first request, so the first sign-in finds the SSO providers
  // already read (P8-T07). A connection saved later reaches the next sign-in
  // without a restart (L-15).
  await resolveSSO();
  // Last, and awaited: the first request must not reach Better Auth with
  // the answer still unresolved, or a mail-capable instance would serve one
  // sign-in without the requirement it is configured for (P8-T02b).
  await resolveAuthPolicy();
}

/**
 * Next calls this for every server error it catches: a render, a route
 * handler, a server action or the proxy (docs/design/error-reporting.md D2).
 *
 * A refusal or Next's own `notFound()` returns from the classifier at once,
 * and an error an action already reported is not reported twice: this adds
 * the digest the person was shown to that report instead. Node only, behind
 * a dynamic import, for the reason `register` gives.
 */
export async function onRequestError(
  error: unknown,
  request: { readonly method: string },
  context: { readonly routePath?: string; readonly routeType?: string },
): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  try {
    const { reportRequestError } = await import("./lib/error-reporting");
    reportRequestError(error, request, context);
  } catch {
    // Reporting must never be what fails a request twice.
  }
}
