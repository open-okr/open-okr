/**
 * Sends error reports to any tracker that speaks Sentry's protocol: Sentry,
 * self-hosted Sentry, GlitchTip or Bugsink (docs/design/error-reporting.md
 * D12, D13, plan 0.7.0 E2).
 *
 * **A small client, not Sentry's SDK** (Q1). What a tracker needs is one HTTP
 * POST of an envelope: a header line, an item header and the event. The SDK
 * would be a runtime dependency, start a second OpenTelemetry beside ours,
 * patch globals, and send fields some compatible trackers reject.
 *
 * **The platform `fetch`, not the outbound guard.** The guard refuses private
 * addresses because a tenant chose them; this address is the deployment's
 * own, set in the environment, and a self-hoster's tracker most likely sits
 * on exactly the private network the guard refuses (D13). No redirect is
 * followed, each POST gives up after three seconds, and a response body is
 * never read past its status.
 *
 * **Never blocks and never throws** (D10). `report` pushes onto a queue of at
 * most 100 and returns. The queue goes out every two seconds, or at twenty.
 * A full queue drops the newest, a `429` stops sending until its
 * `Retry-After` has passed, and a tracker that does not answer loses the
 * rest of that batch rather than holding the next one up. Each loss is
 * counted through `onDropped`.
 */
import type {
  ErrorEvent,
  ErrorReportDropReason,
  ErrorReporter,
} from "../../ports/errors.ts";

/** Where to send and with which key, read from a DSN. */
export interface SentryDsn {
  readonly publicKey: string;
  readonly envelopeUrl: string;
}

/**
 * Reads a DSN: `https://<key>@<host>[:port][/<path>]/<project id>`.
 *
 * Null when it is not one. The secret half some old DSNs carry after a colon
 * is ignored, as every current tracker ignores it.
 */
export function parseSentryDsn(dsn: string): SentryDsn | null {
  let url: URL;
  try {
    url = new URL(dsn.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  const project = segments.pop();
  if (!url.username || !project || !/^[A-Za-z0-9_-]+$/.test(project)) {
    return null;
  }
  const prefix = segments.length > 0 ? `/${segments.join("/")}` : "";
  return {
    publicKey: decodeURIComponent(url.username),
    envelopeUrl: `${url.protocol}//${url.host}${prefix}/api/${project}/envelope/`,
  };
}

export interface SentryErrorReporterOptions {
  readonly dsn: string;
  /** Names this client in `X-Sentry-Auth`, `openokr/<version>`. */
  readonly client: string;
  readonly onDropped?: (reason: ErrorReportDropReason, count: number) => void;
  /** A test seam. The platform's own otherwise. */
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly batchIntervalMs?: number;
  readonly batchSize?: number;
  readonly queueLimit?: number;
  readonly timeoutMs?: number;
}

/** D10's numbers. */
const BATCH_INTERVAL_MS = 2_000;
const BATCH_SIZE = 20;
const QUEUE_LIMIT = 100;
const TIMEOUT_MS = 3_000;
/** When a `429` names no wait, the wait. */
const DEFAULT_RETRY_AFTER_MS = 60_000;

type Outcome = "sent" | "rejected" | "rate_limited" | "unreachable";

/** One event in the shape the protocol defines, with nothing added. */
function sentryEvent(event: ErrorEvent): Record<string, unknown> {
  const tags: Record<string, string> = { source: event.source };
  const optional: Record<string, string | null> = {
    digest: event.digest,
    action: event.action,
    route: event.route,
    method: event.method,
    workspace_id: event.workspaceId,
    member_id: event.memberId,
    user_id: event.userId,
    region: event.region,
    sql_state: event.sqlState,
    constraint: event.constraint,
    trace_id: event.traceId,
  };
  for (const [key, value] of Object.entries(optional)) {
    if (value !== null) {
      tags[key] = value;
    }
  }
  for (const [key, value] of Object.entries(event.tags)) {
    tags[key] ??= value;
  }

  const frames = [...event.frames].reverse().map((frame) => ({
    filename: frame.file,
    function: frame.function,
    ...(frame.line === null ? {} : { lineno: frame.line }),
    ...(frame.column === null ? {} : { colno: frame.column }),
    in_app: frame.inApp,
  }));

  return {
    event_id: event.eventId,
    timestamp: Date.parse(event.timestamp) / 1000,
    platform: event.source === "browser" ? "javascript" : "node",
    level: "error",
    logger: "openokr",
    release: event.release,
    environment: event.environment,
    ...(event.route || event.action
      ? { transaction: event.route ?? event.action }
      : {}),
    exception: {
      values: [
        {
          type: event.className,
          value: event.message,
          mechanism: { type: "generic", handled: event.source !== "process" },
          // The protocol reads frames oldest first; a stack reads innermost
          // first, which is how the report holds them.
          ...(frames.length > 0 ? { stacktrace: { frames } } : {}),
        },
      ],
    },
    fingerprint: [event.fingerprint],
    tags,
    ...(event.traceId && event.spanId
      ? {
          contexts: {
            trace: { trace_id: event.traceId, span_id: event.spanId },
          },
        }
      : {}),
  };
}

/** The envelope for one event: three JSON lines. */
export function sentryEnvelope(event: ErrorEvent, sentAt: string): string {
  return [
    JSON.stringify({ event_id: event.eventId, sent_at: sentAt }),
    JSON.stringify({ type: "event", content_type: "application/json" }),
    JSON.stringify(sentryEvent(event)),
  ]
    .join("\n")
    .concat("\n");
}

/** `Retry-After` in seconds or as a date. A minute when it is neither. */
function retryAfterMs(header: string | null, now: number): number {
  if (header === null) {
    return DEFAULT_RETRY_AFTER_MS;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(header);
  return Number.isFinite(date)
    ? Math.max(0, date - now)
    : DEFAULT_RETRY_AFTER_MS;
}

export class SentryErrorReporter implements ErrorReporter {
  readonly #dsn: SentryDsn;
  readonly #auth: string;
  readonly #options: SentryErrorReporterOptions;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #queue: ErrorEvent[] = [];
  #timer: ReturnType<typeof setTimeout> | null = null;
  #inFlight: Promise<void> | null = null;
  #retryAfterUntil = 0;

  constructor(options: SentryErrorReporterOptions) {
    const dsn = parseSentryDsn(options.dsn);
    if (!dsn) {
      // Never the value: it carries the key that writes into the tracker.
      throw new Error("OPENOKR_ERROR_DSN is not a DSN.");
    }
    this.#dsn = dsn;
    this.#auth = `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=${options.client}`;
    this.#options = options;
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? Date.now;
  }

  report(event: ErrorEvent): void {
    try {
      if (this.#now() < this.#retryAfterUntil) {
        this.#dropped("rate_limited", 1);
        return;
      }
      if (this.#queue.length >= (this.#options.queueLimit ?? QUEUE_LIMIT)) {
        this.#dropped("queue_full", 1);
        return;
      }
      this.#queue.push(event);
      if (this.#queue.length >= (this.#options.batchSize ?? BATCH_SIZE)) {
        void this.#drain();
      } else {
        this.#schedule();
      }
    } catch {
      // D10: never here.
    }
  }

  async flush(timeoutMs: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const work = (async () => {
        // Bounded, so a flush can never become a loop.
        for (let round = 0; round < 10; round++) {
          if (this.#inFlight) {
            await this.#inFlight;
            continue;
          }
          if (this.#queue.length === 0) {
            return;
          }
          await this.#drain();
        }
      })();
      const limit = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
        timer.unref?.();
      });
      await Promise.race([work, limit]);
    } catch {
      // Shutting down regardless.
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  #schedule(): void {
    if (this.#timer) {
      return;
    }
    const timer = setTimeout(() => {
      this.#timer = null;
      void this.#drain();
    }, this.#options.batchIntervalMs ?? BATCH_INTERVAL_MS);
    // A queue waiting to go out must not be what keeps a process alive.
    timer.unref?.();
    this.#timer = timer;
  }

  #drain(): Promise<void> {
    if (this.#inFlight) {
      this.#schedule();
      return this.#inFlight;
    }
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    const batch = this.#queue.splice(0, this.#options.batchSize ?? BATCH_SIZE);
    if (batch.length === 0) {
      return Promise.resolve();
    }
    this.#inFlight = this.#sendBatch(batch)
      .catch(() => {
        this.#dropped("send_failed", batch.length);
      })
      .finally(() => {
        this.#inFlight = null;
        if (this.#queue.length > 0) {
          this.#schedule();
        }
      });
    return this.#inFlight;
  }

  async #sendBatch(batch: readonly ErrorEvent[]): Promise<void> {
    for (let index = 0; index < batch.length; index++) {
      if (this.#now() < this.#retryAfterUntil) {
        this.#dropped("rate_limited", batch.length - index);
        return;
      }
      const outcome = await this.#sendOne(batch[index] as ErrorEvent);
      if (outcome === "rate_limited") {
        this.#dropped("rate_limited", batch.length - index);
        return;
      }
      if (outcome === "unreachable") {
        // A tracker that did not answer one will not answer the next inside
        // the same two seconds, and three seconds each is a long queue.
        this.#dropped("send_failed", batch.length - index);
        return;
      }
      if (outcome === "rejected") {
        this.#dropped("send_failed", 1);
      }
    }
  }

  async #sendOne(event: ErrorEvent): Promise<Outcome> {
    try {
      const response = await this.#fetch(this.#dsn.envelopeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-sentry-envelope",
          "X-Sentry-Auth": this.#auth,
        },
        body: sentryEnvelope(event, new Date(this.#now()).toISOString()),
        redirect: "manual",
        signal: AbortSignal.timeout(this.#options.timeoutMs ?? TIMEOUT_MS),
      });
      // The status is the whole answer. The body is a tracker's to word, and
      // reading it would be the one way this driver could take in text it
      // then has to handle.
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 429) {
        this.#retryAfterUntil =
          this.#now() +
          retryAfterMs(response.headers.get("retry-after"), this.#now());
        return "rate_limited";
      }
      return response.ok ? "sent" : "rejected";
    } catch {
      return "unreachable";
    }
  }

  #dropped(reason: ErrorReportDropReason, count: number): void {
    try {
      this.#options.onDropped?.(reason, count);
    } catch {
      // A counter that throws is not a reason to throw.
    }
  }
}
