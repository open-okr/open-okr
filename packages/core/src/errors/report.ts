/**
 * Reporting one unexpected error (docs/design/error-reporting.md, plan 0.7.0
 * E1).
 *
 * classify, then scrub, then the local floor, then the sink:
 *
 * | Step | What | Leaves the host |
 * |---|---|---|
 * | classify | A refusal or Next's control flow stops here (D1) | No |
 * | scrub | Class, safe message, scrubbed frames, fingerprint (D4, D5, D8) | No |
 * | count | `openokr_errors_total{source}`, every time (D3) | No |
 * | cap | 10 a minute per fingerprint, 60 in all (D9) | No |
 * | log | One JSON line on stderr (D3) | No |
 * | sink | The `ErrorReporter` port, when the host installed one (D11) | Only with a DSN |
 *
 * **Nothing here may throw.** Reporting runs on the error path of everything
 * else, so a failure to report must never become the error somebody sees.
 *
 * **One error, one report.** An error can pass several capture points on its
 * way out: an action fails inside a server component, which fails the render.
 * The first capture point to see it holds the report for up to a second, and
 * the next one to see the same error adds what it knows and sends it then.
 * That is how a report from inside `callAction`, which knows the action and
 * the workspace, also carries the digest Next shows the person on the error
 * page (D20). An error nobody else catches is sent when the second is up.
 */
import { randomUUID } from "node:crypto";
import { defaultMetrics, METRIC } from "../telemetry/recorder.ts";
import {
  classifyError,
  type DescribedError,
  describeError,
  type ErrorFrame,
  type ErrorSource,
  fingerprintOf,
  scrubbedStack,
} from "./classify.ts";

/** What the capture point knows. Every field is checked before it is used. */
export interface ErrorReportContext {
  readonly source: ErrorSource;
  /** The digest Next showed the person (D20). */
  readonly digest?: string | null;
  /** The route pattern, `/goals/[id]`, never the concrete path (D4). */
  readonly route?: string | null;
  readonly method?: string | null;
  /** The registry action's name. */
  readonly action?: string | null;
  readonly workspaceId?: string | null;
  readonly memberId?: string | null;
  /**
   * A person's user id, when the error was caught before their member row was
   * resolved: `callAction` is handed a user and resolves the member inside.
   */
  readonly userId?: string | null;
  /**
   * Values fixed by the code: an outbox topic, a job name. **Never** anything
   * a person typed, because a tag is indexed and shown by every tracker.
   */
  readonly tags?: Readonly<Record<string, string>>;
}

/**
 * One report, as the log line and the sink receive it.
 *
 * Declared again in `packages/adapters/src/ports/errors.ts` as `ErrorEvent`,
 * because neither package may import the other. The host passes the port's
 * driver where this file expects a sink, and TypeScript checks the match
 * there, the same arrangement as `MetricRecorder`.
 */
export interface ErrorReport {
  /** 32 hex characters, the shape every Sentry-protocol tracker expects. */
  readonly eventId: string;
  /** ISO 8601. */
  readonly timestamp: string;
  readonly source: ErrorSource;
  readonly className: string;
  /** The safe message (D5), never the raw one. */
  readonly message: string;
  /** Innermost first. */
  readonly frames: readonly ErrorFrame[];
  readonly fingerprint: string;
  readonly digest: string | null;
  readonly traceId: string | null;
  readonly spanId: string | null;
  /** The `apps/web` version. */
  readonly release: string;
  readonly environment: string;
  readonly region: string | null;
  readonly route: string | null;
  readonly method: string | null;
  readonly action: string | null;
  readonly workspaceId: string | null;
  readonly memberId: string | null;
  readonly userId: string | null;
  readonly sqlState: string | null;
  readonly constraint: string | null;
  readonly tags: Readonly<Record<string, string>>;
}

/** Where a report goes after the local floor: the `ErrorReporter` port. */
export interface ErrorReportSink {
  /** Queues one report. Must return at once and never throw (D10). */
  report(report: ErrorReport): void;
  /** Sends what is queued, giving up after `timeoutMs`. */
  flush(timeoutMs: number): Promise<void>;
}

export interface ErrorReportingOptions {
  readonly release: string;
  readonly environment?: string;
  /** `cloud.region`, when the deployment names one. */
  readonly region?: string | null;
  /** The driver behind the port. Absent means the local floor only. */
  readonly sink?: ErrorReportSink | null;
  /** Writes one log line. stderr unless a test says otherwise. */
  readonly write?: (line: string) => void;
  /** The trace and span an error failed inside, when tracing is on (D20). */
  readonly traceOf?: (
    error: unknown,
  ) => { readonly traceId: string; readonly spanId: string } | null;
  readonly now?: () => number;
}

/** D9: one fingerprint at most this often a minute. */
export const REPORTS_PER_FINGERPRINT_PER_MINUTE = 10;
/** D9: every fingerprint together. */
export const REPORTS_PER_MINUTE = 60;
const WINDOW_MS = 60_000;
/** How long the first capture point waits for the next one. */
const HOLD_MS = 1_000;

interface Pending {
  readonly error: unknown;
  readonly described: DescribedError;
  context: ErrorReportContext;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface State {
  options: ErrorReportingOptions;
  /** Errors already reported, so a later capture point does not repeat one. */
  reported: WeakSet<object>;
  pending: Map<unknown, Pending>;
  windowStart: number;
  total: number;
  perFingerprint: Map<string, number>;
  held: number;
  heldTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * On `globalThis` for the reason `recorder.ts` gives: Next bundles the boot
 * hook apart from the route code, and a module variable would give the hook
 * one reporter and every action another.
 */
const globals = globalThis as typeof globalThis & {
  openokrErrorReporting?: State;
};

function freshState(options: ErrorReportingOptions): State {
  return {
    options,
    reported: new WeakSet(),
    pending: new Map(),
    windowStart: 0,
    total: 0,
    perFingerprint: new Map(),
    held: 0,
    heldTimer: null,
  };
}

function state(): State {
  globals.openokrErrorReporting ??= freshState({ release: "unknown" });
  return globals.openokrErrorReporting;
}

/**
 * Installs the release, the environment and the sink every report uses.
 *
 * Set once at boot by the host, like the meter. Before it runs, and in every
 * test that never calls it, reporting still works: the local floor needs
 * nothing configured (D3).
 */
export function installErrorReporting(options: ErrorReportingOptions): void {
  const previous = globals.openokrErrorReporting;
  if (previous) {
    for (const pending of previous.pending.values()) {
      clearTimeout(pending.timer);
    }
    if (previous.heldTimer) {
      clearTimeout(previous.heldTimer);
    }
  }
  globals.openokrErrorReporting = freshState(options);
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DIGEST = /^[A-Za-z0-9_;:.-]{1,64}$/;
const ROUTE = /^\/[A-Za-z0-9_.~/[\]()@-]{0,199}$/;
const METHOD = /^[A-Z]{3,7}$/;
const ACTION = /^[A-Za-z0-9_.-]{1,100}$/;
const TAG_KEY = /^[a-z][a-z0-9_]{0,31}$/;
const TAG_VALUE = /^[A-Za-z0-9_.:/[\]-]{1,128}$/;

const checked = (pattern: RegExp, value: string | null | undefined) =>
  typeof value === "string" && pattern.test(value) ? value : null;

/** Only tags whose key and value have the shape of code. */
function checkedTags(
  tags: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags ?? {})) {
    if (
      TAG_KEY.test(key) &&
      typeof value === "string" &&
      TAG_VALUE.test(value)
    ) {
      kept[key] = value;
    }
  }
  return kept;
}

/** The later capture point fills what the first did not know. */
function merge(
  first: ErrorReportContext,
  later: ErrorReportContext,
): ErrorReportContext {
  return {
    source: first.source,
    digest: first.digest ?? later.digest ?? null,
    route: first.route ?? later.route ?? null,
    method: first.method ?? later.method ?? null,
    action: first.action ?? later.action ?? null,
    workspaceId: first.workspaceId ?? later.workspaceId ?? null,
    memberId: first.memberId ?? later.memberId ?? null,
    userId: first.userId ?? later.userId ?? null,
    tags: { ...later.tags, ...first.tags },
  };
}

const writeToStderr = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

function write(current: State, line: Record<string, unknown>): void {
  try {
    (current.options.write ?? writeToStderr)(JSON.stringify(line));
  } catch {
    // A log that cannot be written is not a reason to fail the caller.
  }
}

/** Says how many reports the caps held back, once a minute (D9). */
function writeHeld(current: State): void {
  if (current.heldTimer) {
    clearTimeout(current.heldTimer);
    current.heldTimer = null;
  }
  if (current.held === 0) {
    return;
  }
  write(current, {
    kind: "error.report.held",
    time: new Date((current.options.now ?? Date.now)()).toISOString(),
    held: current.held,
    windowSeconds: WINDOW_MS / 1000,
  });
  current.held = 0;
}

/** Starts a new minute when this one is over. */
function roll(current: State, now: number): void {
  if (now - current.windowStart < WINDOW_MS) {
    return;
  }
  writeHeld(current);
  current.windowStart = now;
  current.total = 0;
  current.perFingerprint.clear();
}

/** The caps (D9). True when this report may go out. */
function admit(current: State, fingerprint: string, now: number): boolean {
  roll(current, now);
  const seen = current.perFingerprint.get(fingerprint) ?? 0;
  if (
    current.total >= REPORTS_PER_MINUTE ||
    seen >= REPORTS_PER_FINGERPRINT_PER_MINUTE
  ) {
    current.held++;
    if (!current.heldTimer) {
      const timer = setTimeout(
        () => writeHeld(state()),
        Math.max(0, current.windowStart + WINDOW_MS - now),
      );
      timer.unref?.();
      current.heldTimer = timer;
    }
    return false;
  }
  current.total++;
  current.perFingerprint.set(fingerprint, seen + 1);
  return true;
}

/** Counts, caps, logs and hands one scrubbed error to the sink. */
function emit(
  current: State,
  error: unknown,
  described: DescribedError,
  context: ErrorReportContext,
): void {
  const fingerprint = fingerprintOf(
    context.source,
    described.className,
    described.frames,
  );
  // Every unexpected error is counted, held back or not: the counter is what
  // an operator alerts on, and it must not stop rising when the caps engage.
  defaultMetrics().count(METRIC.errorsTotal, { source: context.source });

  const now = (current.options.now ?? Date.now)();
  if (!admit(current, fingerprint, now)) {
    return;
  }

  let trace: { readonly traceId: string; readonly spanId: string } | null =
    null;
  try {
    trace =
      error === undefined ? null : (current.options.traceOf?.(error) ?? null);
  } catch {
    trace = null;
  }

  const report: ErrorReport = {
    eventId: randomUUID().replace(/-/g, ""),
    timestamp: new Date(now).toISOString(),
    source: context.source,
    className: described.className,
    message: described.message,
    frames: described.frames,
    fingerprint,
    digest: checked(DIGEST, context.digest),
    traceId: trace?.traceId ?? null,
    spanId: trace?.spanId ?? null,
    release: current.options.release,
    environment: current.options.environment ?? "production",
    region: current.options.region ?? null,
    route: checked(ROUTE, context.route),
    method: checked(METHOD, context.method),
    action: checked(ACTION, context.action),
    workspaceId: checked(ID, context.workspaceId),
    memberId: checked(ID, context.memberId),
    userId: checked(ID, context.userId),
    sqlState: described.sqlState,
    constraint: described.constraint,
    tags: checkedTags(context.tags),
  };

  write(current, {
    kind: "error.report",
    time: report.timestamp,
    eventId: report.eventId,
    source: report.source,
    class: report.className,
    message: report.message,
    fingerprint: report.fingerprint,
    digest: report.digest,
    traceId: report.traceId,
    spanId: report.spanId,
    route: report.route,
    method: report.method,
    action: report.action,
    version: report.release,
    environment: report.environment,
    workspaceId: report.workspaceId,
    memberId: report.memberId,
    userId: report.userId,
    sqlState: report.sqlState,
    constraint: report.constraint,
    tags: report.tags,
    stack: scrubbedStack(described),
  });

  try {
    current.options.sink?.report(report);
  } catch {
    // The driver promised not to throw. Even so, never here.
  }
}

function emitPending(current: State, key: unknown): void {
  const pending = current.pending.get(key);
  if (!pending) {
    return;
  }
  current.pending.delete(key);
  clearTimeout(pending.timer);
  emit(current, pending.error, pending.described, pending.context);
}

export interface ReportOptions {
  /**
   * Wait for the next capture point before sending (see the file note).
   * `callAction` holds, because the request around it knows the digest.
   */
  readonly hold?: boolean;
}

/**
 * Reports one thrown value, if it is unexpected. Never throws.
 *
 * Safe to call with anything, from anywhere, as often as an error passes:
 * a refusal returns at once, and an error already reported is not reported
 * again. A dead letter is the exception to both, because giving up on work
 * is its own event (D1).
 */
export function reportError(
  error: unknown,
  context: ErrorReportContext,
  options: ReportOptions = {},
): void {
  try {
    const current = state();
    const key =
      typeof error === "object" && error !== null ? (error as object) : null;
    const deadLetter = context.source === "dead_letter";

    if (key && !deadLetter) {
      if (current.reported.has(key)) {
        return;
      }
      const pending = current.pending.get(key);
      if (pending) {
        pending.context = merge(pending.context, context);
        if (!options.hold) {
          current.reported.add(key);
          emitPending(current, key);
        }
        return;
      }
    }

    if (classifyError(error, context.source).expected) {
      return;
    }
    const described = describeError(error);

    if (key && options.hold && !deadLetter) {
      const timer = setTimeout(() => {
        const now = state();
        now.reported.add(key);
        emitPending(now, key);
      }, HOLD_MS);
      timer.unref?.();
      current.pending.set(key, { error, described, context, timer });
      return;
    }
    if (key && !deadLetter) {
      current.reported.add(key);
    }
    emit(current, error, described, context);
  } catch {
    // Reporting is never the reason a request fails.
  }
}

/**
 * Reports an error that arrived already described: a browser's, which the
 * server only ever sees as text (E3). The description must already be safe.
 */
export function reportDescribedError(
  described: DescribedError,
  context: ErrorReportContext,
): void {
  try {
    emit(state(), undefined, described, context);
  } catch {
    // As above.
  }
}

/**
 * Sends every held report now, then waits for the sink, at most `timeoutMs`.
 * Called on shutdown, beside the relay's drain (D10).
 */
export async function flushErrorReports(timeoutMs: number): Promise<void> {
  try {
    const current = state();
    for (const key of [...current.pending.keys()]) {
      if (typeof key === "object" && key !== null) {
        current.reported.add(key);
      }
      emitPending(current, key);
    }
    writeHeld(current);
    await current.options.sink?.flush(timeoutMs);
  } catch {
    // Shutting down regardless.
  }
}
