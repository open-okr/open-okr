/**
 * The Cache port (TECHNICAL-PLAN §5).
 *
 * A cache miss is never an error: every caller must work with the cache
 * empty. `rateLimit` is here rather than in a separate port because the
 * counter and its window are the same primitive.
 */

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  /** Seconds until the window resets. */
  readonly resetSeconds: number;
}

export interface Cache {
  get<T = unknown>(key: string): Promise<T | undefined>;
  /** `ttlSeconds` omitted means the driver's default lifetime. */
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  /** Atomic increment. Creates the counter at `by` when absent. */
  incr(key: string, by?: number, ttlSeconds?: number): Promise<number>;
  /** Fixed-window limit: at most `limit` hits per `windowSeconds`. */
  rateLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitResult>;
  /** Releases whatever this driver holds open. Neither shipped driver owns a
   * resource of its own (the Postgres one shares an injected pool, the
   * in-process one is plain memory), so both no-op; declared on the port so a
   * future driver that does own one is not exempt from being shut down. */
  stop(): Promise<void>;
}
