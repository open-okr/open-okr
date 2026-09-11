import type { MetricLabels, Telemetry } from "../../ports/telemetry.ts";

/**
 * The driver for an instance that is not measuring itself (P7-T06a).
 *
 * Not a stub for tests: this is what a deployment with
 * `observability.metrics` turned off actually runs, and it is the reason
 * turning the setting off costs nothing rather than a little. Every method is
 * empty, so the instrumentation scattered through the product compiles to a
 * call that returns immediately and allocates nothing.
 *
 * `scrape` returns a comment rather than an empty string so an operator who
 * reaches the endpoint with metrics off gets an answer that explains itself.
 * Prometheus ignores comment lines, so a scraper pointed here reads zero
 * series instead of a parse error.
 */
export class OffTelemetry implements Telemetry {
  // The parameters are declared and unused on purpose. Dropping them would
  // still satisfy the port structurally, and would make a direct call on
  // this class a type error while the same call through the port compiled,
  // which is a difference nobody should have to discover.
  count(_name: string, _labels?: MetricLabels, _by?: number): void {
    // Deliberately empty. See the note above.
  }

  observe(_name: string, _seconds: number, _labels?: MetricLabels): void {
    // Deliberately empty.
  }

  gauge(
    _name: string,
    _read: () => number | Promise<number>,
    _labels?: MetricLabels,
  ): void {
    // Deliberately empty, and the reader is never called. A gauge's reader
    // is a database query on this product's hot paths; an instance that is
    // not measuring itself must not pay for one.
  }

  scrape(): Promise<string> {
    return Promise.resolve(
      "# observability.metrics is off on this instance. Nothing is recorded.\n",
    );
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }
}
