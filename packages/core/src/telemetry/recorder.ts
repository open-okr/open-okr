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
  /**
   * Registers a value read at scrape time rather than written at event time.
   *
   * The only shape that can answer a question about the world right now,
   * such as how far behind the outbox is: a counter written during a drain
   * says nothing at all once the relay stops, and the series goes flat
   * instead of showing the lag growing. `read` runs on every scrape, so keep
   * it to one cheap query. Registering the same name twice replaces the
   * reader.
   */
  gauge(
    name: string,
    read: () => number | Promise<number>,
    labels?: MetricLabels,
  ): void;
  /**
   * Runs `fn` inside a span, and returns whatever `fn` returns.
   *
   * A wrapper rather than a start/end pair, because a span ended by hand is
   * a span somebody forgets to end on the error path, and the error path is
   * the one worth tracing.
   *
   * Off unless an export address is configured, and off means this calls
   * `fn` and nothing else. Treat a span as decoration over work that happens
   * regardless: nothing may depend on one existing.
   *
   * `attributes` is bounded the way labels are, and for a sharper reason: a
   * span leaves the host. Never a title, a body, an address, or anything a
   * person typed.
   */
  span<T>(
    name: string,
    attributes: MetricLabels,
    fn: () => Promise<T>,
  ): Promise<T>;
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
  gauge(): void {
    // Deliberately empty, and the reader is never called: a gauge's reader
    // is a query, and an instance that is not measuring itself must not run
    // one on every scrape it does not serve.
  },
  span<T>(
    _name: string,
    _attributes: MetricLabels,
    fn: () => Promise<T>,
  ): Promise<T> {
    // Not even a wrapper. The function is returned as it is, so an
    // untraced instance runs exactly the code it ran before spans existed.
    return fn();
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

  // The asynchronous surfaces (P7-T06b). Everything below happens after a
  // request has returned, or because a clock said so, which is exactly why
  // it needs measuring: nobody is watching a screen when it goes wrong.

  /** Outbox rows dispatched, by topic and outcome. */
  outboxDispatchedTotal: "openokr_outbox_dispatched_total",
  /** Rows waiting to be delivered. Read at scrape time. */
  outboxPending: "openokr_outbox_pending",
  /**
   * Age of the oldest row still waiting, in seconds. Read at scrape time,
   * which is the whole point: a relay that has stopped must report a lag
   * that grows rather than a counter that went quiet.
   */
  outboxOldestPendingSeconds: "openokr_outbox_oldest_pending_seconds",
  /** Rows given up on, by topic. */
  outboxDeadLetteredTotal: "openokr_outbox_dead_lettered_total",

  /** Scheduled runs, by job name and outcome. */
  jobRunsTotal: "openokr_job_runs_total",
  /** Wall time of one scheduled run. */
  jobDuration: "openokr_job_duration_seconds",

  /** Nudges resolved, by rule and what happened: sent, or why suppressed. */
  nudgesTotal: "openokr_nudges_total",

  /** Channel messages attempted, by provider and outcome. */
  channelDeliveriesTotal: "openokr_channel_deliveries_total",

  /** Realtime events published, by topic. */
  realtimeEventsTotal: "openokr_realtime_events_total",

  /** Agent runs finished, by agent and outcome. */
  agentRunsTotal: "openokr_agent_runs_total",
  /** Wall time of one agent run. */
  agentRunDuration: "openokr_agent_run_duration_seconds",

  /** Tokens spent, by provider, model and whether they were in or out. */
  aiTokensTotal: "openokr_ai_tokens_total",
  /**
   * Money spent, by provider and model, in the smallest currency unit the
   * usage row records. A float here would drift; the usage table already
   * stores an integer and this passes it through unchanged.
   */
  aiCostTotal: "openokr_ai_cost_total",
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
