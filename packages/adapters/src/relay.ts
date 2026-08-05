/**
 * The outbox relay (TECHNICAL-PLAN §5, "the outbox contract").
 *
 * Writes never call a driver. They insert an outbox row in their own
 * transaction, and this relay drains committed rows to the drivers at least
 * once. Two properties follow, and both are tested:
 *
 *  - A rolled back write delivers nothing. The relay only ever sees rows that
 *    committed, because uncommitted rows are invisible to its transaction.
 *  - A committed row is delivered once per idempotency key in the normal
 *    case. Delivery is at-least-once by design: a crash between the driver
 *    call and the commit that marks the row can repeat it, which is why every
 *    consumer must be idempotent on the key.
 *
 * Rows are claimed with FOR UPDATE SKIP LOCKED so several relay processes can
 * run at once without handing one row to two of them.
 *
 * Ordering is oldest first, but it is not a promise. Rows created in the same
 * instant have no defined order between them, and several relays draining
 * concurrently deliver in parallel by design. A consumer that needs ordering
 * gets it from the data it receives, never from arrival order.
 */

/** The database surface the relay needs: a pool that can hand out clients. */
export interface RelayPool {
  connect(): Promise<RelayClient>;
}

export interface RelayClient {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  release(): void;
}

export interface OutboxRecord {
  readonly id: string;
  readonly topic: string;
  readonly payload: Record<string, unknown>;
  readonly idempotencyKey: string;
  readonly attempts: number;
}

export interface OutboxRelayOptions {
  /** Where a claimed row goes. Throwing keeps the row pending for a retry. */
  readonly dispatch: (message: OutboxRecord) => Promise<void>;
  /** Rows claimed per drain. */
  readonly batchSize?: number;
  /** Milliseconds between drains once `start` is called. */
  readonly pollIntervalMs?: number;
  /** Delay before a failed row is retried. Exponential by default. */
  readonly backoffSeconds?: (attempts: number) => number;
  /**
   * How long a claimed row stays invisible to other relays. Set it above the
   * slowest dispatch you expect: too short and a slow delivery is retried
   * while it is still in flight.
   */
  readonly leaseSeconds?: number;
  /** Called when a drain itself fails, for logging. */
  readonly onError?: (error: unknown) => void;
}

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_LEASE_SECONDS = 60;

/** 2s, 4s, 8s ... capped at five minutes. */
const defaultBackoff = (attempts: number): number =>
  Math.min(2 ** Math.min(attempts, 8), 300);

export class OutboxRelay {
  readonly #pool: RelayPool;
  readonly #options: Required<Omit<OutboxRelayOptions, "onError">> &
    Pick<OutboxRelayOptions, "onError">;
  #timer: NodeJS.Timeout | undefined;
  #running = false;
  #draining: Promise<number> | undefined;

  constructor(pool: RelayPool, options: OutboxRelayOptions) {
    this.#pool = pool;
    this.#options = {
      dispatch: options.dispatch,
      batchSize: options.batchSize ?? DEFAULT_BATCH_SIZE,
      pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      backoffSeconds: options.backoffSeconds ?? defaultBackoff,
      leaseSeconds: options.leaseSeconds ?? DEFAULT_LEASE_SECONDS,
      onError: options.onError,
    };
  }

  /**
   * Claims one batch and dispatches it. Returns how many rows were delivered
   * successfully; failed rows stay pending with their attempt count raised.
   */
  async drainOnce(): Promise<number> {
    const claimed = await this.#claim();
    let delivered = 0;

    for (const record of claimed) {
      try {
        await this.#options.dispatch(record);
        await this.#markDelivered(record.id);
        delivered++;
      } catch (error) {
        await this.#markFailed(record, error);
      }
    }

    return delivered;
  }

  /** Starts the drain loop. Safe to call twice; the second call is ignored. */
  start(): void {
    if (this.#running) {
      return;
    }
    this.#running = true;

    const tick = async () => {
      if (!this.#running) {
        return;
      }
      try {
        // Held so `stop` can wait for an in-flight drain rather than cutting
        // it off mid-dispatch.
        this.#draining = this.drainOnce();
        await this.#draining;
      } catch (error) {
        this.#options.onError?.(error);
      } finally {
        this.#draining = undefined;
      }
      if (this.#running) {
        this.#timer = setTimeout(tick, this.#options.pollIntervalMs);
      }
    };

    this.#timer = setTimeout(tick, 0);
  }

  /** Stops the loop and waits for any drain already in flight. */
  async stop(): Promise<void> {
    this.#running = false;
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    await this.#draining?.catch(() => undefined);
  }

  /**
   * Claims due rows by leasing them: the same statement that selects a row
   * pushes its `available_at` beyond the lease, so a concurrent relay no
   * longer sees it as due.
   *
   * The row lock alone is not enough. It lives only as long as the claim
   * transaction, and that transaction has to commit before dispatch begins —
   * holding it across a driver call would pin a database connection for the
   * length of an HTTP request to someone else's service. Without the lease,
   * a second relay would claim the row while the first was still delivering
   * it. A relay that dies mid-dispatch simply lets its lease expire, and the
   * row is retried: at-least-once, which is why consumers deduplicate on the
   * idempotency key.
   */
  async #claim(): Promise<OutboxRecord[]> {
    const client = await this.#pool.connect();
    try {
      const result = await client.query(
        `update outbox
            set attempts = attempts + 1,
                available_at = now() + make_interval(secs => $2::double precision)
          where id in (
            select id
              from outbox
             where delivered_at is null
               and available_at <= now()
             order by created_at, id
             limit $1
               for update skip locked
          )
          returning id, topic, payload, idempotency_key, attempts, created_at`,
        [this.#options.batchSize, this.#options.leaseSeconds],
      );

      // The subquery picks the oldest rows, but UPDATE ... RETURNING hands
      // them back in whatever order it processed them. Sort here so dispatch
      // is oldest first too, rather than depending on the query plan.
      return result.rows
        .map((row) => ({
          id: row.id as string,
          topic: row.topic as string,
          payload: (row.payload ?? {}) as Record<string, unknown>,
          idempotencyKey: row.idempotency_key as string,
          attempts: row.attempts as number,
          createdAt: row.created_at as Date,
        }))
        .sort((a, b) => {
          const byAge = a.createdAt.getTime() - b.createdAt.getTime();
          return byAge !== 0 ? byAge : a.id.localeCompare(b.id);
        })
        .map(({ createdAt: _createdAt, ...record }) => record);
    } finally {
      client.release();
    }
  }

  async #markDelivered(id: string): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query(
        `update outbox
            set delivered_at = now(), last_error = null
          where id = $1 and delivered_at is null`,
        [id],
      );
    } finally {
      client.release();
    }
  }

  /** Replaces the claim lease with the retry backoff and records why. The
   * attempt was already counted when the row was claimed. */
  async #markFailed(record: OutboxRecord, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const backoff = this.#options.backoffSeconds(record.attempts);
    const client = await this.#pool.connect();
    try {
      await client.query(
        `update outbox
            set last_error = $2,
                available_at = now() + make_interval(secs => $3::double precision)
          where id = $1`,
        // Error text is truncated: it is diagnostic, and a driver can return
        // a very large body.
        [record.id, message.slice(0, 2000), backoff],
      );
    } finally {
      client.release();
    }
  }
}
