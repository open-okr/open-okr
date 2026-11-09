/**
 * The catalogue keys Admin, Webhooks reads by a value from the data (plan
 * 0.7.0 D5).
 *
 * Written out rather than built from the value, so every key is a string the
 * catalogue coverage test can find and a translator can trace to its screen.
 * A value with no key here falls back to the value itself, never to a key
 * nobody wrote.
 */
const EVENT_LABELS: Readonly<Record<string, string>> = {
  "objective.created": "admin.webhooks.event.objective.created",
  "objective.updated": "admin.webhooks.event.objective.updated",
  "objective.published": "admin.webhooks.event.objective.published",
  "objective.closed": "admin.webhooks.event.objective.closed",
  "objective.deleted": "admin.webhooks.event.objective.deleted",
  "key_result.checked_in": "admin.webhooks.event.key_result.checked_in",
  "kpi.recorded": "admin.webhooks.event.kpi.recorded",
  "initiative.created": "admin.webhooks.event.initiative.created",
  "initiative.updated": "admin.webhooks.event.initiative.updated",
  "initiative.completed": "admin.webhooks.event.initiative.completed",
  "task.created": "admin.webhooks.event.task.created",
  "task.completed": "admin.webhooks.event.task.completed",
  "cycle.phase_changed": "admin.webhooks.event.cycle.phase_changed",
  ping: "admin.webhooks.event.ping",
};

const GROUP_LABELS: Readonly<Record<string, string>> = {
  objectives: "admin.webhooks.group.objectives",
  keyResults: "admin.webhooks.group.keyResults",
  kpis: "admin.webhooks.group.kpis",
  work: "admin.webhooks.group.work",
  cycles: "admin.webhooks.group.cycles",
};

const STATE_LABELS: Readonly<Record<string, string>> = {
  on: "admin.webhooks.state.on",
  paused: "admin.webhooks.state.paused",
  off: "admin.webhooks.state.off",
};

const OFF_REASON_LABELS: Readonly<Record<string, string>> = {
  manual: "admin.webhooks.offReason.manual",
  imported: "admin.webhooks.offReason.imported",
};

const OUTCOME_LABELS: Readonly<Record<string, string>> = {
  delivered: "admin.webhooks.outcome.delivered",
  failed: "admin.webhooks.outcome.failed",
  refused: "admin.webhooks.outcome.refused",
  withheld: "admin.webhooks.outcome.withheld",
};

type Translate = (key: string) => string;

const label =
  (labels: Readonly<Record<string, string>>) =>
  (t: Translate, value: string): string => {
    const key = labels[value];
    return key ? t(key) : value;
  };

export const eventLabel = label(EVENT_LABELS);
export const groupLabel = label(GROUP_LABELS);
export const stateLabel = label(STATE_LABELS);
export const offReasonLabel = label(OFF_REASON_LABELS);
export const outcomeLabel = label(OUTCOME_LABELS);
