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
 * **Ordering is round-robin by workspace, and it is not a promise**
 * (P8-T06b). It was oldest first until then, which is FIFO, and FIFO is what
 * let one import's forty thousand rows sit in front of every other
 * workspace's nudge. Each workspace's pending rows are ranked by age and the
 * batch takes rank one of every workspace, then rank two, and so on; with a
 * single workspace holding rows that is the old order exactly, so nothing
 * slows down when there is nobody to be fair to.
 *
 * Rows created in the same instant have no defined order between them, and
 * several relays draining concurrently deliver in parallel by design. A
 * consumer that needs ordering gets it from the data it receives, never from
 * arrival order.
 */

import type { MetricLabels, MetricRecorder } from "./ports/telemetry.ts";

/**
 * Thrown by a dispatcher when retrying cannot possibly help (P5-T01a).
 *
 * The relay's default is to retry, because most delivery failures are a
 * provider having a bad minute. Some are not: a topic nothing handles, a
 * payload that does not parse, a row naming an entity that has since been
 * deleted. Retrying those ten times over an hour produces ten identical
 * failures and one dead letter an hour late.
 *
 * A dispatcher that throws this dead-letters the row at once, so the problem is
 * visible while somebody is still looking.
 */
export class PermanentDispatchError extends Error {
  override readonly name = "PermanentDispatchError";
}

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
  /**
   * Attempts before a row is dead-lettered instead of retried again. Before
   * this existed, a row that could never succeed retried on the lease
   * interval forever, invisible to anyone: `last_error` held the reason but
   * nothing read it, and `attempts` climbed with no ceiling anywhere.
   */
  readonly maxAttempts?: number;
  /** Called when a drain itself fails, for logging. */
  readonly onError?: (error: unknown) => void;
  /** Called the moment a row is dead-lettered, so it is surfaced somewhere rather than only sitting in the table. */
  readonly onDeadLetter?: (record: OutboxRecord, error: unknown) => void;
  /**
   * Where to record what the relay did, when the host is measuring itself
   * (P7-T06b).
   *
   * Absent is a relay that delivers exactly as it always did. Passing one
   * also registers the two queue gauges, which are read on every scrape
   * rather than written on every drain, because the number an operator
   * needs is how far behind the queue is *now* and a stopped relay writes
   * nothing at all.
   */
  readonly metrics?: MetricRecorder;
  /**
   * Payload fields to strip from a row the moment it is delivered, by topic
   * (completeness review M-19).
   *
   * An invitation's email has to carry the raw token and the address through
   * the outbox, because the row is the only place they exist once the write
   * commits. After the email has gone they are a secret and a personal
   * address sitting in a table forever. The host names the fields; this
   * package knows nothing about invitations.
   */
  readonly redactOnDelivery?: Readonly<Record<string, readonly string[]>>;
  /**
   * Claims one workspace may take in a sliding minute (docs/design/
   * tenant-limits.md §10, plan 0.7.0 P6 and P7). Read on every claim, so a
   * host that resolves its settings after starting the relay is honoured.
   *
   * Zero or absent is unlimited, and then the relay runs exactly as before:
   * no claim time written, no count, today's order. With a number, each
   * workspace is offered only what is left of its minute; its other rows wait
   * untouched, with no attempt counted, so waiting never dead-letters them.
   * Rows that belong to no workspace are never held.
   */
  readonly rowsPerMinute?: () => number;
  /**
   * A topic that retries on its own schedule rather than `backoffSeconds`
   * and `maxAttempts` (docs/design/outbound-webhooks.md W9). A webhook
   * receiver down for a deploy is retried for about a day; an email is not.
   * The host names the topics; this package knows nothing about webhooks.
   */
  readonly retryPolicy?: Readonly<
    Record<
      string,
      {
        readonly maxAttempts: number;
        readonly backoffSeconds: (attempts: number) => number;
      }
    >
  >;
}

/**
 * Deletes the rows the relay has finished with: delivered, or dead-lettered,
 * more than `olderThanDays` ago (completeness review M-19). Zero or less keeps
 * everything. A pending row is never touched, whatever its age.
 */
export async function purgeSettledOutbox(
  pool: RelayPool,
  olderThanDays: number,
): Promise<number> {
  if (!(olderThanDays > 0)) {
    return 0;
  }
  const client = await pool.connect();
  try {
    const result = await client.query(
      `delete from outbox
        where (delivered_at is not null and delivered_at < now() - make_interval(days => $1))
           or (dead_lettered_at is not null and dead_lettered_at < now() - make_interval(days => $1))`,
      [Math.floor(olderThanDays)],
    );
    return result.rowCount ?? 0;
  } finally {
    client.release();
  }
}

/**
 * The series this file records.
 *
 * Spelled out here rather than imported from `packages/core`'s `METRIC`,
 * because this package sits below that one and may not reach it. The same
 * trade `MetricRecorder` makes two files up, and `telemetry.test.ts` asserts
 * the two lists still agree so a rename in one cannot quietly split a
 * dashboard in two.
 */
const OUTBOX_DISPATCHED = "openokr_outbox_dispatched_total";
const OUTBOX_DEAD_LETTERED = "openokr_outbox_dead_lettered_total";
const OUTBOX_PENDING = "openokr_outbox_pending";
const OUTBOX_OLDEST_PENDING_SECONDS = "openokr_outbox_oldest_pending_seconds";
/** Workspaces at their outbox rate now (tenant-limits.md §10 R11). */
const OUTBOX_RATE_HELD_WORKSPACES = "openokr_outbox_rate_held_workspaces";
/** Due rows waiting only because their workspace is at its rate (R11). */
const OUTBOX_RATE_HELD_ROWS = "openokr_outbox_rate_held_rows";

/**
 * Each workspace's claims in the last minute (R2, R3). The outbox already
 * holds every claim in `claimed_at`, so this is the one record of the rate:
 * every relay process reads the same rows and agrees. Rows with no workspace
 * are left out, because no tenant's rate applies to them (R8).
 */
const CLAIMS_LAST_MINUTE = `used as (
  select workspace_id, count(*)::int as n
    from outbox
   where claimed_at > now() - interval '60 seconds'
     and workspace_id is not null
   group by workspace_id
)`;

/** A positive whole number of claims a minute, or 0 for unlimited. */
function rateOf(rowsPerMinute: number | undefined): number {
  return rowsPerMinute !== undefined &&
    Number.isFinite(rowsPerMinute) &&
    rowsPerMinute > 0
    ? Math.floor(rowsPerMinute)
    : 0;
}

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_LEASE_SECONDS = 60;
const DEFAULT_MAX_ATTEMPTS = 10;

/**
 * How many rows ahead of the batch the fair read looks for candidates
 * (P8-T06b).
 *
 * **Concurrent relays are the reason, and the first version of this change
 * had it wrong.** The fair order needs a window function, a window function
 * cannot share a query level with `FOR UPDATE`, so the ranking and the claim
 * are two statements. Ask the ranking for exactly one batch and every relay
 * draining at the same moment proposes the same ids: one of them locks all
 * of them and the rest claim nothing. Four relays then deliver a quarter of
 * what one delivers, which is not a smaller pass, it is three idle passes.
 * The suite measured it: fifteen rows delivered where twenty exist.
 *
 * So the ranking hands back this many batches' worth of ids, in rank order,
 * and the claim takes the first `batchSize` of them nothing else holds. A
 * relay that arrives second skips what is locked and takes the next
 * candidates, which are still the fair ones.
 *
 * **It costs almost nothing.** The ranking already ranks every pending row
 * to order any of them, so a wider limit transfers more ids and scans no
 * further. Past this many concurrent relays a latecomer gets a short batch
 * and picks the rest up on its next poll a second later, which is the
 * smaller pass the original comment claimed.
 */
const CLAIM_CANDIDATE_BATCHES = 8;

/** 2s, 4s, 8s ... capped at five minutes. */
const defaultBackoff = (attempts: number): number =>
  Math.min(2 ** Math.min(attempts, 8), 300);

export interface DeadLetteredOutboxRecord extends OutboxRecord {
  readonly lastError: string | null;
  readonly deadLetteredAt: Date;
}

export class OutboxRelay {
  readonly #pool: RelayPool;
  readonly #options: Required<
    Omit<
      OutboxRelayOptions,
      | "onError"
      | "onDeadLetter"
      | "metrics"
      | "redactOnDelivery"
      | "rowsPerMinute"
      | "retryPolicy"
    >
  > &
    Pick<
      OutboxRelayOptions,
      | "onError"
      | "onDeadLetter"
      | "metrics"
      | "redactOnDelivery"
      | "rowsPerMinute"
      | "retryPolicy"
    >;
  #timer: NodeJS.Timeout | undefined;
  #running = false;
  #draining: Promise<number> | undefined;
  /**
   * Set by `stop`, cleared by `start`. A drain checks it before each row, so
   * a stop takes effect between rows rather than after the whole batch.
   */
  #stopping = false;
  /**
   * The claimed rows of the drain in flight that have not been started yet.
   * The same array the drain takes its next row from, so `stop` can take the
   * rest in one synchronous splice and no row is both released and sent.
   */
  #rest: OutboxRecord[] | undefined;
  /** Whether a row is being dispatched now. */
  #dispatching = false;
  /** Rows handed back since the last `stop` began. */
  #released = 0;

  constructor(pool: RelayPool, options: OutboxRelayOptions) {
    this.#pool = pool;
    this.#options = {
      dispatch: options.dispatch,
      batchSize: options.batchSize ?? DEFAULT_BATCH_SIZE,
      pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      backoffSeconds: options.backoffSeconds ?? defaultBackoff,
      leaseSeconds: options.leaseSeconds ?? DEFAULT_LEASE_SECONDS,
      maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      onError: options.onError,
      onDeadLetter: options.onDeadLetter,
      metrics: options.metrics,
      redactOnDelivery: options.redactOnDelivery,
      rowsPerMinute: options.rowsPerMinute,
      retryPolicy: options.retryPolicy,
    };

    // **Registered here, not in the drain loop, and read at scrape time.**
    // This is what makes a stopped relay legible. Counters written during a
    // drain say nothing once draining stops, so the series goes flat at
    // whatever it last reported and the outage looks like quiet. These are
    // queries against the world as it is when somebody asks, so a relay
    // that died an hour ago reports an hour of lag.
    if (options.metrics) {
      OutboxRelay.registerGauges(pool, options.metrics, options.rowsPerMinute);
    }
  }

  /**
   * Registers the queue's gauges, with or without a relay (plan 0.8.0 H10d,
   * docs/design/worker-deployment.md §1.3).
   *
   * A relay registers them when it is built. A process with the relay on
   * another pod (`OPENOKR_RELAY=elsewhere`) calls this instead, so a scrape
   * of the Service still shows how far behind the queue is: every number
   * here is a query against the shared outbox, the same from any process.
   */
  static registerGauges(
    pool: RelayPool,
    metrics: Pick<MetricRecorder, "gauge">,
    rowsPerMinute?: () => number,
  ): void {
    const rate = (): number => rateOf(rowsPerMinute?.());
    metrics.gauge(OUTBOX_PENDING, () => OutboxRelay.pendingCount(pool));
    metrics.gauge(OUTBOX_OLDEST_PENDING_SECONDS, () =>
      OutboxRelay.oldestPendingSeconds(pool, rate()),
    );
    // Whether the outbox rate is engaging now, and how much it holds (R11).
    // Each answers 0 without a query while the limit is unset.
    metrics.gauge(
      OUTBOX_RATE_HELD_WORKSPACES,
      async () => (await OutboxRelay.rateHeld(pool, rate())).workspaces,
    );
    metrics.gauge(
      OUTBOX_RATE_HELD_ROWS,
      async () => (await OutboxRelay.rateHeld(pool, rate())).rows,
    );
  }

  /** The outbox rate now, read on every use (R1). */
  #rate(): number {
    return rateOf(this.#options.rowsPerMinute?.());
  }

  /** Rows waiting: not delivered and not given up on. */
  static async pendingCount(pool: RelayPool): Promise<number> {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `select count(*)::bigint as pending
           from outbox
          where delivered_at is null
            and dead_lettered_at is null`,
      );
      return Number(result.rows[0]?.pending ?? 0);
    } finally {
      client.release();
    }
  }

  /**
   * Age of the oldest waiting row, in seconds. Zero when nothing waits.
   *
   * Measured from `created_at`, the moment the write committed the row, and
   * deliberately not from `available_at`. A row being backed off has
   * `available_at` in the future, and measuring from that would report a
   * *negative* lag for exactly the rows that are struggling, which is the
   * opposite of the signal. What an operator needs is how long the oldest
   * piece of undelivered work has been undelivered.
   */
  /**
   * The oldest-pending-seconds query, exposed for the status endpoint
   * (P8-T06c). The relay registers it as a gauge at construction; the
   * status endpoint needs the same number without constructing a relay.
   */
  static async oldestPendingSeconds(
    pool: RelayPool,
    rowsPerMinute = 0,
  ): Promise<number> {
    const rate = rateOf(rowsPerMinute);
    const client = await pool.connect();
    try {
      // **With an outbox rate, the rate's own work is not lag** (R10). A
      // workspace at its rate now is left out: the relay is keeping up with
      // everything it is allowed to deliver, and forty thousand rows at 600 a
      // minute would otherwise read as an outage. With none, today's query.
      const result =
        rate === 0
          ? await client.query(
              `select coalesce(
                        extract(epoch from (now() - min(created_at))), 0
                      )::double precision as lag
                 from outbox
                where delivered_at is null
                  and dead_lettered_at is null`,
            )
          : await client.query(
              `with ${CLAIMS_LAST_MINUTE}
               select coalesce(
                        extract(epoch from (now() - min(o.created_at))), 0
                      )::double precision as lag
                 from outbox o
                where o.delivered_at is null
                  and o.dead_lettered_at is null
                  and (o.workspace_id is null
                       or o.workspace_id not in (
                         select workspace_id from used where n >= $1))`,
              [rate],
            );
      return Math.max(0, Number(result.rows[0]?.lag ?? 0));
    } finally {
      client.release();
    }
  }

  /**
   * How much the outbox rate holds now (R11): the workspaces at their rate,
   * and their due rows waiting only because of it. Both 0, with no query,
   * while the limit is unset. Static, like the lag, so a scrape and the
   * status endpoint ask without a relay.
   */
  static async rateHeld(
    pool: RelayPool,
    rowsPerMinute = 0,
  ): Promise<{ readonly workspaces: number; readonly rows: number }> {
    const rate = rateOf(rowsPerMinute);
    if (rate === 0) {
      return { workspaces: 0, rows: 0 };
    }
    const client = await pool.connect();
    try {
      const result = await client.query(
        `with ${CLAIMS_LAST_MINUTE},
              held as (select workspace_id from used where n >= $1)
         select count(distinct o.workspace_id)::int as workspaces,
                count(*)::int as rows
           from outbox o
           join held h on h.workspace_id = o.workspace_id
          where o.delivered_at is null
            and o.dead_lettered_at is null
            and o.available_at <= now()`,
        [rate],
      );
      return {
        workspaces: Number(result.rows[0]?.workspaces ?? 0),
        rows: Number(result.rows[0]?.rows ?? 0),
      };
    } finally {
      client.release();
    }
  }

  #count(name: string, labels: MetricLabels): void {
    this.#options.metrics?.count(name, labels);
  }

  /**
   * Dead-lettered rows, newest first. The visibility `last_error` alone
   * never gave: nothing queried for it before.
   */
  async listDeadLettered(limit = 50): Promise<DeadLetteredOutboxRecord[]> {
    const client = await this.#pool.connect();
    try {
      const result = await client.query(
        `select id, topic, payload, idempotency_key, attempts, last_error, dead_lettered_at
           from outbox
          where dead_lettered_at is not null
          order by dead_lettered_at desc
          limit $1`,
        [limit],
      );
      return result.rows.map((row) => ({
        id: row.id as string,
        topic: row.topic as string,
        payload: (row.payload ?? {}) as Record<string, unknown>,
        idempotencyKey: row.idempotency_key as string,
        attempts: row.attempts as number,
        lastError: (row.last_error as string | null) ?? null,
        deadLetteredAt: row.dead_lettered_at as Date,
      }));
    } finally {
      client.release();
    }
  }

  /**
   * Claims one batch and dispatches it. Returns how many rows were delivered
   * successfully; failed rows stay pending with their attempt count raised.
   *
   * Held as the drain in flight, whoever calls it, so `stop` waits for this
   * one too and not only for the loop's.
   */
  drainOnce(): Promise<number> {
    const run = this.#drain();
    this.#draining = run;
    return run.finally(() => {
      if (this.#draining === run) {
        this.#draining = undefined;
      }
    });
  }

  async #drain(): Promise<number> {
    if (this.#stopping) {
      return 0;
    }
    const claimed = await this.#claim();
    let delivered = 0;
    // A stop that arrived during the claim finds this array empty, so the
    // check after the loop is what hands those rows back.
    const rest = claimed.slice();
    this.#rest = rest;

    try {
      while (rest.length > 0 && !this.#stopping) {
        const record = rest.shift() as OutboxRecord;
        this.#dispatching = true;
        try {
          delivered += await this.#deliver(record);
        } finally {
          this.#dispatching = false;
        }
      }
      if (rest.length > 0) {
        await this.#release(rest.splice(0));
      }
    } finally {
      if (this.#rest === rest) {
        this.#rest = undefined;
      }
    }

    return delivered;
  }

  /** One row: dispatched and marked. 1 when it was delivered. */
  async #deliver(record: OutboxRecord): Promise<number> {
    try {
      await this.#options.dispatch(record);
      await this.#markDelivered(record);
      this.#count(OUTBOX_DISPATCHED, { topic: record.topic, outcome: "ok" });
      return 1;
    } catch (error) {
      const deadLettered = await this.#markFailed(record, error);
      // Counted apart because they mean different things to whoever is
      // watching. A failure is a provider having a bad minute and the row
      // will be tried again. A dead letter is work this instance has given
      // up on, and somebody has to look at it.
      this.#count(OUTBOX_DISPATCHED, {
        topic: record.topic,
        outcome: deadLettered ? "dead_lettered" : "failed",
      });
      if (deadLettered) {
        this.#count(OUTBOX_DEAD_LETTERED, { topic: record.topic });
      }
      return 0;
    }
  }

  /** Starts the drain loop. Safe to call twice; the second call is ignored. */
  start(): void {
    if (this.#running) {
      return;
    }
    this.#running = true;
    this.#stopping = false;

    const tick = async () => {
      if (!this.#running) {
        return;
      }
      try {
        // `drainOnce` holds itself as the drain in flight, so `stop` can
        // wait for it rather than cutting it off mid-dispatch.
        await this.drainOnce();
      } catch (error) {
        this.#options.onError?.(error);
      }
      if (this.#running) {
        this.#timer = setTimeout(tick, this.#options.pollIntervalMs);
      }
    };

    this.#timer = setTimeout(tick, 0);
  }

  /**
   * Stops the loop between rows (plan 0.8.0 H10a,
   * docs/design/worker-deployment.md D6).
   *
   * The row being dispatched finishes and is marked. The rest of its batch
   * goes back at once, due now and with the attempt the claim counted taken
   * off again, so another relay takes them on its next poll and a deploy
   * never counts toward dead-lettering a row. Waiting for the whole batch, up
   * to fifty rows and any of them a copilot run, does not fit a drain of
   * seconds; leaving them claimed cost each one the full lease.
   *
   * The rest are released before the row in flight is waited for, so a
   * dispatch that outlives the process's bound strands only itself, and that
   * one is delivered again after its lease, as after a crash.
   */
  async stop(): Promise<{
    /** Rows of the batch handed back without being sent. */
    readonly released: number;
    /** Whether a row was being dispatched when the stop began. */
    readonly waited: boolean;
  }> {
    this.#running = false;
    this.#stopping = true;
    this.#released = 0;
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    const waited = this.#dispatching;
    const rest = this.#rest?.splice(0) ?? [];
    if (rest.length > 0) {
      try {
        await this.#release(rest);
      } catch (error) {
        // They wait out their lease instead, as they did before this existed.
        this.#options.onError?.(error);
      }
    }
    await this.#draining?.catch(() => undefined);
    return { released: this.#released, waited };
  }

  /**
   * Hands claimed rows back unsent: due now, and with the attempt their
   * claim counted taken off. A row something else has settled since is left
   * alone.
   */
  async #release(records: readonly OutboxRecord[]): Promise<void> {
    const client = await this.#pool.connect();
    try {
      const result = await client.query(
        `update outbox
            set available_at = now(),
                attempts = greatest(attempts - 1, 0)
          where id = any($1::uuid[])
            and delivered_at is null
            and dead_lettered_at is null`,
        [records.map((record) => record.id)],
      );
      this.#released += result.rowCount ?? 0;
    } finally {
      client.release();
    }
  }

  /**
   * Claims due rows by leasing them: the same statement that selects a row
   * pushes its `available_at` beyond the lease, so a concurrent relay no
   * longer sees it as due.
   *
   * **Round-robin by workspace, not oldest first** (P8-T06b, design §5).
   * Oldest first is FIFO, and FIFO is the unfair part: one import writing
   * forty thousand rows put every other workspace's nudge behind forty
   * thousand jobs, and not one of those jobs had exceeded any limit. Ranking
   * each workspace's pending rows and ordering by that rank takes the first
   * row of every workspace, then the second of every workspace, and so on.
   *
   * **It costs nothing when there is nobody to be fair to**, which is design
   * §8 criterion 7 and the reason there is no per-workspace cap in this
   * query. With one workspace holding rows, every rank is distinct and
   * ascending, so the order is exactly what it was before this change and
   * the batch fills at full speed. Fairness that slowed a single-tenant
   * instance down would be a tax every self-hosted deployment paid for a
   * problem it does not have.
   *
   * **Why the join rather than one query level.** Postgres refuses
   * `FOR UPDATE` in a query that has a window function, so the ranking sits
   * in a subquery and the locking clause names the outer table by alias.
   *
   * Rows with no workspace share one bucket. That is the honest answer for a
   * row written outside a tenant-scoped transaction: it belongs to no
   * workspace, so it queues with the others like it rather than being given
   * a bucket of its own and an unfair share.
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
      // **Two statements, and the first one takes no lock.** The fair order
      // needs a window function, and a window function cannot sit in the
      // same query level as `FOR UPDATE`. Putting it in a joined subquery
      // compiles and is wrong: the locking clause then applies above the
      // `LIMIT`, so two relays pick the same ids, the second blocks on the
      // row lock rather than skipping it, and when it unblocks it updates
      // rows the first already claimed. Measured, not reasoned about: the
      // concurrency test in this suite delivered twenty-five rows where
      // twenty exist.
      //
      // So the ranking picks the ids and the claim locks them, on a single
      // table, exactly as it did before this change.
      //
      // **The ranking asks for more than one batch, and that is not a
      // performance tweak.** With one batch of candidates, relays draining
      // at the same moment all propose the same ids, the first locks every
      // one and the others claim nothing: four relays delivered fifteen
      // rows where twenty existed. `CLAIM_CANDIDATE_BATCHES` says why the
      // window is wider. The claim keeps the `limit`, so a relay still takes
      // one batch; it just takes the first batch of candidates nothing else
      // is holding.
      // **With an outbox rate, each workspace offers only what is left of
      // its minute** (tenant-limits.md §10 R6, R7). The rank already orders
      // a workspace's rows by age, so keeping the ranks up to its remaining
      // budget removes candidates and reorders nothing. A workspace with
      // nothing left offers none, and its rows are not touched. With no rate,
      // today's statement, so an instance with nobody to hold pays nothing.
      const rate = this.#rate();
      const fair =
        rate === 0
          ? await client.query(
              `select id
                 from (
                   select id, created_at,
                          row_number() over (
                            partition by workspace_id
                            order by created_at, id
                          ) as rank
                     from outbox
                    where delivered_at is null
                      and dead_lettered_at is null
                      and available_at <= now()
                 ) ranked
                order by rank, created_at, id
                limit $1`,
              [this.#options.batchSize * CLAIM_CANDIDATE_BATCHES],
            )
          : await client.query(
              `with ${CLAIMS_LAST_MINUTE}
               select ranked.id
                 from (
                   select id, created_at, workspace_id,
                          row_number() over (
                            partition by workspace_id
                            order by created_at, id
                          ) as rank
                     from outbox
                    where delivered_at is null
                      and dead_lettered_at is null
                      and available_at <= now()
                 ) ranked
                 left join used on used.workspace_id = ranked.workspace_id
                where ranked.workspace_id is null
                   or ranked.rank <= $2::int - coalesce(used.n, 0)
                order by ranked.rank, ranked.created_at, ranked.id
                limit $1`,
              [this.#options.batchSize * CLAIM_CANDIDATE_BATCHES, rate],
            );
      const ids = fair.rows.map((row) => row.id as string);
      if (ids.length === 0) {
        return [];
      }

      // The claim time is what the rate counts (R3), and only written when
      // there is a rate, so an unlimited instance writes nothing new (R5).
      const result = await client.query(
        `update outbox
            set attempts = attempts + 1,
                available_at = now() + make_interval(secs => $2::double precision),
                claimed_at = case when $4::boolean then now() else claimed_at end
          where id in (
            select id
              from outbox
             where id = any($1::uuid[])
               and delivered_at is null
               and dead_lettered_at is null
               and available_at <= now()
             order by array_position($1::uuid[], id)
             limit $3
               for update skip locked
          )
          returning id, topic, payload, idempotency_key, attempts, created_at,
                    workspace_id`,
        [ids, this.#options.leaseSeconds, this.#options.batchSize, rate > 0],
      );

      // **The subquery's order has to be rebuilt here, and this is where the
      // fair read would have been undone** (P8-T06b). `UPDATE ... RETURNING`
      // hands rows back in whatever order it processed them, so this sort
      // decides the dispatch order. It sorted oldest first, which is exactly
      // the FIFO the claim query stopped doing: the interleaving would have
      // been computed and then thrown away, and the change would have looked
      // like it worked because the right rows were claimed.
      //
      // So the rank is recomputed over what came back: each workspace's rows
      // in age order, then taken one workspace at a time.
      const claimed = result.rows.map((row) => ({
        id: row.id as string,
        topic: row.topic as string,
        payload: (row.payload ?? {}) as Record<string, unknown>,
        idempotencyKey: row.idempotency_key as string,
        attempts: row.attempts as number,
        createdAt: row.created_at as Date,
        workspaceId: (row.workspace_id ?? null) as string | null,
      }));

      const seen = new Map<string, number>();
      const ranked = claimed
        .slice()
        .sort((a, b) => {
          const byAge = a.createdAt.getTime() - b.createdAt.getTime();
          return byAge !== 0 ? byAge : a.id.localeCompare(b.id);
        })
        .map((record) => {
          // Null is its own bucket, named rather than skipped: a row with no
          // workspace still queues fairly against the other rows with none.
          const bucket = record.workspaceId ?? "";
          const rank = (seen.get(bucket) ?? 0) + 1;
          seen.set(bucket, rank);
          return { record, rank };
        });

      return ranked
        .sort((a, b) => {
          if (a.rank !== b.rank) {
            return a.rank - b.rank;
          }
          const byAge =
            a.record.createdAt.getTime() - b.record.createdAt.getTime();
          return byAge !== 0 ? byAge : a.record.id.localeCompare(b.record.id);
        })
        .map(
          ({
            record: {
              createdAt: _createdAt,
              workspaceId: _workspaceId,
              ...record
            },
          }) => record,
        );
    } finally {
      client.release();
    }
  }

  async #markDelivered(record: OutboxRecord): Promise<void> {
    // In the same statement as the stamp, so there is no moment at which a
    // row reads as delivered and still holds what it carried.
    const redact = this.#options.redactOnDelivery?.[record.topic] ?? [];
    const client = await this.#pool.connect();
    try {
      await client.query(
        `update outbox
            set delivered_at = now(), last_error = null,
                payload = payload - $2::text[]
          where id = $1 and delivered_at is null`,
        [record.id, [...redact]],
      );
    } finally {
      client.release();
    }
  }

  /**
   * Replaces the claim lease with the retry backoff and records why. The
   * attempt was already counted when the row was claimed.
   *
   * Once `attempts` reaches the ceiling, this dead-letters the row instead:
   * `available_at` stops moving, so it drops out of the claim query for
   * good, and `onDeadLetter` fires so giving up is not a silent event.
   *
   * A `PermanentDispatchError` skips the ceiling and dead-letters on the first
   * attempt, because the dispatcher has said retrying cannot help (P5-T01a).
   */
  async #markFailed(record: OutboxRecord, error: unknown): Promise<boolean> {
    const message = error instanceof Error ? error.message : String(error);
    // Truncated: the text is diagnostic, and a driver can return a very
    // large body.
    const truncated = message.slice(0, 2000);
    const permanent =
      error instanceof Error && error.name === "PermanentDispatchError";
    const policy = this.#options.retryPolicy?.[record.topic];
    const maxAttempts = policy?.maxAttempts ?? this.#options.maxAttempts;
    const client = await this.#pool.connect();
    try {
      if (permanent || record.attempts >= maxAttempts) {
        await client.query(
          `update outbox
              set last_error = $2, dead_lettered_at = now()
            where id = $1`,
          [record.id, truncated],
        );
        this.#options.onDeadLetter?.(record, error);
        return true;
      }

      const backoff = (policy?.backoffSeconds ?? this.#options.backoffSeconds)(
        record.attempts,
      );
      await client.query(
        `update outbox
            set last_error = $2,
                available_at = now() + make_interval(secs => $3::double precision)
          where id = $1`,
        [record.id, truncated, backoff],
      );
      return false;
    } finally {
      client.release();
    }
  }
}
