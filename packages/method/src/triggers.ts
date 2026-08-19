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
const RHYTHM: readonly Trigger[] = [
  {
    key: "checkin.due_soon",
    fires: "1 day before anchor",
    recipient: "Champion",
    escalates: false,
  },
  {
    key: "checkin.due",
    fires: "On anchor day",
    recipient: "Champion",
    escalates: false,
  },
  {
    key: "checkin.overdue",
    fires: "Daily past due, escalating",
    recipient: "Champion, then ladder",
    escalates: true,
  },
  {
    key: "checkin.stale",
    fires: "Grace exceeded",
    recipient: "Champion + reviewer",
    escalates: false,
  },
  {
    key: "ack.owed",
    fires: "1 day after publication",
    recipient: "Reviewer",
    escalates: false,
  },
  {
    key: "ack.overdue",
    fires: "3 days after publication",
    recipient: "Reviewer, then ladder",
    escalates: true,
  },
  {
    key: "blocker.warning",
    fires: "20h after opening",
    recipient: "Blocker owner",
    escalates: false,
  },
  {
    key: "blocker.overdue",
    fires: "24h after opening",
    recipient: "Coordinator",
    escalates: true,
  },
  {
    key: "blocker.escalated",
    fires: "48h after opening",
    recipient: "Sponsor",
    escalates: true,
  },
  {
    key: "confidence.critical",
    fires: "KR scored <= 0.3",
    recipient: "Coordinator, same day",
    escalates: true,
  },
  {
    key: "commitment.due",
    fires: "End of commitment week",
    recipient: "Owner",
    escalates: false,
  },
  {
    key: "session.due_soon",
    fires: "1 day before weekly session",
    recipient: "Coordinator + space",
    escalates: false,
  },
  {
    key: "session.open",
    fires: "Scheduled start",
    recipient: "Space",
    escalates: false,
  },
  {
    key: "session.missed",
    fires: "1 day after missed session",
    recipient: "Coordinator, then sponsor",
    escalates: true,
  },
  {
    key: "streak.at_risk",
    fires: "Week would break streak",
    recipient: "Coordinator",
    escalates: false,
  },
  {
    key: "digest.weekly",
    fires: "After session closes",
    recipient: "Space + leadership",
    escalates: false,
  },
  {
    key: "digest.daily",
    fires: "Member's local morning",
    recipient: "Opted-in members",
    escalates: false,
  },
  {
    key: "kpi.watch",
    fires: "KPI enters watch corridor",
    recipient: "KPI owner",
    escalates: false,
  },
  {
    key: "kpi.unhealthy",
    fires: "KPI enters unhealthy corridor",
    recipient: "KPI owner + sponsor",
    escalates: false,
  },
  {
    key: "kpi.recovery_proposed",
    fires: "Unhealthy for two consecutive periods",
    recipient: "KPI owner, carrying a drafted recovery OKR",
    escalates: false,
  },
  {
    key: "kpi.recovered",
    fires: "Real achievement re-enters the healthy corridor",
    recipient: "KPI owner, proposing to close the recovery OKR",
    escalates: false,
  },
  {
    key: "cycle.planning_opens",
    fires: "6w (annual) or 3w (quarterly) before start",
    recipient: "Sponsor + facilitator",
    escalates: false,
  },
  {
    key: "cycle.phase_blocked",
    fires: "Phase conditions unmet as window closes",
    recipient: "Facilitator",
    escalates: false,
  },
  {
    key: "cycle.deadline",
    fires: "14, 7, 1 days before publication deadline",
    recipient: "Sponsor + facilitator",
    escalates: false,
  },
  {
    key: "cycle.starts",
    fires: "Day one",
    recipient: "Everyone",
    escalates: false,
  },
  {
    key: "cycle.review_due",
    fires: "2 weeks before cycle ends",
    recipient: "Facilitator",
    escalates: false,
  },
  {
    key: "cycle.closing",
    fires: "Cycle ends unscored",
    recipient: "Facilitator + sponsor",
    escalates: false,
  },
].map((entry) => ({
  ...entry,
  owner: "champion" as const,
  deterministic: true,
}));

/** §6.4's second table: the quality the Coach guards. */
const QUALITY: readonly Trigger[] = [
  {
    key: "quality.draft_failing",
    fires: "Live as draft is written",
    recipient: "Author, inline",
    deterministic: true,
  },
  {
    key: "quality.gate_blocked",
    fires: "On publish attempt",
    recipient: "Facilitator",
    deterministic: true,
  },
  {
    key: "quality.no_not_doing",
    fires: "Phase 3 exit without not-doing list",
    recipient: "Sponsor + facilitator",
    deterministic: true,
  },
  {
    key: "quality.too_many_objectives",
    fires: "Level exceeds cap",
    recipient: "Facilitator",
    deterministic: true,
  },
  {
    key: "quality.all_lagging",
    fires: "All KRs lagging",
    recipient: "Champion",
    deterministic: true,
  },
  {
    key: "quality.no_baseline",
    fires: "KR lacks baseline at Phase 4 exit",
    recipient: "Champion",
    deterministic: true,
  },
  {
    key: "quality.sandbagging_draft",
    fires: "Avg draft confidence > 0.9",
    recipient: "Champion + facilitator",
    deterministic: true,
  },
  {
    key: "quality.sandbagging_close",
    fires: "Scores cluster > 0.85 at close",
    recipient: "Sponsor",
    deterministic: true,
  },
  {
    key: "quality.orphan_goal",
    fires: "Goal below company has no parent",
    recipient: "Champion",
    deterministic: true,
  },
  {
    key: "quality.level_skip",
    fires: "Alignment skips a level",
    recipient: "Champion",
    deterministic: true,
  },
  {
    key: "quality.silo",
    fires: "Dept subtree has no horizontal dep",
    recipient: "Department lead",
    deterministic: true,
  },
  {
    key: "quality.conflict",
    fires:
      "Two goals double-count or oppose each other, from the nightly semantic sweep",
    recipient: "Both champions, with the reason",
    // The only one in the catalogue that needs the provider. It is a judgement
    // about meaning, so with AI off it does not fire rather than guessing.
    deterministic: false,
  },
  {
    key: "quality.dependency_unowned",
    fires: "Dep unconfirmed, no risk owner",
    recipient: "Champion",
    deterministic: true,
  },
  {
    key: "quality.no_cuts",
    fires: "Capacity checked, nothing cut",
    recipient: "Facilitator",
    deterministic: true,
  },
  {
    key: "quality.divergence",
    fires: "Health disagrees with data",
    recipient: "Champion + reviewer",
    deterministic: true,
  },
  {
    key: "quality.trending_off",
    fires: "Forecast misses target",
    recipient: "Champion",
    deterministic: true,
  },
  {
    key: "quality.process_health_low",
    fires: "Process-health statement scores low",
    recipient: "Sponsor",
    deterministic: true,
  },
].map((entry) => ({ ...entry, owner: "coach" as const, escalates: false }));

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
export function isTriggerKey(key: string): boolean {
  return BY_KEY.has(key);
}

/** What still fires with the AI provider off, which is all but one of them. */
export function deterministicTriggers(): readonly Trigger[] {
  return TRIGGER_CATALOGUE.filter((entry) => entry.deterministic);
}
