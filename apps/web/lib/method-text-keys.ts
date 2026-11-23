// Catalogue keys for the method's own words beyond rule titles and prompts
// (languages.md §13, D5b). Written out rather than built from a template, so
// the catalogue coverage test can find each key's consumer. A test in
// test/method-rule-locale.test.tsx keeps these maps equal to packages/method.

/** §2.2 phase titles, by phase 0 to 7. */
export const PHASE_TITLE_KEYS: Readonly<Record<number, string>> = {
  0: "method.phase.0.title",
  1: "method.phase.1.title",
  2: "method.phase.2.title",
  3: "method.phase.3.title",
  4: "method.phase.4.title",
  5: "method.phase.5.title",
  6: "method.phase.6.title",
  7: "method.phase.7.title",
};

/** §2.2 phase outputs, by phase 0 to 7. */
export const PHASE_OUTPUT_KEYS: Readonly<Record<number, string>> = {
  0: "method.phase.0.output",
  1: "method.phase.1.output",
  2: "method.phase.2.output",
  3: "method.phase.3.output",
  4: "method.phase.4.output",
  5: "method.phase.5.output",
  6: "method.phase.6.output",
  7: "method.phase.7.output",
};

/** §4.5 publish gates, by gate 1 to 6. */
export const GATE_TITLE_KEYS: Readonly<Record<number, string>> = {
  1: "method.gate.1.title",
  2: "method.gate.2.title",
  3: "method.gate.3.title",
  4: "method.gate.4.title",
  5: "method.gate.5.title",
  6: "method.gate.6.title",
};

/** §7.2 weekly steps, by step 1 to 4. */
export const WEEKLY_STEP_TITLE_KEYS: Readonly<Record<number, string>> = {
  1: "method.weeklyStep.1.title",
  2: "method.weeklyStep.2.title",
  3: "method.weeklyStep.3.title",
  4: "method.weeklyStep.4.title",
};

/** §7.2 weekly step purposes, by step 1 to 4. */
export const WEEKLY_STEP_PURPOSE_KEYS: Readonly<Record<number, string>> = {
  1: "method.weeklyStep.1.purpose",
  2: "method.weeklyStep.2.purpose",
  3: "method.weeklyStep.3.purpose",
  4: "method.weeklyStep.4.purpose",
};

/** §8.1 review stages, by stage 1 to 11. */
export const REVIEW_STAGE_TITLE_KEYS: Readonly<Record<number, string>> = {
  1: "method.reviewStage.1.title",
  2: "method.reviewStage.2.title",
  3: "method.reviewStage.3.title",
  4: "method.reviewStage.4.title",
  5: "method.reviewStage.5.title",
  6: "method.reviewStage.6.title",
  7: "method.reviewStage.7.title",
  8: "method.reviewStage.8.title",
  9: "method.reviewStage.9.title",
  10: "method.reviewStage.10.title",
  11: "method.reviewStage.11.title",
};

/** §8.1 review stage purposes, by stage 1 to 11. */
export const REVIEW_STAGE_PURPOSE_KEYS: Readonly<Record<number, string>> = {
  1: "method.reviewStage.1.purpose",
  2: "method.reviewStage.2.purpose",
  3: "method.reviewStage.3.purpose",
  4: "method.reviewStage.4.purpose",
  5: "method.reviewStage.5.purpose",
  6: "method.reviewStage.6.purpose",
  7: "method.reviewStage.7.purpose",
  8: "method.reviewStage.8.purpose",
  9: "method.reviewStage.9.purpose",
  10: "method.reviewStage.10.purpose",
  11: "method.reviewStage.11.purpose",
};

/** §8.5 process-health statements, by statement 1 to 5. */
export const PROCESS_HEALTH_KEYS: Readonly<Record<number, string>> = {
  1: "method.processHealth.1",
  2: "method.processHealth.2",
  3: "method.processHealth.3",
  4: "method.processHealth.4",
  5: "method.processHealth.5",
};

/** §6.4 when each trigger fires, by rule key. */
export const TRIGGER_FIRES_KEYS: Readonly<Record<string, string>> = {
  "checkin.due_soon": "method.trigger.checkin.due_soon.fires",
  "checkin.due": "method.trigger.checkin.due.fires",
  "checkin.overdue": "method.trigger.checkin.overdue.fires",
  "checkin.stale": "method.trigger.checkin.stale.fires",
  "checkin.week": "method.trigger.checkin.week.fires",
  "checkin.peer": "method.trigger.checkin.peer.fires",
  "ack.owed": "method.trigger.ack.owed.fires",
  "ack.overdue": "method.trigger.ack.overdue.fires",
  "blocker.warning": "method.trigger.blocker.warning.fires",
  "blocker.overdue": "method.trigger.blocker.overdue.fires",
  "blocker.escalated": "method.trigger.blocker.escalated.fires",
  "confidence.critical": "method.trigger.confidence.critical.fires",
  "commitment.due": "method.trigger.commitment.due.fires",
  "session.due_soon": "method.trigger.session.due_soon.fires",
  "session.open": "method.trigger.session.open.fires",
  "session.missed": "method.trigger.session.missed.fires",
  "session.left_open": "method.trigger.session.left_open.fires",
  "streak.at_risk": "method.trigger.streak.at_risk.fires",
  "digest.weekly": "method.trigger.digest.weekly.fires",
  "digest.daily": "method.trigger.digest.daily.fires",
  "kpi.watch": "method.trigger.kpi.watch.fires",
  "kpi.unhealthy": "method.trigger.kpi.unhealthy.fires",
  "kpi.recovery_proposed": "method.trigger.kpi.recovery_proposed.fires",
  "kpi.recovered": "method.trigger.kpi.recovered.fires",
  "cycle.planning_opens": "method.trigger.cycle.planning_opens.fires",
  "cycle.phase_blocked": "method.trigger.cycle.phase_blocked.fires",
  "cycle.deadline": "method.trigger.cycle.deadline.fires",
  "cycle.starts": "method.trigger.cycle.starts.fires",
  "cycle.review_due": "method.trigger.cycle.review_due.fires",
  "cycle.closing": "method.trigger.cycle.closing.fires",
  "channel.reconnect_needed": "method.trigger.channel.reconnect_needed.fires",
  "quality.draft_failing": "method.trigger.quality.draft_failing.fires",
  "quality.gate_blocked": "method.trigger.quality.gate_blocked.fires",
  "quality.no_not_doing": "method.trigger.quality.no_not_doing.fires",
  "quality.too_many_objectives":
    "method.trigger.quality.too_many_objectives.fires",
  "quality.all_lagging": "method.trigger.quality.all_lagging.fires",
  "quality.no_baseline": "method.trigger.quality.no_baseline.fires",
  "quality.committed_floor": "method.trigger.quality.committed_floor.fires",
  "quality.sandbagging_draft": "method.trigger.quality.sandbagging_draft.fires",
  "quality.sandbagging_close": "method.trigger.quality.sandbagging_close.fires",
  "quality.orphan_goal": "method.trigger.quality.orphan_goal.fires",
  "quality.level_skip": "method.trigger.quality.level_skip.fires",
  "quality.silo": "method.trigger.quality.silo.fires",
  "quality.conflict": "method.trigger.quality.conflict.fires",
  "quality.dependency_unowned":
    "method.trigger.quality.dependency_unowned.fires",
  "quality.no_cuts": "method.trigger.quality.no_cuts.fires",
  "quality.divergence": "method.trigger.quality.divergence.fires",
  "quality.trending_off": "method.trigger.quality.trending_off.fires",
  "quality.process_health_low":
    "method.trigger.quality.process_health_low.fires",
  "quality.review_requested": "method.trigger.quality.review_requested.fires",
};

/** §6.4 who each trigger reaches, by rule key. */
export const TRIGGER_RECIPIENT_KEYS: Readonly<Record<string, string>> = {
  "checkin.due_soon": "method.trigger.checkin.due_soon.recipient",
  "checkin.due": "method.trigger.checkin.due.recipient",
  "checkin.overdue": "method.trigger.checkin.overdue.recipient",
  "checkin.stale": "method.trigger.checkin.stale.recipient",
  "checkin.week": "method.trigger.checkin.week.recipient",
  "checkin.peer": "method.trigger.checkin.peer.recipient",
  "ack.owed": "method.trigger.ack.owed.recipient",
  "ack.overdue": "method.trigger.ack.overdue.recipient",
  "blocker.warning": "method.trigger.blocker.warning.recipient",
  "blocker.overdue": "method.trigger.blocker.overdue.recipient",
  "blocker.escalated": "method.trigger.blocker.escalated.recipient",
  "confidence.critical": "method.trigger.confidence.critical.recipient",
  "commitment.due": "method.trigger.commitment.due.recipient",
  "session.due_soon": "method.trigger.session.due_soon.recipient",
  "session.open": "method.trigger.session.open.recipient",
  "session.missed": "method.trigger.session.missed.recipient",
  "session.left_open": "method.trigger.session.left_open.recipient",
  "streak.at_risk": "method.trigger.streak.at_risk.recipient",
  "digest.weekly": "method.trigger.digest.weekly.recipient",
  "digest.daily": "method.trigger.digest.daily.recipient",
  "kpi.watch": "method.trigger.kpi.watch.recipient",
  "kpi.unhealthy": "method.trigger.kpi.unhealthy.recipient",
  "kpi.recovery_proposed": "method.trigger.kpi.recovery_proposed.recipient",
  "kpi.recovered": "method.trigger.kpi.recovered.recipient",
  "cycle.planning_opens": "method.trigger.cycle.planning_opens.recipient",
  "cycle.phase_blocked": "method.trigger.cycle.phase_blocked.recipient",
  "cycle.deadline": "method.trigger.cycle.deadline.recipient",
  "cycle.starts": "method.trigger.cycle.starts.recipient",
  "cycle.review_due": "method.trigger.cycle.review_due.recipient",
  "cycle.closing": "method.trigger.cycle.closing.recipient",
  "channel.reconnect_needed":
    "method.trigger.channel.reconnect_needed.recipient",
  "quality.draft_failing": "method.trigger.quality.draft_failing.recipient",
  "quality.gate_blocked": "method.trigger.quality.gate_blocked.recipient",
  "quality.no_not_doing": "method.trigger.quality.no_not_doing.recipient",
  "quality.too_many_objectives":
    "method.trigger.quality.too_many_objectives.recipient",
  "quality.all_lagging": "method.trigger.quality.all_lagging.recipient",
  "quality.no_baseline": "method.trigger.quality.no_baseline.recipient",
  "quality.committed_floor": "method.trigger.quality.committed_floor.recipient",
  "quality.sandbagging_draft":
    "method.trigger.quality.sandbagging_draft.recipient",
  "quality.sandbagging_close":
    "method.trigger.quality.sandbagging_close.recipient",
  "quality.orphan_goal": "method.trigger.quality.orphan_goal.recipient",
  "quality.level_skip": "method.trigger.quality.level_skip.recipient",
  "quality.silo": "method.trigger.quality.silo.recipient",
  "quality.conflict": "method.trigger.quality.conflict.recipient",
  "quality.dependency_unowned":
    "method.trigger.quality.dependency_unowned.recipient",
  "quality.no_cuts": "method.trigger.quality.no_cuts.recipient",
  "quality.divergence": "method.trigger.quality.divergence.recipient",
  "quality.trending_off": "method.trigger.quality.trending_off.recipient",
  "quality.process_health_low":
    "method.trigger.quality.process_health_low.recipient",
  "quality.review_requested":
    "method.trigger.quality.review_requested.recipient",
};
