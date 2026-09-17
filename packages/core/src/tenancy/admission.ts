/**
 * Per-tenant admission, at the one door every surface comes through
 * (P8-T06a).
 *
 * Design: `docs/design/p8-t01a-tenant-limits.md` §3, §4, §6 and §7.
 *
 * **The subject of this file is the other tenants.** P8-T06's acceptance
 * criterion says "when limits engage, then *other* tenants stay inside their
 * performance budgets". The tenant being slowed is the cost of that, not the
 * goal, which is why nothing here refuses a write that has already been
 * authorised and nothing here drops a queued job.
 *
 * **It sits before the metrics span in `callAction`.** The existing edge
 * limiters live in HTTP route handlers, so an agent calling a tool over the
 * agent protocol, a member typing a slash command in Slack and a scheduled
 * job are all unlimited today. A limit at the edge protects the edge; a limit
 * here protects the database.
 *
 * **What the design claimed and what is true.** §3 says a refused call
 * "costs one cache round trip and no database connection at all". That holds
 * for the in-process cache driver and not for the Postgres one, which
 * `apps/web/lib/cache.ts` builds on the application's own pool, so a refusal
 * there costs one short indexed upsert. That is still the point of the
 * ordering: what a refusal avoids is the action's own work, which is the list
 * query holding a connection for its whole duration. Recorded here rather
 * than left as a sentence in a design document that the code does not keep.
 *
 * **Structural, like `storage` and `metrics` before it.** `packages/core` may
 * not import `packages/adapters`, so the two cache methods this needs are
 * declared here and the host passes the driver it already has. The shape is
 * a subset of the `Cache` port on purpose: widening it later is a decision,
 * and depending on the whole port would be an accident.
 */

/** The reset time a refusal carries, so nothing retries in a loop. */
export class AdmissionError extends Error {
  readonly code = "rate_limited" as const;
  /** Seconds until the window resets. Zero when the limit is a concurrency one. */
  readonly resetSeconds: number;

  constructor(message: string, resetSeconds: number) {
    super(message);
    this.name = "AdmissionError";
    this.resetSeconds = resetSeconds;
  }
}

/**
 * The two counters admission needs, as a subset of the `Cache` port.
 *
 * `incr` takes a negative `by` to release a concurrency slot. Both shipped
 * drivers handle that: the in-process one adds, and the Postgres one adds
 * inside its single upsert statement.
 */
export interface AdmissionCounters {
  rateLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ readonly allowed: boolean; readonly resetSeconds: number }>;
  incr(key: string, by?: number, ttlSeconds?: number): Promise<number>;
}

/** Zero means unlimited, on both, and that is the default everywhere. */
export interface AdmissionLimits {
  readonly actionsPerMinute: number;
  readonly concurrentActions: number;
}

export interface Admission extends AdmissionLimits {
  readonly counters: AdmissionCounters;
}

/**
 * The floors, which exist so a number nobody thought about cannot stop the
 * product.
 *
 * §4: "The floor validation refuses a value between 1 and some small minimum,
 * so an operator cannot set 1 and wonder why the product stopped." One action
 * a minute is not a limit, it is an outage with a configuration file. Opening
 * the work map is already several actions, so a per-minute figure below sixty
 * cannot serve a single member, and a concurrency of one serialises a tenant
 * to one member at a time.
 */
export const MIN_ACTIONS_PER_MINUTE = 60;
export const MIN_CONCURRENT_ACTIONS = 2;

/**
 * How long a concurrency counter lives without being touched.
 *
 * A slot is taken on entry and released in a `finally`, so the only way one
 * leaks is a process that dies between the two. The time to live is what
 * collects those: a tenant whose counter drifts upward recovers on its own
 * rather than needing an operator. It also means the counter resets while
 * calls are in flight, which under-counts for a moment and is the right
 * trade: over-counting forever would refuse a tenant that is doing nothing.
 */
const CONCURRENCY_TTL_SECONDS = 60;

const RATE_WINDOW_SECONDS = 60;

/** Raised at resolve time, so a bad number fails the read rather than a call. */
export class AdmissionSettingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdmissionSettingError";
  }
}

export function validateAdmissionLimits(limits: AdmissionLimits): void {
  const check = (value: number, floor: number, key: string): void => {
    if (!Number.isInteger(value) || value < 0) {
      throw new AdmissionSettingError(
        `${key} must be a whole number, zero or more. Zero means unlimited.`,
      );
    }
    if (value > 0 && value < floor) {
      throw new AdmissionSettingError(
        `${key} is ${value}, which is below the floor of ${floor}. ` +
          `A number that small is an outage rather than a limit. ` +
          `Use 0 for unlimited.`,
      );
    }
  };
  check(
    limits.actionsPerMinute,
    MIN_ACTIONS_PER_MINUTE,
    "cloud.limits.actionsPerMinute",
  );
  check(
    limits.concurrentActions,
    MIN_CONCURRENT_ACTIONS,
    "cloud.limits.concurrentActions",
  );
}

/** Released in a `finally`, whatever the action did. */
export type AdmissionRelease = () => Promise<void>;

/**
 * Process-local concurrent-actions counter (P8-T06c).
 *
 * Separate from the per-workspace counters in the cache. Those enforce the
 * per-tenant concurrency cap keyed by workspace id. This one tracks how many
 * actions the whole process is running, across every workspace, for the
 * `openokr_concurrent_actions` gauge on the capacity dashboard.
 *
 * The per-workspace counter is the enforcement point and cannot be replaced
 * by this: it lives in the cache so two web processes agree on one number,
 * and it is keyed per workspace. This is an observation for a gauge, not an
 * enforcement mechanism, and it is cheaper (one integer, no round trip).
 *
 * On `globalThis` for the same reason the metrics recorder and the admission
 * singleton are: Next bundles `instrumentation.ts` separately from route code.
 */
const concurrencyGlobals = globalThis as typeof globalThis & {
  openokrConcurrentActions?: number;
};

export function bumpConcurrentActions(delta: number): void {
  concurrencyGlobals.openokrConcurrentActions =
    (concurrencyGlobals.openokrConcurrentActions ?? 0) + delta;
}

/** How many actions are in flight right now, across every workspace. */
export function currentConcurrentActions(): number {
  return concurrencyGlobals.openokrConcurrentActions ?? 0;
}

/**
 * Takes a tenant's place in the queue, or refuses.
 *
 * Returns what to call when the action is finished, whether it threw or not.
 * The caller is `callAction` and nothing else: an action that admitted itself
 * would be admitted twice when another action called it.
 *
 * `onRefusal` is called on every refusal with the reason label, so the
 * capacity dashboard can chart admission refusals without coupling the
 * admission module to the metrics recorder. The host wires it at boot.
 */
export async function admit(
  admission: Admission,
  workspaceId: string,
  onRefusal?: (reason: string) => void,
): Promise<AdmissionRelease> {
  const { actionsPerMinute, concurrentActions, counters } = admission;

  // **The self-hosted path, and the common one.** Two comparisons against
  // zero and no round trip at all. §7: there is no second code path, and a
  // branch that is present and cheap is safer than one that is absent,
  // because the absent one is the one nobody tests.
  if (actionsPerMinute === 0 && concurrentActions === 0) {
    bumpConcurrentActions(1);
    return async () => {
      bumpConcurrentActions(-1);
    };
  }

  if (actionsPerMinute > 0) {
    const window = await counters.rateLimit(
      `admission:rate:${workspaceId}`,
      actionsPerMinute,
      RATE_WINDOW_SECONDS,
    );
    if (!window.allowed) {
      onRefusal?.("rate");
      throw new AdmissionError(
        `This workspace is over ${actionsPerMinute} actions a minute. ` +
          `Try again in ${window.resetSeconds} second(s).`,
        window.resetSeconds,
      );
    }
  }

  if (concurrentActions === 0) {
    bumpConcurrentActions(1);
    return async () => {
      bumpConcurrentActions(-1);
    };
  }

  // **A burst is what the per-minute window cannot see.** Sixty calls spread
  // over sixty seconds and sixty calls in one second both pass a per-minute
  // limit, and only the second one empties the pool.
  const key = `admission:concurrent:${workspaceId}`;
  const taken = await counters.incr(key, 1, CONCURRENCY_TTL_SECONDS);
  if (taken > concurrentActions) {
    // Given back straight away. Holding it would mean one refusal made the
    // next one more likely, which is how a limiter turns a burst into a
    // wedged tenant.
    await counters.incr(key, -1);
    onRefusal?.("concurrency");
    throw new AdmissionError(
      `This workspace already has ${concurrentActions} action(s) running. ` +
        `Try again shortly.`,
      0,
    );
  }

  bumpConcurrentActions(1);
  let released = false;
  return async () => {
    // Guarded because `callAction` releases in a `finally` and a caller that
    // released by hand would otherwise take the count negative, which reads
    // as free capacity that does not exist.
    if (released) {
      return;
    }
    released = true;
    bumpConcurrentActions(-1);
    await counters.incr(key, -1);
  };
}

/**
 * The instance's own admission, for the four hundred call sites that pass no
 * context member of their own.
 *
 * **The same arrangement `defaultMetrics` uses, for the same reason.** Every
 * surface calls `callAction` and none of them should have to know that a
 * limiter exists. The host installs one at boot; a caller that names its own
 * still wins, which is how a test limits a single call without touching the
 * process.
 *
 * On `globalThis` rather than in a module variable because Next bundles
 * `instrumentation.ts` separately from the application, so a module-level
 * binding would give the boot module and the request path two different
 * copies. That is not a guess: it is what happened to the metrics recorder at
 * P7-T06a, and it was found by opening a page rather than by a test.
 */
const globals = globalThis as typeof globalThis & {
  openokrAdmission?: Admission;
};

export function setDefaultAdmission(admission: Admission): void {
  globals.openokrAdmission = admission;
}

/** Undefined means unlimited, which is every self-hosted instance. */
export function defaultAdmission(): Admission | undefined {
  return globals.openokrAdmission;
}
