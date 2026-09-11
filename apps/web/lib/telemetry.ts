import { createTelemetry, type Telemetry } from "@openokr/adapters";

/**
 * This process's meter (P7-T06a).
 *
 * One per process, built on first use rather than at module load, because a
 * `next build` worker imports half the application to trace it and has no
 * business constructing a meter it will never read.
 *
 * **This module must never reach a client bundle**, because the meter is a
 * vendor SDK behind a port. The `server-only` package is the usual guard and
 * is deliberately not used: it is not a dependency of this repository and
 * adding one needs a human decision (CLAUDE.md). What enforces the rule
 * instead is `pnpm check:boundaries`, which already fails any client file
 * that reaches `@openokr/adapters`, and the absence of `"use client"` in
 * every file that imports this one.
 */
/**
 * Cached on `globalThis` for the reason `lib/pool.ts` gives, plus one more
 * that cost an hour on 11 September 2026: Next.js bundles
 * `instrumentation.ts` separately from route and page code, so a module
 * variable here would give the boot hook one meter and the exposition route
 * another. The endpoint served an empty body after a clean restart and every
 * gate was green.
 */
const globals = globalThis as typeof globalThis & {
  openokrTelemetry?: Telemetry;
};

/**
 * Whether this instance measures itself.
 *
 * Read from the environment rather than from `system_settings`, and that is
 * a deliberate narrowing of TECHNICAL-PLAN §4.14's usual rule that a stored
 * setting beats its variable. The meter is constructed before the first
 * request and therefore before any query, so a database read here would
 * either block boot on Postgres or leave the first requests unmeasured. The
 * admin screen that surfaces `observability.metrics` reads and writes the
 * stored row as normal; this is the boot-time bootstrap of the same setting,
 * which is exactly what the §4.14 environment column is for.
 *
 * Defaults to on. A local endpoint behind an administrator session sends
 * nothing anywhere, and a product that must be configured before it can be
 * watched is a product nobody watches.
 */
function metricsEnabled(): boolean {
  const raw = process.env.OPENOKR_OBSERVABILITY_METRICS;
  if (raw === undefined || raw === "") {
    return true;
  }
  return raw !== "false" && raw !== "0";
}

export function getTelemetry(): Telemetry {
  globals.openokrTelemetry ??= createTelemetry({
    enabled: metricsEnabled(),
    serviceName: "openokr",
    ...(process.env.APP_BUILD_ID
      ? { instanceId: process.env.APP_BUILD_ID }
      : {}),
    ...(otlpEndpoint() ? { otlpEndpoint: otlpEndpoint() } : {}),
  });
  return globals.openokrTelemetry;
}

/**
 * Where spans go, from `observability.otlp.endpoint`.
 *
 * Read from the environment at boot for the same reason `metricsEnabled` is,
 * and with the same narrowing of TECHNICAL-PLAN §4.14's stored-wins rule: the
 * tracer is built before the first request and therefore before any query.
 *
 * **Empty is the default and empty means nothing leaves.** A blank string
 * and an unset variable are the same answer here, which matters because a
 * Compose file that interpolates an unset variable produces the blank one.
 */
function otlpEndpoint(): string {
  return (process.env.OPENOKR_OTLP_ENDPOINT ?? "").trim();
}

/** True when this instance is measuring itself. Used by the route to refuse. */
export function isMetricsEnabled(): boolean {
  return metricsEnabled();
}
