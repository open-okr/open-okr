/**
 * The in-process cache driver: a single instance's own memory.
 *
 * The right default for a one-container install. It is not shared between
 * processes, so anything that must hold across the whole deployment (a rate
 * limit on a login endpoint, for example) uses the Postgres driver instead.
 */
import type { Cache, RateLimitResult } from "../../ports/cache.ts";

interface Entry {
  readonly value: unknown;
  /** Epoch milliseconds, or undefined for no expiry. */
  readonly expiresAt: number | undefined;
}

/**
 * The unbounded-keyspace defect this bound closes (P2-T09, TECHNICAL-PLAN
 * §8.2): `#live` only ever expires an entry when that exact key is read
 * again, and `rateLimit` mints one counter key per subject — an IP address,
 * a member id, whatever the caller passes. A subject that calls in once and
 * never returns (an attacker trying one address, most invitees) leaves its
 * entry sitting in `#entries` for the life of the process; nothing sweeps.
 * A hard cap turns "grows forever" into "grows to here and stops": once
 * full, the oldest-inserted entry is evicted to make room, `Map` iteration
 * order being insertion order. Generous rather than exact — this driver is
 * documented as the single-container default, not the one a deployment
 * leans on for precision under sustained abuse; `PostgresCache` is that one.
 */
const DEFAULT_MAX_ENTRIES = 10_000;

export class InProcessCache implements Cache {
  readonly #entries = new Map<string, Entry>();
  readonly #maxEntries: number;

  constructor(options: { readonly maxEntries?: number } = {}) {
    this.#maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  #live(key: string): Entry | undefined {
    const entry = this.#entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry;
  }

  /** Evicts the oldest-inserted entries until back at the cap. A `set` on an
   * already-present key does not move it, so this is FIFO over first-seen
   * order rather than a true LRU — cheap, and enough to bound memory. */
  #evictOverflow(): void {
    while (this.#entries.size > this.#maxEntries) {
      const oldestKey = this.#entries.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.#entries.delete(oldestKey);
    }
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.#live(key)?.value as T | undefined;
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    this.#entries.set(key, {
      value,
      expiresAt:
        ttlSeconds === undefined ? undefined : Date.now() + ttlSeconds * 1000,
    });
    this.#evictOverflow();
  }

  async delete(key: string): Promise<void> {
    this.#entries.delete(key);
  }

  async incr(key: string, by = 1, ttlSeconds?: number): Promise<number> {
    const current = this.#live(key);
    const next = (typeof current?.value === "number" ? current.value : 0) + by;
    this.#entries.set(key, {
      value: next,
      // An existing counter keeps its window; only a new one takes the ttl.
      expiresAt:
        current?.expiresAt ??
        (ttlSeconds === undefined ? undefined : Date.now() + ttlSeconds * 1000),
    });
    this.#evictOverflow();
    return next;
  }

  async rateLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitResult> {
    const counterKey = `ratelimit:${key}`;
    const used = await this.incr(counterKey, 1, windowSeconds);
    const expiresAt = this.#entries.get(counterKey)?.expiresAt;
    const resetSeconds = expiresAt
      ? Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))
      : windowSeconds;

    return {
      allowed: used <= limit,
      remaining: Math.max(0, limit - used),
      resetSeconds,
    };
  }

  async stop(): Promise<void> {
    // Plain process memory: nothing to release. `#entries` is left as is
    // rather than cleared, since a process about to exit has no more use for
    // either state.
  }
}
