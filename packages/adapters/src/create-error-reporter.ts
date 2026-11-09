import { OffErrorReporter } from "./drivers/errors/off.ts";
import { SentryErrorReporter } from "./drivers/errors/sentry.ts";
import type { ErrorReportDropReason, ErrorReporter } from "./ports/errors.ts";

export interface ErrorReporterConfig {
  /** `observability.errors.dsn`, from `OPENOKR_ERROR_DSN`. Empty by default. */
  readonly dsn?: string | undefined;
  /** The `apps/web` version, which names this client to the tracker. */
  readonly release: string;
  /** Counts a report that did not reach the tracker, and why. */
  readonly onDropped?: (reason: ErrorReportDropReason, count: number) => void;
}

/**
 * Resolves the ErrorReporter port (error-reporting.md D11, D14, D22).
 *
 * **With no DSN, the driver that does nothing**, and the Sentry-protocol
 * driver is never constructed: no queue, no timer, no socket. That one branch
 * is the whole of "OpenOKR sends no error anywhere by default", and
 * `pnpm check:air-gap` reads it (`errors-off-by-default`).
 */
export function createErrorReporter(
  config: ErrorReporterConfig,
): ErrorReporter {
  const dsn = (config.dsn ?? "").trim();
  if (dsn === "") {
    return new OffErrorReporter();
  }
  return new SentryErrorReporter({
    dsn,
    client: `openokr/${config.release}`,
    ...(config.onDropped ? { onDropped: config.onDropped } : {}),
  });
}
