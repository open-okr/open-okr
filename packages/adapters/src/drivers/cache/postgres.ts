/**
 * The Postgres cache driver: shared across every process in a deployment,
 * with no service beyond the database OpenOKR already requires.
 *
 * Reads filter on expiry rather than trusting a sweeper, so a missed sweep
 * can never serve a stale value.
 */
import type { Cache, RateLimitResult } from "../../ports/cache.ts";

/** The query surface this driver needs: a pg Pool or Client. */
export interface CacheQueryable {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

export class PostgresCache implements Cache {
  readonly #db: CacheQueryable;

  constructor(db: CacheQueryable) {
    this.#db = db;
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const result = await this.#db.query(
      `select value from cache_entries
        where key = $1 and (expires_at is null or expires_at > now())`,
      [key],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : (row.value as T);
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    await this.#db.query(
      `insert into cache_entries (key, value, expires_at)
       values ($1, $2::jsonb, case when $3::double precision is null then null
                                   else now() + make_interval(secs => $3::double precision) end)
       on conflict (key) do update
          set value = excluded.value, expires_at = excluded.expires_at`,
      [key, JSON.stringify(value ?? null), ttlSeconds ?? null],
    );
  }

  async delete(key: string): Promise<void> {
    await this.#db.query("delete from cache_entries where key = $1", [key]);
  }

  async incr(key: string, by = 1, ttlSeconds?: number): Promise<number> {
    // One statement, so concurrent increments serialise on the row lock
    // rather than racing through a read-modify-write.
    const result = await this.#db.query(
      `insert into cache_entries (key, value, expires_at)
       values ($1, to_jsonb($2::bigint),
               case when $3::double precision is null then null
                    else now() + make_interval(secs => $3::double precision) end)
       on conflict (key) do update
          set value = to_jsonb(
                case when cache_entries.expires_at is not null
                          and cache_entries.expires_at <= now()
                     then $2::bigint
                     else coalesce((cache_entries.value)::text::bigint, 0) + $2::bigint
                end),
              -- An expired counter starts a fresh window; a live one keeps its own.
              expires_at = case when cache_entries.expires_at is not null
                                    and cache_entries.expires_at <= now()
                                then excluded.expires_at
                                else cache_entries.expires_at end
       returning (value)::text::bigint as value, expires_at`,
      [key, by, ttlSeconds ?? null],
    );
    return Number(result.rows[0]?.value ?? by);
  }

  async rateLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitResult> {
    const counterKey = `ratelimit:${key}`;
    const used = await this.incr(counterKey, 1, windowSeconds);
    const result = await this.#db.query(
      "select expires_at from cache_entries where key = $1",
      [counterKey],
    );
    const expiresAt = result.rows[0]?.expires_at as Date | null | undefined;
    const resetSeconds = expiresAt
      ? Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 1000))
      : windowSeconds;

    return {
      allowed: used <= limit,
      remaining: Math.max(0, limit - used),
      resetSeconds,
    };
  }

  /** Removes expired rows. Called by a scheduled job, never on the read path. */
  async sweep(): Promise<number> {
    const result = await this.#db.query(
      "delete from cache_entries where expires_at is not null and expires_at <= now()",
    );
    return result.rowCount ?? 0;
  }
}
