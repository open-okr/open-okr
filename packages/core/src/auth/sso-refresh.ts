/**
 * Keeping a running process's single sign-on in step with the table
 * (completeness review L-15).
 *
 * Better Auth reads its plugins once, when an instance is built.
 * `genericOAuth` resolves every OIDC provider in its `init`, and the SAML
 * plugin is mounted only when a SAML provider exists at that moment. So a
 * connection an administrator added, changed or removed reached nobody until
 * the process restarted, and on a deployment with several processes, until
 * every one of them had.
 *
 * **What changes is detected, not announced.** Each process reads a stamp of
 * `sso_connections` from the database and rebuilds its instance when the
 * stamp moves. An in-process event would reach the process that saved the
 * change and none of the others; the database is the one thing they share.
 *
 * **One small read every few seconds, not one per request.** The stamp is a
 * digest the database computes over a table with a handful of rows, and one
 * reading is trusted for `SSO_STAMP_MAX_AGE_MS`. The process that saved a
 * change expires its reading straight away, so the administrator who added a
 * provider can use it on their next click.
 *
 * **Nothing about a session depends on the instance.** Sessions are rows,
 * cookies are signed with the instance secret, OAuth state is stored in the
 * database, and Better Auth's rate-limit counters live in its module rather
 * than on an instance. A rebuilt instance reads all of them as the old one
 * did, so nobody is signed out and no lockout is forgotten.
 */
import { withSSOLookup } from "@openokr/db";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { SSOProviderConfig } from "./sso.ts";

/**
 * How long one reading of the stamp is trusted.
 *
 * The longest another process can go on serving a connection that changed.
 * Five seconds is well inside the time it takes an administrator to leave the
 * screen and try the provider, and at most twelve small reads a minute per
 * process.
 */
const SSO_STAMP_MAX_AGE_MS = 5_000;

/** What a process holds before it has read anything. */
const NO_PROVIDERS: readonly SSOProviderConfig[] = Object.freeze([]);

/**
 * A digest of every enabled connection, which moves when any of them does.
 *
 * **The whole row, not `updated_at`.** Nothing maintains that column, so a
 * change written by anything other than a careful caller would leave it where
 * it was. Hashing the rows themselves catches an added connection, a changed
 * client id, discovery URL or certificate, a disabled one and a removed one,
 * whoever wrote it. A column added later is covered without anybody
 * remembering to add it here.
 *
 * Through `app.sso_lookup` for the reason `loadSSOConnections` is: this runs
 * with no workspace, and the tenant floor answers an unscoped read with
 * nothing. The digest names no secret: the client secret in those rows is
 * sealed, and a digest of the sealed value says nothing about it.
 */
export async function ssoConfigurationStamp(pool: Pool): Promise<string> {
  try {
    const { rows } = await withSSOLookup(drizzle(pool), (tx) =>
      tx.execute<{ stamp: string }>(sql`
        select md5(coalesce(
                 string_agg(to_jsonb(c)::text, ',' order by c.id), ''
               )) as stamp
          from sso_connections c
         where c.enabled = true
           and c.deleted_at is null`),
    );
    return rows[0]?.stamp ?? "";
  } catch (error) {
    // The same degradation `loadSSOConnections` has: a database from before
    // migration 0091 has no providers, and says so the same way every time.
    if (error instanceof Error && error.message.includes("sso_connections")) {
      return "";
    }
    throw error;
  }
}

/** The providers a process is using, and the means to keep them current. */
export interface SSOProviderTracker {
  /** The providers as last read. Never waits and never reads the database. */
  providers(): readonly SSOProviderConfig[];
  /**
   * Reads the stamp now and reloads the providers if it moved.
   *
   * For boot, where a failure should be seen. It throws what it met, and
   * leaves the providers it had.
   */
  refresh(): Promise<readonly SSOProviderConfig[]>;
  /**
   * The providers, reloaded first if the stamp moved since it was last read.
   *
   * Reads the stamp at most once per `maxAgeMs`, and callers arriving while
   * a read is under way share it. **Never throws.** A sign-in should not fail
   * because this check did; the providers already held are what it answers,
   * and the next check is after `maxAgeMs` rather than on the next request,
   * so a database that is down is not asked again by every caller.
   */
  current(): Promise<readonly SSOProviderConfig[]>;
  /**
   * Forgets when the stamp was read, so the next `current()` reads it.
   *
   * What a process calls after it saved a change itself.
   */
  expire(): void;
}

export interface SSOProviderTrackerOptions {
  readonly pool: Pool;
  /**
   * Reads the providers, and does whatever else a fresh reading needs, such
   * as bringing the SAML plugin's derived rows into line. Throws on failure.
   */
  readonly load: () => Promise<readonly SSOProviderConfig[]>;
  /** How long one reading of the stamp is trusted. */
  readonly maxAgeMs?: number;
  /** The clock. Injected by tests. */
  readonly now?: () => number;
  /** Told about a check that failed inside `current()`. */
  readonly onError?: (error: unknown) => void;
}

export function trackSSOProviders(
  options: SSOProviderTrackerOptions,
): SSOProviderTracker {
  const maxAgeMs = options.maxAgeMs ?? SSO_STAMP_MAX_AGE_MS;
  const now = options.now ?? Date.now;

  let providers = NO_PROVIDERS;
  let loadedStamp: string | undefined;
  let checkedAt = Number.NEGATIVE_INFINITY;
  // Moves on `expire()`, so a reading that began before a change was saved
  // cannot mark the providers fresh after it.
  let generation = 0;
  // One reading at a time, so an older reading can never land after a newer
  // one and put back a connection that was just removed.
  let queue: Promise<unknown> = Promise.resolve();
  let shared:
    | {
        readonly generation: number;
        readonly result: Promise<readonly SSOProviderConfig[]>;
      }
    | undefined;

  const readNow = async (): Promise<readonly SSOProviderConfig[]> => {
    const started = generation;
    // The stamp before the rows, never after. A change landing between the
    // two then leaves an older stamp beside newer rows, which the next check
    // reads again; the other order would record a newer stamp beside older
    // rows and never look again.
    const stamp = await ssoConfigurationStamp(options.pool);
    if (stamp !== loadedStamp) {
      providers = await options.load();
      loadedStamp = stamp;
    }
    if (generation === started) {
      checkedAt = now();
    }
    return providers;
  };

  const refresh = (): Promise<readonly SSOProviderConfig[]> => {
    const result = queue.then(readNow);
    queue = result.catch(() => undefined);
    return result;
  };

  const current = (): Promise<readonly SSOProviderConfig[]> => {
    if (now() - checkedAt < maxAgeMs) {
      return Promise.resolve(providers);
    }
    if (shared?.generation === generation) {
      return shared.result;
    }
    const result = refresh().catch((error: unknown) => {
      checkedAt = now();
      options.onError?.(error);
      return providers;
    });
    const entry = { generation, result };
    shared = entry;
    void result.then(() => {
      if (shared === entry) {
        shared = undefined;
      }
    });
    return result;
  };

  return {
    providers: () => providers,
    refresh,
    current,
    expire: () => {
      generation += 1;
      checkedAt = Number.NEGATIVE_INFINITY;
    },
  };
}

/** An auth instance that is rebuilt when the providers it was built on change. */
export interface SSOFollowingAuth<A> {
  /**
   * The instance for the providers as last read. Never reads the database.
   *
   * For a caller that signs nobody in, such as reading a session or signing
   * out: those depend on nothing a provider changes.
   */
  latest(): A;
  /** The instance, rebuilt first if single sign-on changed. For sign-in. */
  current(): Promise<A>;
}

/**
 * Builds an instance around the tracker's providers, and again whenever they
 * are replaced.
 *
 * **Lazily, on first use.** The web process resolves the email-verification
 * policy and the instance's name at boot after the providers, and an instance
 * built before those arrived would carry the defaults for its whole life.
 *
 * A reading that finds the stamp unchanged keeps the same array, so the
 * comparison here is by identity and a rebuild happens exactly when a reload
 * did.
 */
export function followSSOProviders<A>(
  tracker: SSOProviderTracker,
  build: (providers: readonly SSOProviderConfig[]) => A,
): SSOFollowingAuth<A> {
  let built:
    | { readonly from: readonly SSOProviderConfig[]; readonly instance: A }
    | undefined;

  const latest = (): A => {
    const from = tracker.providers();
    if (built === undefined || built.from !== from) {
      built = { from, instance: build(from) };
    }
    return built.instance;
  };

  return {
    latest,
    current: async () => {
      await tracker.current();
      return latest();
    },
  };
}
