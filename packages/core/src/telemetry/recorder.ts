/**
 * What `packages/core` needs in order to be measured, and nothing more
 * (P7-T06a).
 *
 * Core may not depend on `packages/adapters`, so this declares the shape a
 * recorder has to satisfy and the host passes one that does. The same trick
 * `ActionCallContext.storage` already uses: a structural interface here, the
 * real driver over there, no import between them.
 *
 * The absent case is the normal one. Every counter below is a side effect of
 * work that has already happened, so a recorder that does nothing changes no
 * behaviour and no test needs one.
 */

/**
 * Labels are strings and only strings, deliberately.
 *
 * Two reasons, and the second is the one that matters. Prometheus labels are
 * strings anyway, so a number would be stringified somewhere regardless. And a
 * narrow type is the cheapest place to make the privacy rule visible: a label
 * set that cannot hold an object is a label set nobody accidentally fills with
 * a row.
 *
 * **Every label must be bounded-cardinality.** An action name, an outcome, an
 * access level, a provider name: all fine, because the set of possible values
 * is fixed by the code. A workspace id, a member id, a goal title, an email:
 * never. Each distinct label combination is a separate time series held in
 * memory for the life of the process, so an unbounded label is a memory leak
 * that also happens to be a privacy breach.
 */
export type MetricLabels = Readonly<Record<string, string>>;

export interface MetricRecorder {
  /** Adds to a monotonic counter. `by` defaults to 1. */
  count(name: string, labels?: MetricLabels, by?: number): void;
  /** Records one observation into a histogram, in seconds. */
  observe(name: string, seconds: number, labels?: MetricLabels): void;
}

/**
 * The recorder for an instance that is not measuring itself.
 *
 * Shared and frozen rather than constructed per call: this is on the path of
 * every action, and a fresh object per call would be the one allocation the
 * off switch was supposed to avoid.
 */
export const NO_METRICS: MetricRecorder = Object.freeze({
  count(): void {
    // Deliberately empty. See the note above.
  },
  observe(): void {
    // Deliberately empty.
  },
});

/**
 * Held on `globalThis`, not in a module variable, and this is not caution.
 *
 * It was a module variable first and the feature silently did nothing.
 * Next.js bundles `instrumentation.ts` separately from the route and page
 * code, so `setDefaultMetrics` wrote to one instance of this module and
 * every action read another, which still held `NO_METRICS`. Every static
 * check passed, the endpoint served, and the body said `# no registered
 * metrics` after a full restart.
 *
 * `apps/web/lib/pool.ts` reaches for `globalThis` for the neighbouring
 * reason and says so. Found 11 September 2026 by opening the endpoint in a
 * browser, which is the only thing that could have found it.
 */
const globals = globalThis as typeof globalThis & {
  openokrMetrics?: MetricRecorder;
};

/**
 * Installs the recorder every call uses when its context does not name one.
 *
 * **Module state, deliberately, and it is the only piece in this package.**
 * The alternative was threading a recorder through `ActionCallContext` at all
 * four hundred and seven call sites in `apps/web`, most of which are a server
 * component reading one number for a badge. That is a change with four
 * hundred chances to be forgotten and no way to tell, and a call site that
 * forgot would go silently unmeasured, which is the failure mode
 * observability exists to remove.
 *
 * It is set once, at boot, by the host, the way a logger is. Nothing reads it
 * before then and `NO_METRICS` is a working value, so a process that never
 * calls this behaves exactly as it did before the meter existed. Tests that
 * want a recorder pass one on the context instead, which still wins.
 */
export function setDefaultMetrics(recorder: MetricRecorder): void {
  globals.openokrMetrics = recorder;
}

/** The host's recorder, or the one that does nothing. Never null. */
export function defaultMetrics(): MetricRecorder {
  return globals.openokrMetrics ?? NO_METRICS;
}

/**
 * Every series this package records, in one place.
 *
 * A literal at the call site would be a name nobody can grep for and a typo
 * nothing catches, which is how two series that meant the same thing end up
 * on a dashboard under different names.
 *
 * Naming follows Prometheus convention rather than ours: `_total` for a
 * counter, `_seconds` for a duration, singular unit suffix last.
 */
export const METRIC = {
  /** Actions called, by name and outcome. */
  actionsTotal: "openokr_actions_total",
  /** Wall time of one action, from call to return or throw. */
  actionDuration: "openokr_action_duration_seconds",
  /** Operations committed or rolled back, by action and outcome. */
  operationsTotal: "openokr_operations_total",
  /** Wall time of one Operation's transaction. */
  operationDuration: "openokr_operation_duration_seconds",
  /** Authorisation decisions, by action, required level and outcome. */
  authorisationTotal: "openokr_authorisation_total",
} as const;

/**
 * The four access levels by name, for the authorisation label.
 *
 * A label reading `70` would need a lookup table on the dashboard and in the
 * head of whoever reads it. Built here rather than exported from
 * `../access/levels.ts` because it exists for the exposition and nothing
 * else, and a name map next to the numbers invites somebody to key
 * behaviour off it.
 */
export const ACCESS_LEVEL_NAMES: Readonly<Record<number, string>> =
  Object.freeze({
    10: "view",
    40: "comment",
    70: "edit",
    100: "full",
  });

/** The outcome labels, so a counter and its dashboard cannot disagree. */
export const OUTCOME = {
  ok: "ok",
  refused: "refused",
  notFound: "not_found",
  error: "error",
} as const;

export type Outcome = (typeof OUTCOME)[keyof typeof OUTCOME];
