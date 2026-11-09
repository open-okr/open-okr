/**
 * The public webhook event catalogue (docs/design/outbound-webhooks.md §2, W3).
 *
 * **A receiver never sees an activity kind.** Internal kinds are renamed and
 * split as the product changes, and an integration built on them would break
 * every time one did. These names are the contract instead: adding one is
 * additive, and renaming or removing one takes PLAN §5.1's two releases.
 *
 * The mapping from activity kinds is one table, here, so the question "what
 * makes this event fire" has one answer. `webhook-events.test.ts` holds both
 * directions: every event maps from a kind the activity catalogue registers,
 * and every kind mapped here names an event.
 */

/** The events a hook may subscribe to, in the order the screen lists them. */
export const WEBHOOK_EVENTS = [
  "objective.created",
  "objective.updated",
  "objective.published",
  "objective.closed",
  "objective.deleted",
  "key_result.checked_in",
  "kpi.recorded",
  "initiative.created",
  "initiative.updated",
  "initiative.completed",
  "task.created",
  "task.completed",
  "cycle.phase_changed",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/**
 * What `webhooks.test` sends, and nothing else does. Not subscribable: every
 * hook receives a test when an administrator asks for one.
 */
export const PING_EVENT = "ping";

/** Every event a delivery row or an outbox row may name. */
export type DeliveredEvent = WebhookEvent | typeof PING_EVENT;

/** The subject type each event's `data` describes, for the summary read. */
export type WebhookSubjectType =
  | "goal"
  | "key_result"
  | "kpi"
  | "initiative"
  | "task"
  | "cycle";

/** What one event is about, by the event's family. */
export function subjectTypeOf(event: WebhookEvent): WebhookSubjectType {
  if (event.startsWith("objective.")) {
    return "goal";
  }
  if (event === "key_result.checked_in") {
    return "key_result";
  }
  if (event === "kpi.recorded") {
    return "kpi";
  }
  if (event.startsWith("initiative.")) {
    return "initiative";
  }
  if (event.startsWith("task.")) {
    return "task";
  }
  return "cycle";
}

/**
 * One activity kind's route to an event.
 *
 * `events` is every event the kind can become, which is what the pipeline
 * asks the database about before it reads anything else. `decide` picks the
 * one this activity became from its payload, or none: a task moved to
 * "in progress" is not `task.completed`. Without `decide` the kind is always
 * its one event.
 */
interface EventRoute {
  readonly events: readonly WebhookEvent[];
  readonly decide?: (
    payload: Readonly<Record<string, unknown>>,
  ) => WebhookEvent | null;
}

const always = (event: WebhookEvent): EventRoute => ({ events: [event] });

/** A status change, read from the payload the write already records. */
const statusIs = (payload: Readonly<Record<string, unknown>>, status: string) =>
  payload.status === status;

/**
 * Activity kind to event. A kind absent here sends nothing, and costs the
 * write nothing: the pipeline returns before its one lookup.
 *
 * Objectives are the `goal.*` kinds, because a goal in this product is an
 * objective and its key results are rows of their own. A draft published to
 * its reviewer is not published yet; the approval that follows is.
 */
export const ACTIVITY_EVENT_ROUTES: Readonly<Record<string, EventRoute>> = {
  "goal.created": always("objective.created"),
  "goal.updated": always("objective.updated"),
  "goal.moved_space": always("objective.updated"),
  "goal.moved_to_cycle": always("objective.updated"),
  "goal.kind_changed": always("objective.updated"),
  "goal.role_reassigned": always("objective.updated"),
  "goal.reopened": always("objective.updated"),
  "goal.restored": always("objective.updated"),
  "goal.draft_published": {
    events: ["objective.published"],
    decide: (payload) =>
      payload.awaitingApproval === true ? null : "objective.published",
  },
  "goal.draft_approved": always("objective.published"),
  "goal.closed": always("objective.closed"),
  "goal.stopped": always("objective.closed"),
  "goal.deleted": always("objective.deleted"),
  // One event per key result the check-in reported on, read from its
  // snapshot when the hooks are known (`enqueue.ts`).
  "check_in.published": always("key_result.checked_in"),
  "kpi.value_recorded": always("kpi.recorded"),
  "initiative.created": always("initiative.created"),
  "initiative.updated": {
    events: ["initiative.updated", "initiative.completed"],
    decide: (payload) =>
      statusIs(payload, "done") ? "initiative.completed" : "initiative.updated",
  },
  "task.created": always("task.created"),
  "task.moved": {
    events: ["task.completed"],
    decide: (payload) => (statusIs(payload, "done") ? "task.completed" : null),
  },
  "task.updated": {
    events: ["task.completed"],
    decide: (payload) => (statusIs(payload, "done") ? "task.completed" : null),
  },
  // Every status change and every move of the phase pointer, including the
  // cycle moving to closing by its date or its facilitator (plan 0.7.0 O2).
  "cycle.published": always("cycle.phase_changed"),
  "cycle.closing_started": always("cycle.phase_changed"),
  "cycle.closing_undone": always("cycle.phase_changed"),
  "cycle.closed": always("cycle.phase_changed"),
  "cycle.updated": {
    events: ["cycle.phase_changed"],
    decide: (payload) =>
      Array.isArray(payload.fields) && payload.fields.includes("phase")
        ? "cycle.phase_changed"
        : null,
  },
};

/** Every event this kind could become, or none. No database, no payload. */
export function possibleEvents(kind: string): readonly WebhookEvent[] {
  return ACTIVITY_EVENT_ROUTES[kind]?.events ?? [];
}

/** The event this activity became, or null when it became none. */
export function eventFor(
  kind: string,
  payload: Readonly<Record<string, unknown>>,
): WebhookEvent | null {
  const route = ACTIVITY_EVENT_ROUTES[kind];
  if (!route) {
    return null;
  }
  if (route.decide) {
    return route.decide(payload);
  }
  return route.events[0] ?? null;
}

/** The screen's groups, by what each event is about. */
export const WEBHOOK_EVENT_GROUPS: readonly {
  readonly key: "objectives" | "keyResults" | "kpis" | "work" | "cycles";
  readonly events: readonly WebhookEvent[];
}[] = [
  {
    key: "objectives",
    events: [
      "objective.created",
      "objective.updated",
      "objective.published",
      "objective.closed",
      "objective.deleted",
    ],
  },
  { key: "keyResults", events: ["key_result.checked_in"] },
  { key: "kpis", events: ["kpi.recorded"] },
  {
    key: "work",
    events: [
      "initiative.created",
      "initiative.updated",
      "initiative.completed",
      "task.created",
      "task.completed",
    ],
  },
  { key: "cycles", events: ["cycle.phase_changed"] },
];
