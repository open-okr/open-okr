/**
 * AI-NATIVE-PLAN.md §6.4's trigger catalogue, as data (P4-T01e).
 *
 * Every proactive message the product can send is a row here. The rule is that
 * **a message citing a key this file does not define fails the build**, which
 * only works if this is the one place the keys live. The nudge engine reads it,
 * the two agents read it, and the conformance suite compares it against the
 * document.
 *
 * `deterministic` is the load-bearing column. The product is whole with the AI
 * provider off, so all but one of these fire without it. `quality.conflict` is
 * the exception and says so: it is a judgement about meaning, so with AI off it
 * does not fire and nothing is claimed on its behalf.
 *
 * No timings are written here as numbers. Where a trigger fires on a threshold,
 * the threshold is a §11 parameter and the engine reads it; this file says
 * which trigger exists, who hears it, and whether it escalates.
 */

export type TriggerOwner = "champion" | "coach";

export interface Trigger {
  /** The rule key a nudge row and every message carries. */
  readonly key: string;
  /**
   * What the rule is called where a person reads it: the headline of the
   * message it sends and its row on the nudge volume page (completeness
   * review H-12). The web catalogue holds the same words for translation,
   * and a test there keeps the two equal.
   */
  readonly title: string;
  readonly owner: TriggerOwner;
  /** The condition, in the document's own words. */
  readonly fires: string;
  readonly recipient: string;
  /** True when this trigger climbs an escalation ladder rather than repeating. */
  readonly escalates: boolean;
  /** False only where the AI provider is required for the trigger to mean anything. */
  readonly deterministic: boolean;
}

/** §6.4's first table: the rhythm the Champion guards. */
const RHYTHM_ROWS = [
  {
    key: "checkin.due_soon",
    title: "Check-in due tomorrow",
    fires: "1 day before anchor",
    recipient: "Champion",
    escalates: false,
  },
  {
    key: "checkin.due",
    title: "Check-in due today",
    fires: "On anchor day",
    recipient: "Champion",
    escalates: false,
  },
  {
    key: "checkin.overdue",
    title: "Check-in overdue",
    fires: "Daily past due, escalating",
    recipient: "Champion, then ladder",
    escalates: true,
  },
  {
    key: "checkin.stale",
    title: "Check-in past its grace",
    fires: "Grace exceeded",
    recipient: "Champion + reviewer",
    escalates: false,
  },
  {
    key: "ack.owed",
    title: "Acknowledgement owed",
    fires: "1 day after publication",
    recipient: "Reviewer",
    escalates: false,
  },
  {
    key: "ack.overdue",
    title: "Acknowledgement overdue",
    fires: "3 days after publication",
    recipient: "Reviewer, then ladder",
    escalates: true,
  },
  {
    key: "blocker.warning",
    title: "Blocker nearing its deadline",
    fires: "20h after opening",
    recipient: "Blocker owner",
    escalates: false,
  },
  {
    key: "blocker.overdue",
    title: "Blocker overdue",
    fires: "24h after opening",
    recipient: "Coordinator",
    escalates: true,
  },
  {
    key: "blocker.escalated",
    title: "Blocker escalated",
    fires: "48h after opening",
    recipient: "Sponsor",
    escalates: true,
  },
  {
    key: "confidence.critical",
    title: "Confidence critically low",
    fires: "KR scored <= 0.3",
    recipient: "Coordinator, same day",
    escalates: true,
  },
  {
    key: "commitment.due",
    title: "Commitment due",
    fires: "End of commitment week",
    recipient: "Owner",
    escalates: false,
  },
  {
    key: "session.due_soon",
    title: "Session tomorrow",
    fires: "1 day before weekly session",
    recipient: "Coordinator + space",
    escalates: false,
  },
  {
    key: "session.open",
    title: "Session starting",
    fires: "Scheduled start",
    recipient: "Space",
    escalates: false,
  },
  {
    key: "session.missed",
    title: "Session missed",
    fires: "1 day after missed session",
    recipient: "Coordinator, then sponsor",
    escalates: true,
  },
  {
    key: "streak.at_risk",
    title: "Streak at risk",
    fires: "Week would break streak",
    recipient: "Coordinator",
    escalates: false,
  },
  {
    key: "digest.weekly",
    title: "Weekly digest",
    fires: "After session closes",
    recipient: "Space + leadership",
    escalates: false,
  },
  {
    key: "digest.daily",
    title: "Daily digest",
    fires: "Member's local morning",
    recipient: "Opted-in members",
    escalates: false,
  },
  {
    key: "kpi.watch",
    title: "KPI entered the watch corridor",
    fires: "KPI enters watch corridor",
    recipient: "KPI owner",
    escalates: false,
  },
  {
    key: "kpi.unhealthy",
    title: "KPI unhealthy",
    fires: "KPI enters unhealthy corridor",
    recipient: "KPI owner + sponsor",
    escalates: false,
  },
  {
    key: "kpi.recovery_proposed",
    title: "KPI recovery proposed",
    fires: "Unhealthy for two consecutive periods",
    recipient: "KPI owner, carrying a drafted recovery OKR",
    escalates: false,
  },
  {
    key: "kpi.recovered",
    title: "KPI recovered",
    fires: "Real achievement re-enters the healthy corridor",
    recipient: "KPI owner, proposing to close the recovery OKR",
    escalates: false,
  },
  {
    key: "cycle.planning_opens",
    title: "Planning opens",
    fires: "6w (annual) or 3w (quarterly) before start",
    recipient: "Sponsor + facilitator",
    escalates: false,
  },
  {
    key: "cycle.phase_blocked",
    title: "Phase blocked",
    fires: "Phase conditions unmet as window closes",
    recipient: "Facilitator",
    escalates: false,
  },
  {
    key: "cycle.deadline",
    title: "Publication deadline approaching",
    fires: "14, 7, 1 days before publication deadline",
    recipient: "Sponsor + facilitator",
    escalates: false,
  },
  {
    key: "cycle.starts",
    title: "Cycle starts",
    fires: "Day one",
    recipient: "Everyone",
    escalates: false,
  },
  {
    key: "cycle.review_due",
    title: "Cycle review due",
    fires: "2 weeks before cycle ends",
    recipient: "Facilitator",
    escalates: false,
  },
  {
    key: "cycle.closing",
    title: "Cycle closing unscored",
    fires: "Cycle ends unscored",
    recipient: "Facilitator + sponsor",
    escalates: false,
  },
  {
    // Operational rather than a practice rule, and it is here because every
    // proactive message is a nudge row and every nudge row cites a key this
    // file defines (P5-T01b-b, approved 27 August 2026). The Champion owns it
    // because a channel nobody can reach is the rhythm failing to arrive.
    key: "channel.reconnect_needed",
    title: "Channel needs reconnecting",
    fires: "A send to the member’s primary channel fails",
    recipient: "The member, by email and in-app",
    escalates: false,
  },
] as const;

const RHYTHM = RHYTHM_ROWS.map((entry) => ({
  ...entry,
  owner: "champion" as const,
  deterministic: true,
})) satisfies readonly Trigger[];

/** §6.4's second table: the quality the Coach guards. */
const QUALITY_ROWS = [
  {
    key: "quality.draft_failing",
    title: "Draft failing a quality check",
    fires: "Live as draft is written",
    recipient: "Author, inline",
    deterministic: true,
  },
  {
    key: "quality.gate_blocked",
    title: "Publish gate blocked",
    fires: "On publish attempt",
    recipient: "Facilitator",
    deterministic: true,
  },
  {
    key: "quality.no_not_doing",
    title: "No not-doing list",
    fires: "Phase 3 exit without not-doing list",
    recipient: "Sponsor + facilitator",
    deterministic: true,
  },
  {
    key: "quality.too_many_objectives",
    title: "Too many objectives",
    fires: "Level exceeds cap",
    recipient: "Facilitator",
    deterministic: true,
  },
  {
    key: "quality.all_lagging",
    title: "Every key result lagging",
    fires: "All KRs lagging",
    recipient: "Champion",
    deterministic: true,
  },
  {
    key: "quality.no_baseline",
    title: "Key result has no baseline",
    fires: "KR lacks baseline at Phase 4 exit",
    recipient: "Champion",
    deterministic: true,
  },
  {
    key: "quality.sandbagging_draft",
    title: "Draft targets look too safe",
    fires: "Avg draft confidence > 0.9",
    recipient: "Champion + facilitator",
    deterministic: true,
  },
  {
    key: "quality.sandbagging_close",
    title: "Closing scores look too safe",
    fires: "Scores cluster > 0.85 at close",
    recipient: "Sponsor",
    deterministic: true,
  },
  {
    key: "quality.orphan_goal",
    title: "Goal has no parent",
    fires: "Goal below company has no parent",
    recipient: "Champion",
    deterministic: true,
  },
  {
    key: "quality.level_skip",
    title: "Alignment skips a level",
    fires: "Alignment skips a level",
    recipient: "Champion",
    deterministic: true,
  },
  {
    key: "quality.silo",
    title: "Department has no shared dependency",
    fires: "Dept subtree has no horizontal dep",
    recipient: "Department lead",
    deterministic: true,
  },
  {
    key: "quality.conflict",
    title: "Two goals conflict",
    fires:
      "Two goals double-count or oppose each other, from the nightly semantic sweep",
    recipient: "Both champions, with the reason",
    // The only one in the catalogue that needs the provider. It is a judgement
    // about meaning, so with AI off it does not fire rather than guessing.
    deterministic: false,
  },
  {
    key: "quality.dependency_unowned",
    title: "Dependency has no owner",
    fires: "Dep unconfirmed, no risk owner",
    recipient: "Champion",
    deterministic: true,
  },
  {
    key: "quality.no_cuts",
    title: "Capacity checked, nothing cut",
    fires: "Capacity checked, nothing cut",
    recipient: "Facilitator",
    deterministic: true,
  },
  {
    key: "quality.divergence",
    title: "Health disagrees with the data",
    fires: "Health disagrees with data",
    recipient: "Champion + reviewer",
    deterministic: true,
  },
  {
    key: "quality.trending_off",
    title: "Forecast misses the target",
    fires: "Forecast misses target",
    recipient: "Champion",
    deterministic: true,
  },
  {
    key: "quality.process_health_low",
    title: "Process health low",
    fires: "Process-health statement scores low",
    recipient: "Sponsor",
    deterministic: true,
  },
] as const;

const QUALITY = QUALITY_ROWS.map((entry) => ({
  ...entry,
  owner: "coach" as const,
  escalates: false,
})) satisfies readonly Trigger[];

/**
 * Every key the catalogue defines, as a type (completeness review L-16).
 *
 * The rule that a message citing an undefined key fails the build was a
 * runtime throw: seven places in the nudge engine check `isTriggerKey` before
 * writing a row, which catches a misspelt key the first time that path runs
 * and not before. Code that names a key names this type instead, so a typo
 * is a type error in `pnpm typecheck`. The throws stay, because a key read
 * back from a stored row or a form is only a string until it is checked.
 */
export type TriggerKey =
  | (typeof RHYTHM_ROWS)[number]["key"]
  | (typeof QUALITY_ROWS)[number]["key"];

export const TRIGGER_CATALOGUE: readonly Trigger[] = [...RHYTHM, ...QUALITY];

const BY_KEY = new Map(TRIGGER_CATALOGUE.map((entry) => [entry.key, entry]));

/** The one lookup every caller uses, so an unknown key is caught in one place. */
export function trigger(key: string): Trigger | undefined {
  return BY_KEY.get(key);
}

/**
 * Whether this key names a trigger the package defines.
 *
 * The nudge engine calls this before writing a row, and the conformance suite
 * calls it over every key the documents cite. A message citing a key nothing
 * defines is the failure both are there to prevent.
 */
export function isTriggerKey(key: string): key is TriggerKey {
  return BY_KEY.has(key);
}

/** What still fires with the AI provider off, which is all but one of them. */
export function deterministicTriggers(): readonly Trigger[] {
  return TRIGGER_CATALOGUE.filter((entry) => entry.deterministic);
}
