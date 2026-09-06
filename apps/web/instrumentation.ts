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

  const { validateEnvironment, startOutboxRelay, startRecurringWork } =
    await import("./instrumentation.node");
  validateEnvironment();
  startOutboxRelay();
  startRecurringWork();
}
