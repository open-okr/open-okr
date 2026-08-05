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

export class InProcessCache implements Cache {
  readonly #entries = new Map<string, Entry>();

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

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.#live(key)?.value as T | undefined;
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    this.#entries.set(key, {
      value,
      expiresAt:
        ttlSeconds === undefined ? undefined : Date.now() + ttlSeconds * 1000,
    });
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
}
