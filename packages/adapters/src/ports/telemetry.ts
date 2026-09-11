/**
 * The Telemetry port (TECHNICAL-PLAN §5, P7-T06a).
 *
 * Recording and exposition are one port because they are one decision: an
 * instance that is not measuring itself should not pay for a meter, and an
 * instance that is should serve what the meter holds. Splitting them would
 * let a deployment record into memory nobody can read.
 *
 * **Nothing here dials out.** `scrape` returns text to whoever asked inside
 * the process; it opens no socket and names no host. Sending measurements
 * somewhere else is `observability.otlp.endpoint`, which is empty by default
 * and is the only setting that can make this product talk to anything. That
 * separation is what the P7-T06 acceptance criterion means by "zero external
 * calls", and it is why the off switch and the export address are two
 * settings rather than one.
 */

/**
 * **Declared here and again in `packages/core/src/telemetry/recorder.ts`,
 * because neither package may import the other.** Core sits above this one
 * and adapters depends on `@openokr/config` alone, so the two meet
 * structurally: core declares what it needs, this declares what a driver
 * offers, and the host passes one where the other is expected. TypeScript
 * checks the match at the wiring point, which is the only place it matters.
 *
 * The same trade the outbox's `PermanentDispatchError` already makes. If you
 * change one, change the other: `adapters.test.ts` asserts they still line
 * up, so a drift fails the build rather than the dashboard.
 *
 * Labels are strings only, and every label must be bounded-cardinality: an
 * action name or an outcome, never a workspace id, a member id or anything a
 * person typed. Each distinct combination is a time series kept for the life
 * of the process, so an unbounded label leaks memory and privacy at once.
 */
export type MetricLabels = Readonly<Record<string, string>>;

export interface MetricRecorder {
  /** Adds to a monotonic counter. `by` defaults to 1. */
  count(name: string, labels?: MetricLabels, by?: number): void;
  /** Records one observation into a histogram, in seconds. */
  observe(name: string, seconds: number, labels?: MetricLabels): void;
  /**
   * Registers a value that is read at scrape time rather than written at
   * event time.
   *
   * **This is the only shape that can answer "how far behind is the
   * outbox".** A counter or a histogram is written when something happens,
   * so a relay that has stopped writes nothing and the series goes flat at
   * whatever it last said. Queue depth and queue age are properties of the
   * world at the moment somebody asks, and a relay that has stopped must
   * report a lag that grows. `read` is called on every scrape, so keep it to
   * one cheap query.
   *
   * Registering the same name twice replaces the reader, so a caller that
   * re-registers after a restart does not accumulate them.
   */
  gauge(
    name: string,
    read: () => number | Promise<number>,
    labels?: MetricLabels,
  ): void;
  /**
   * Runs `fn` inside a span, and returns whatever `fn` returns.
   *
   * **A wrapper rather than start/end pair, deliberately.** A span that has
   * to be ended by hand is a span somebody forgets to end on the error path,
   * and the error path is the one worth tracing. This shape cannot leak one.
   *
   * Tracing is off unless `observability.otlp.endpoint` names somewhere to
   * send spans, and off means this calls `fn` and nothing else: no provider,
   * no context, no allocation. Every caller must therefore treat a span as
   * decoration over work that happens regardless.
   *
   * `attributes` is bounded the same way labels are, and for a sharper
   * reason: a span leaves the host. Never put a title, a body, an address or
   * anything a person typed in here.
   */
  span<T>(
    name: string,
    attributes: MetricLabels,
    fn: () => Promise<T>,
  ): Promise<T>;
}

export interface Telemetry extends MetricRecorder {
  /**
   * Everything recorded so far, in Prometheus text exposition format.
   *
   * Pull, not push: the caller is a route handler answering an operator, so
   * the reading happens when somebody asks rather than on a timer nobody
   * watches.
   */
  scrape(): Promise<string>;
  /** Releases the meter. Safe to call twice. */
  stop(): Promise<void>;
}
