/**
 * Keeps a response the browser walked away from out of the error log
 * (completeness review L-04).
 *
 * **What it is.** React's server renderer raises "The destination stream
 * closed early." when the socket it is writing to closes before the render
 * finishes, and Next.js logs it as a request error. Almost every one is the
 * client router doing what it is designed to do: a prefetch reads a route up
 * to its `loading.tsx` boundary and cancels the rest, and a navigation that
 * is overtaken by another one is cancelled too. Nothing failed on the server.
 *
 * **Why it matters.** One end-to-end run logged 1,076 of them, and the real
 * errors in the same log, H-02 among them, were lost in the noise. A live
 * instance logs the same thing whenever somebody's pointer crosses the
 * sidebar, so an operator reading a log learns to skip the red lines, which
 * is how a real one gets skipped.
 *
 * **Why the log and not the cause.** The cancellations are the framework's
 * prefetching, and turning prefetching off to quieten a log would make every
 * navigation slower for everybody. Next.js has no setting for it: it already
 * drops an `AbortError` silently, and this error is not one.
 *
 * **Exactly one message, matched whole.** Anything else, including React's
 * sibling "errored while writing data", which is a server-side failure, is
 * logged as before. `LOG_LEVEL=debug` keeps these too, for whoever is chasing
 * a proxy that cuts responses off.
 */

const CLOSED_EARLY = "The destination stream closed early.";

const installed = Symbol.for("openokr.abandonedResponses");

/** Whether a `console.error` call is reporting an abandoned response. */
export function isAbandonedResponse(args: readonly unknown[]): boolean {
  return args.some(
    (arg) =>
      typeof arg === "object" &&
      arg !== null &&
      (arg as { message?: unknown }).message === CLOSED_EARLY,
  );
}

/** Filters abandoned responses out of `console.error`. Safe to call twice. */
export function quietAbandonedResponses(
  level: string | undefined = process.env.LOG_LEVEL,
): void {
  if (level === "debug") {
    return;
  }
  const current = console.error as typeof console.error & {
    [installed]?: true;
  };
  if (current[installed]) {
    return;
  }
  const filtered = Object.assign(
    (...args: unknown[]) => {
      if (!isAbandonedResponse(args)) {
        current.apply(console, args);
      }
    },
    { [installed]: true as const },
  );
  console.error = filtered;
}
