/**
 * The pg-boss job queue driver: background work on Postgres, with no queue
 * service to run (PLAN.md §5).
 *
 * Write paths never call this. They insert an outbox row in their own
 * transaction, and the relay calls `enqueue` once that transaction has
 * committed. `pnpm check:boundaries` fails the build if a write path reaches
 * a driver directly.
 */
import { PgBoss } from "pg-boss";
import type { JobHandler, JobOptions, JobQueue } from "../../ports/jobs.ts";

export interface PgBossJobQueueOptions {
  readonly connectionString: string;
  /** Schema pg-boss owns. Kept apart from the application's tables. */
  readonly schema?: string;
  readonly onError?: (error: unknown) => void;
}

export class PgBossJobQueue implements JobQueue {
  readonly #boss: PgBoss;
  readonly #started: Set<string> = new Set();
  #running = false;

  constructor(options: PgBossJobQueueOptions) {
    this.#boss = new PgBoss({
      connectionString: options.connectionString,
      schema: options.schema ?? "pgboss",
    });
    this.#boss.on("error", (error) => options.onError?.(error));
  }

  async start(): Promise<void> {
    if (this.#running) {
      return;
    }
    await this.#boss.start();
    this.#running = true;
  }

  async stop(): Promise<void> {
    if (!this.#running) {
      return;
    }
    this.#running = false;
    // Graceful: let jobs already in flight finish rather than orphaning them
    // as active rows that only expire on a timeout.
    await this.#boss.stop({ graceful: true, close: true });
  }

  /**
   * Creates the queue on first use; pg-boss requires it to exist.
   *
   * The `short` policy is what makes `idempotencyKey` mean anything: it puts
   * a unique index on (queue, key) over jobs still waiting to run, so the
   * same key queued twice while pending is one job. Jobs sent without a key
   * are unaffected. This is the queue-side half of the safety that lets the
   * relay deliver at least once without doing the work twice.
   */
  async #ensureQueue(name: string): Promise<void> {
    if (this.#started.has(name)) {
      return;
    }
    await this.#boss.createQueue(name, { policy: "short" });
    this.#started.add(name);
  }

  async enqueue(
    name: string,
    payload: Record<string, unknown>,
    options?: JobOptions,
  ): Promise<string | null> {
    await this.#ensureQueue(name);
    // `singletonKey` is pg-boss's deduplication: the same key queued twice
    // while still pending is one job, which is what makes the relay's
    // at-least-once delivery safe to retry.
    return this.#boss.send(name, payload, {
      singletonKey: options?.idempotencyKey,
      startAfter: options?.startAfterSeconds,
      retryLimit: options?.retryLimit ?? 3,
    });
  }

  async schedule(
    name: string,
    cron: string,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    await this.#ensureQueue(name);
    await this.#boss.schedule(name, cron, payload);
  }

  async work<TPayload = unknown>(
    name: string,
    handler: JobHandler<TPayload>,
  ): Promise<void> {
    await this.#ensureQueue(name);
    // pg-boss hands the handler a batch. Failing one job of a batch fails the
    // batch, so each is awaited in turn rather than dropped.
    await this.#boss.work<TPayload>(name, async (jobs) => {
      for (const job of jobs) {
        await handler(job.data);
      }
    });
  }
}
