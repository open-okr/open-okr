/**
 * This process's error reporting (docs/design/error-reporting.md, plan 0.7.0
 * E1).
 *
 * The classification, the scrub, the counter and the log line are in
 * `@openokr/core`, so the relay, the scheduler and every action share one
 * rule. What lives here is what only the web process knows: its version, its
 * trace, Next's request hook, and the process's own last-resort events.
 *
 * Nothing in this file sends anything anywhere. The local floor (one JSON line
 * on stderr and `openokr_errors_total`) is all an instance gets until an
 * operator names a tracker.
 */
import {
  flushErrorReports,
  installErrorReporting,
  reportError,
} from "@openokr/core";
import { RUNNING_VERSION } from "./app-version";
import { getTelemetry } from "./telemetry";

const globals = globalThis as typeof globalThis & {
  openokrProcessErrorHandlers?: true;
};

/**
 * `cloud.region`, read from its environment variable at boot rather than from
 * `system_settings`, for the reason `lib/telemetry.ts` reads the metrics
 * switch there: reporting is installed before the first query. A deployment
 * that records a region on its tenants sets the variable anyway.
 */
function region(): string | null {
  const value = (process.env.OPENOKR_CLOUD_REGION ?? "").trim();
  return value === "" ? null : value;
}

/** How long a shutdown waits for the last reports (D10). */
const SHUTDOWN_FLUSH_MS = 2_000;

/**
 * Installs reporting for this process. Called once at boot, after the meter,
 * so the first error is counted on the meter the endpoint serves.
 */
export function installErrorReports(): void {
  installErrorReporting({
    release: RUNNING_VERSION,
    region: region(),
    traceOf: (error) => getTelemetry().traceOf(error),
  });
  installProcessHandlers();
}

/**
 * The process's own last resort (D2): an exception nothing caught and a
 * rejection nothing handled.
 *
 * **Both leave Node's behaviour exactly as it was.** `uncaughtExceptionMonitor`
 * is the event Node provides for watching without handling. A rejection has
 * no such event, and adding the first `unhandledRejection` listener is what
 * stops Node turning one into a crash. Next registers its own listener before
 * it calls the boot hook, which already made rejections log-and-continue, so
 * this one is added only beside an existing listener and never as the first.
 */
function installProcessHandlers(): void {
  if (globals.openokrProcessErrorHandlers) {
    return;
  }
  globals.openokrProcessErrorHandlers = true;
  process.on("uncaughtExceptionMonitor", (error) => {
    reportError(error, { source: "process" });
  });
  if (process.listenerCount("unhandledRejection") > 0) {
    process.on("unhandledRejection", (reason) => {
      reportError(reason, { source: "process" });
    });
  }
  // Beside the relay's drain: whatever is still held goes out before exit.
  const flush = () => {
    void flushErrorReports(SHUTDOWN_FLUSH_MS);
  };
  process.once("SIGTERM", flush);
  process.once("SIGINT", flush);
}

/**
 * The route pattern of a Next route file path (D4).
 *
 * Next passes the file path, `/goals/[id]/page`. The report keeps the pattern
 * and drops the file name and any route group, because `/(app)` is how the
 * code is arranged and not where the person was.
 */
export function routePattern(routePath: string | undefined): string | null {
  if (!routePath) {
    return null;
  }
  const pattern = routePath
    .replace(/\/(page|route|layout|default|error|loading|not-found)$/, "")
    .replace(/\/\([^/()]+\)(?=\/|$)/g, "");
  if (pattern === "") {
    return "/";
  }
  return pattern.startsWith("/") ? pattern : `/${pattern}`;
}

/** What Next tells `onRequestError`, the parts this reads. */
export interface RequestErrorRequest {
  readonly method: string;
}
export interface RequestErrorContext {
  readonly routePath?: string;
  readonly routeType?: string;
}

/**
 * Next's server error hook (D2), for renders, route handlers, server actions
 * and the proxy.
 *
 * **The method and the route pattern, and nothing else from the request.**
 * The path carries ids and a query string, and the headers carry the cookie.
 * The digest is the one Next has just shown the person (D20).
 */
export function reportRequestError(
  error: unknown,
  request: RequestErrorRequest,
  context: RequestErrorContext,
): void {
  const digest =
    typeof error === "object" &&
    error !== null &&
    typeof (error as { digest?: unknown }).digest === "string"
      ? (error as { digest: string }).digest
      : null;
  reportError(error, {
    source: context.routeType === "action" ? "action" : "request",
    digest,
    route: routePattern(context.routePath),
    method: request.method,
  });
}
