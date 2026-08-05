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
}
