import type { ErrorEvent, ErrorReporter } from "../../ports/errors.ts";

/**
 * The default: no tracker (error-reporting.md D11, D22).
 *
 * The JSON line and the counter have already happened in `packages/core`
 * before a report reaches a driver, so an instance with this one still has
 * every error on record. This only declines to send it anywhere, and holds
 * no queue, no timer and no socket.
 */
export class OffErrorReporter implements ErrorReporter {
  report(_event: ErrorEvent): void {
    // Deliberately empty.
  }

  flush(_timeoutMs: number): Promise<void> {
    return Promise.resolve();
  }
}
