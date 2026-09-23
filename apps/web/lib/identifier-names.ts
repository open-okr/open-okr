/**
 * Readable names for the identifiers an admin screen used to print raw
 * (P8-G11d).
 *
 * **Four admin screens showed 67 dotted identifiers**, measured in a browser:
 * 45 trigger keys on the nudge volume page, 14 assist keys and two prompt keys
 * on the AI console, four schedules on the agents page, and one setting name
 * in a sentence. Agung's decision on 23 September 2026: what is technical, code
 * or plan belongs out of the interface, because a reader does not need it.
 *
 * **Two identifiers on those screens are not identifiers**, and stay: the model
 * names `llama3.1` and `llama3.2`. Those are what the models are called.
 *
 * **The keys themselves are unchanged and still do their job.** CLAUDE.md
 * requires every proactive message to carry a rule key that resolves to a rule
 * in `packages/method`, and the conformance suite still fails a build where a
 * message cites a key the package does not define. What changed is what is
 * printed, not what is recorded: the nudge row, the audit row and the agent
 * catalogue all still carry the key.
 *
 * **A map rather than a prettifier.** Turning `checkin.due` into "Check-in due"
 * mechanically is tempting and then produces "Ack owed" and "Streak at risk"
 * for rows that mean "somebody owes an acknowledgement" and "this week would
 * break the streak". A map says what each one is; the test beside it fails the
 * build when a new trigger arrives without a name, which is the same guarantee
 * `nav-icons.tsx` gets from the test that its map covers the registry.
 *
 * **The values are catalogue keys, not words.** The catalogue gate looks for
 * each key as a literal string somewhere under `app`, `lib` or `packages/ui`,
 * so a key assembled at runtime would be reported as having no consumer. Every
 * one is written out here for that reason.
 */

/** METHOD.md's proactive triggers, as the nudge volume page lists them. */
export const TRIGGER_NAME_KEYS: Readonly<Record<string, string>> = {
  "checkin.due_soon": "triggers.checkinDueSoon",
  "checkin.due": "triggers.checkinDue",
  "checkin.overdue": "triggers.checkinOverdue",
  "checkin.stale": "triggers.checkinStale",
  "ack.owed": "triggers.ackOwed",
  "ack.overdue": "triggers.ackOverdue",
  "blocker.warning": "triggers.blockerWarning",
  "blocker.overdue": "triggers.blockerOverdue",
  "blocker.escalated": "triggers.blockerEscalated",
  "confidence.critical": "triggers.confidenceCritical",
  "commitment.due": "triggers.commitmentDue",
  "session.due_soon": "triggers.sessionDueSoon",
  "session.open": "triggers.sessionOpen",
  "session.missed": "triggers.sessionMissed",
  "streak.at_risk": "triggers.streakAtRisk",
  "digest.weekly": "triggers.digestWeekly",
  "digest.daily": "triggers.digestDaily",
  "kpi.watch": "triggers.kpiWatch",
  "kpi.unhealthy": "triggers.kpiUnhealthy",
  "kpi.recovery_proposed": "triggers.kpiRecoveryProposed",
  "kpi.recovered": "triggers.kpiRecovered",
  "cycle.planning_opens": "triggers.cyclePlanningOpens",
  "cycle.phase_blocked": "triggers.cyclePhaseBlocked",
  "cycle.deadline": "triggers.cycleDeadline",
  "cycle.starts": "triggers.cycleStarts",
  "cycle.review_due": "triggers.cycleReviewDue",
  "cycle.closing": "triggers.cycleClosing",
  "channel.reconnect_needed": "triggers.channelReconnectNeeded",
  "quality.draft_failing": "triggers.qualityDraftFailing",
  "quality.gate_blocked": "triggers.qualityGateBlocked",
  "quality.no_not_doing": "triggers.qualityNoNotDoing",
  "quality.too_many_objectives": "triggers.qualityTooManyObjectives",
  "quality.all_lagging": "triggers.qualityAllLagging",
  "quality.no_baseline": "triggers.qualityNoBaseline",
  "quality.sandbagging_draft": "triggers.qualitySandbaggingDraft",
  "quality.sandbagging_close": "triggers.qualitySandbaggingClose",
  "quality.orphan_goal": "triggers.qualityOrphanGoal",
  "quality.level_skip": "triggers.qualityLevelSkip",
  "quality.silo": "triggers.qualitySilo",
  "quality.conflict": "triggers.qualityConflict",
  "quality.dependency_unowned": "triggers.qualityDependencyUnowned",
  "quality.no_cuts": "triggers.qualityNoCuts",
  "quality.divergence": "triggers.qualityDivergence",
  "quality.trending_off": "triggers.qualityTrendingOff",
  "quality.process_health_low": "triggers.qualityProcessHealthLow",
};

/** The AI assists that have a switch on the AI console. */
export const ASSIST_NAME_KEYS: Readonly<Record<string, string>> = {
  "assists.draftObjective": "assists.draftObjective",
  "assists.suggestMeasure": "assists.suggestMeasure",
  "assists.suggestParent": "assists.suggestParent",
  "assists.parseFilter": "assists.parseFilter",
  "assists.proposeImportMapping": "assists.proposeImportMapping",
  "assists.clusterRetro": "assists.clusterRetro",
  "assists.narrateDiagnostic": "assists.narrateDiagnostic",
  "assists.draftMinutes": "assists.draftMinutes",
  "assists.draftRetrospective": "assists.draftRetrospective",
  "assists.proposeObjectives": "assists.proposeObjectives",
  "assists.narrateDigest": "assists.narrateDigest",
  "assists.narrateTrend": "assists.narrateTrend",
  "assists.summariseBlockers": "assists.summariseBlockers",
  "assists.suggestKpi": "assists.suggestKpi",
};

/** The agent run schedules. */
export const SCHEDULE_NAME_KEYS: Readonly<Record<string, string>> = {
  "schedule.hourly": "schedules.hourly",
  "schedule.daily": "schedules.daily",
  "schedule.weekly": "schedules.weekly",
  "schedule.cycle": "schedules.cycle",
  "schedule.quality": "schedules.quality",
};

/**
 * The stored prompt templates.
 *
 * Not enumerated from a key map, because a prompt is a row a workspace stores
 * rather than a fixed list, so an unknown one is normal here rather than a
 * missing name. The caller falls back to the key for those.
 */
export const PROMPT_NAME_KEYS: Readonly<Record<string, string>> = {
  "draft.objective": "prompts.draftObjective",
  "rewrite.failing_rule": "prompts.rewriteFailingRule",
};

/**
 * The channel a nudge was delivered on.
 *
 * The stored values are not all one shape: `in_app` is what the nudge rows
 * carry and `app` is what the member preference uses, so both are here rather
 * than one being assumed.
 */
export const CHANNEL_NAME_KEYS: Readonly<Record<string, string>> = {
  in_app: "channels.inApp",
  app: "channels.inApp",
  email: "channels.email",
  slack: "channels.slack",
  teams: "channels.teams",
  whatsapp: "channels.whatsapp",
  telegram: "channels.telegram",
};
