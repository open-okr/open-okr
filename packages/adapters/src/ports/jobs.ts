/**
 * The JobQueue port (TECHNICAL-PLAN §5).
 *
 * Background work. The critical rule is in the outbox contract: a write path
 * never calls `enqueue` directly. It inserts an outbox row in its own
 * transaction, and the relay calls this port once that transaction commits.
 * Calling `enqueue` from inside a write is a build failure
 * (`pnpm check:boundaries`).
 */

export interface JobOptions {
  /** Deduplication key. Enqueuing the same key twice is one job. */
  readonly idempotencyKey?: string;
  /** Delay before the job becomes runnable. */
  readonly startAfterSeconds?: number;
  readonly retryLimit?: number;
}

export type JobHandler<TPayload = unknown> = (
  payload: TPayload,
) => Promise<void>;

export interface JobQueue {
  /** Queues one job. Returns the driver's job id, or null when deduplicated. */
  enqueue(
    name: string,
    payload: Record<string, unknown>,
    options?: JobOptions,
  ): Promise<string | null>;

  /** Registers or replaces a cron schedule for a recurring job. */
  schedule(
    name: string,
    cron: string,
    payload?: Record<string, unknown>,
  ): Promise<void>;

  /** Subscribes a handler to a job name. */
  work<TPayload = unknown>(
    name: string,
    handler: JobHandler<TPayload>,
  ): Promise<void>;

  start(): Promise<void>;
  stop(): Promise<void>;
}
