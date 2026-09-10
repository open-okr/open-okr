/**
 * The query-count budget on list endpoints (P7-T01a, TECHNICAL-PLAN §13.2).
 *
 * §13.2 asks for "a query-count budget enforced in CI on list endpoints, with
 * a development-mode counter failing tests over budget". This is the counter
 * and the budget; `test/perf-query-budget.test.ts` is the enforcement.
 *
 * **The number is the weaker half of this.** A ceiling of six queries catches
 * a list that suddenly issues sixty. It does not catch the failure that
 * actually happens, which is a list issuing one query per row: at the handful
 * of rows a test fixture holds, an N+1 costs five queries and passes a
 * generous ceiling, and the same code at a thousand rows costs a thousand. So
 * the budget has two halves, and the second matters more: the count must not
 * grow with the row count. An action that costs the same at five rows and at
 * fifty is not walking its own results, whatever its absolute number is.
 *
 * **Counted at the pool, not in the actions.** Nothing in a service knows this
 * exists. The counter is a proxy around `pg.Pool` that the test hands to
 * `callAction` in place of the real one, so what it counts is every statement
 * the action actually caused, including the ones a helper issued three layers
 * down and the ones Drizzle added for a transaction.
 */
import type pg from "pg";

/** A pool that counts, and the count. */
export interface CountingPool {
  /** Hand this to `callAction` in place of the real pool. */
  readonly pool: pg.Pool;
  /** Statements issued since the last `reset`. */
  count(): number;
  reset(): void;
  /** Every statement issued since the last `reset`, for a failure message. */
  statements(): readonly string[];
}

/** `begin`, `commit` and the tenant setting are transaction overhead, not work. */
const OVERHEAD = /^\s*(begin|commit|rollback|select set_config)/i;

function textOf(config: unknown): string {
  if (typeof config === "string") {
    return config;
  }
  if (config && typeof config === "object" && "text" in config) {
    return String((config as { text: unknown }).text ?? "");
  }
  return "";
}

/**
 * Wraps a pool so every statement through it is counted.
 *
 * Transaction bookkeeping is excluded: `begin`, `commit`, `rollback` and the
 * `set_config` that applies the tenant floor are a fixed cost of running
 * anything at all, and counting them would make a budget about how many
 * transactions an action opens rather than how much work it does.
 */
export function countingPool(pool: pg.Pool): CountingPool {
  const seen: string[] = [];

  const record = (config: unknown): void => {
    const text = textOf(config);
    if (text !== "" && !OVERHEAD.test(text)) {
      seen.push(text.replace(/\s+/g, " ").trim().slice(0, 200));
    }
  };

  const wrapClient = (client: pg.PoolClient): pg.PoolClient =>
    new Proxy(client, {
      get(target, property, receiver) {
        if (property === "query") {
          return (...args: unknown[]) => {
            record(args[0]);
            return (target.query as (...a: unknown[]) => unknown)(...args);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as pg.PoolClient;

  const proxy = new Proxy(pool, {
    get(target, property, receiver) {
      if (property === "query") {
        return (...args: unknown[]) => {
          record(args[0]);
          return (target.query as (...a: unknown[]) => unknown)(...args);
        };
      }
      if (property === "connect") {
        return async (...args: unknown[]) => {
          const client = await (
            target.connect as (...a: unknown[]) => Promise<pg.PoolClient>
          )(...args);
          return wrapClient(client);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as pg.Pool;

  return {
    pool: proxy,
    count: () => seen.length,
    reset: () => {
      seen.length = 0;
    },
    statements: () => [...seen],
  };
}

/**
 * The ceiling for each list action, and the input it is called with.
 *
 * The numbers are what each action costs today plus a little headroom, taken
 * by measuring rather than by guessing, and they are deliberately not round:
 * a budget of "10" for something that costs three is not a budget. Raising one
 * is a normal thing to do when a screen legitimately needs another read, and
 * the diff makes it a decision somebody took rather than a drift nobody saw.
 */
export interface ListBudget {
  readonly action: string;
  readonly input: Record<string, unknown>;
  readonly queries: number;
}

/**
 * The lists a person actually opens, and what each may cost.
 *
 * Not every list in the registry. These are the ones behind a screen somebody
 * loads, which is where a regression is felt. Adding a row here is how a new
 * list joins the gate.
 */
export const LIST_BUDGETS: readonly ListBudget[] = [
  // `sessions.list` is deliberately absent: it takes a `spaceId` and is a
  // list within one space rather than across the workspace, so it belongs to
  // a space-scoped budget rather than this one.
  { action: "goals.list", input: {}, queries: 16 },
  { action: "tasks.list", input: {}, queries: 13 },
  { action: "initiatives.list", input: {}, queries: 6 },
  { action: "spaces.list", input: {}, queries: 3 },
  { action: "people.directory", input: {}, queries: 2 },
  { action: "review.inbox", input: {}, queries: 12 },
  { action: "cycles.list", input: {}, queries: 5 },
  { action: "notifications.list", input: {}, queries: 3 },
  { action: "kpis.grid", input: {}, queries: 3 },
];

/**
 * Lists whose cost grows with their row count, found the day this gate was
 * built (P7-T01a) and not yet fixed.
 *
 * Measured at five rows against fifty:
 *
 * | Action | 5 rows | 50 rows |
 * |---|---|---|
 * | `goals.list` | 15 | 105 |
 * | `tasks.list` | 12 | 102 |
 * | `initiatives.list` | 5 | 32 |
 *
 * Two queries per goal and one per task and per initiative. At §13.1's
 * hundred thousand goals that is two hundred thousand round trips for one
 * page, which is why the budget's growth half exists and why its first run
 * found three.
 *
 * **They are listed rather than silently excluded**, the same way the string
 * catalogue carried its debt while P6-G22c worked through it. The growth
 * assertion skips them and a second assertion requires each one to still be
 * growing, so fixing one fails the build until its entry is removed. The list
 * is emptied by P7-T01b, which owns the fixes.
 */
export const KNOWN_QUERY_PER_ROW: readonly string[] = [
  "goals.list",
  "tasks.list",
  "initiatives.list",
];
