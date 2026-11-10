/**
 * The ErrorReporter port (TECHNICAL-PLAN §5, docs/design/error-reporting.md
 * D11, plan 0.7.0 E2).
 *
 * **What reaches this port is already safe.** Classification, the message
 * allow-list, the scrubbed frames, the caps, the JSON log line and the
 * counter all happen in `packages/core` before a report is handed over. A
 * driver's only job is to deliver what it is given, and it must never add a
 * field: an allow-list is only an allow-list if nothing downstream widens it.
 *
 * A port of its own rather than part of Telemetry: Telemetry's labels must be
 * bounded, and a report carries a workspace id and a member id as tags.
 */

/**
 * One report.
 *
 * **Declared here and again as `ErrorReport` in
 * `packages/core/src/errors/report.ts`, because neither package may import
 * the other.** The host passes a driver from here where core expects a sink,
 * and TypeScript checks the match there. Change one, change the other.
 */
export interface ErrorEvent {
  /** 32 hex characters. */
  readonly eventId: string;
  /** ISO 8601. */
  readonly timestamp: string;
  readonly source: string;
  readonly className: string;
  readonly message: string;
  /** Innermost first, the way a stack reads. */
  readonly frames: readonly ErrorEventFrame[];
  readonly fingerprint: string;
  readonly digest: string | null;
  readonly traceId: string | null;
  readonly spanId: string | null;
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

export interface ErrorEventFrame {
  readonly file: string;
  readonly function: string;
  readonly line: number | null;
  readonly column: number | null;
  readonly inApp: boolean;
}

/** Why a report did not reach the tracker. A fixed set: it is a metric label. */
export type ErrorReportDropReason =
  /** The queue held 100 already. The newest report is the one dropped. */
  | "queue_full"
  /** The tracker said 429, and its `Retry-After` has not passed yet. */
  | "rate_limited"
  /** No answer within the timeout, a refused connection, or a non-2xx. */
  | "send_failed";

export interface ErrorReporter {
  /**
   * Queues one report. Returns at once and never throws (D10): this runs on
   * the error path of everything else, and must never become the error.
   */
  report(event: ErrorEvent): void;
  /** Sends what is queued, giving up after `timeoutMs`. Never throws. */
  flush(timeoutMs: number): Promise<void>;
}
