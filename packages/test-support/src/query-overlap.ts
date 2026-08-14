import pg from "pg";

/**
 * A probe that counts how many queries are in flight on one connection at the
 * same moment.
 *
 * A transaction is a single connection, so two queries started on the same
 * transaction handle overlap on the same `pg` client. `pg` 8 hides that behind
 * an internal queue and warns once per process ("Calling client.query() when
 * the client is already executing a query is deprecated"); `pg` 9 removes the
 * queue, and the second query throws. Anything reading through a transaction
 * has to await one query before starting the next.
 *
 * The probe patches the client prototype for the length of one call, so it sees
 * every connection the code under test touches, including ones checked out of a
 * pool it does not hold. It counts per connection, so ordinary pool
 * concurrency (several clients, one query each) never registers as an overlap.
 *
 * Do not run it inside a concurrent test: it would also count the queries a
 * neighbouring test happened to have in flight.
 */
export interface QueryOverlapReport {
  /**
   * Every query the probe saw. Zero means it hooked nothing at all, which is a
   * broken probe rather than a clean run, so assert on this too.
   */
  readonly queries: number;
  /** The most queries in flight on one connection at once. 1 is the goal. */
  readonly peak: number;
}

type QueryFunction = (this: unknown, ...args: unknown[]) => unknown;

export async function measureQueryOverlap<T>(
  run: () => Promise<T>,
): Promise<{ result: T; overlap: QueryOverlapReport }> {
  const original = pg.Client.prototype.query as unknown as QueryFunction;
  const inFlight = new WeakMap<object, number>();
  let queries = 0;
  let peak = 0;

  function patched(this: object, ...args: unknown[]): unknown {
    const depth = (inFlight.get(this) ?? 0) + 1;
    inFlight.set(this, depth);
    queries += 1;
    if (depth > peak) {
      peak = depth;
    }
    let released = false;
    const release = () => {
      if (released) {
        return;
      }
      released = true;
      inFlight.set(this, (inFlight.get(this) ?? 1) - 1);
    };

    // The callback form finishes when the callback runs, not when `query`
    // returns, so the count has to be released from inside it.
    const last = args.at(-1);
    if (typeof last === "function") {
      const callback = last as (...callbackArgs: unknown[]) => unknown;
      const wrapped = [...args];
      wrapped[wrapped.length - 1] = (...callbackArgs: unknown[]) => {
        release();
        return callback(...callbackArgs);
      };
      try {
        return original.apply(this, wrapped);
      } catch (error) {
        release();
        throw error;
      }
    }

    let outcome: unknown;
    try {
      outcome = original.apply(this, args);
    } catch (error) {
      release();
      throw error;
    }
    if (outcome instanceof Promise) {
      return outcome.then(
        (value) => {
          release();
          return value;
        },
        (error: unknown) => {
          release();
          throw error;
        },
      );
    }
    release();
    return outcome;
  }

  pg.Client.prototype.query =
    patched as unknown as typeof pg.Client.prototype.query;
  try {
    const result = await run();
    return { result, overlap: { queries, peak } };
  } finally {
    pg.Client.prototype.query =
      original as unknown as typeof pg.Client.prototype.query;
  }
}
