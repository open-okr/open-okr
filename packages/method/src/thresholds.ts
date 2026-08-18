/**
 * The METHOD.md §11 threshold registry, as data.
 *
 * §11 states the rule this file exists to make mechanical: "Every numeric value
 * the product enforces, computes with or fires on is a parameter in this
 * registry. Each parameter ships as data in `packages/method` with the canon
 * default shown here, and may be overridden per workspace in the rhythm
 * settings. Nothing numeric is hardcoded anywhere else, and a value not in this
 * registry is not a setting."
 *
 * So: every threshold, band, corridor, ladder, cap, bound and boundary the
 * product fires on is below, once, with the canon default, the METHOD.md
 * section that defines it, and a schema that decides what an override may say.
 * A workspace stores only its deviations (`rhythm_settings.overrides`), and
 * `resolveThresholds` puts the two together.
 *
 * **Structure is not configurable.** §11 also says which checks exist, the six
 * publish gates, the taxonomies, the session agendas, the health precedence, the
 * diagnostic verdicts and the feed-forward mapping are canon and cannot be
 * changed: "A workspace that needs a different structure is practising a
 * different method, not configuring this one." Nothing structural is in here.
 *
 * **Not in here either:** the §2.4 planning timelines, which §11 calls "guidance
 * for humans, not machine thresholds"; the §4 quality word lists, which are data
 * but not numeric and which arrive with the quality engine at P4-T01; and the
 * evaluation safety bounds in the KPI formula design (maximum depth, node count),
 * which are limits on an evaluator rather than thresholds the practice fires on.
 *
 * Pure. No database, no clock, no network, no framework. It runs identically in
 * the browser as somebody types, on the server before a write, inside the agents
 * and in the importer.
 *
 * The conformance suite that checks these defaults against METHOD.md itself is
 * P4-T01 (`pnpm method:check`). Until it exists, the `section` field on every
 * parameter is how a reader finds the sentence it came from.
 */
import { z } from "zod";
import { QUALITY_WORD_LISTS } from "./word-lists.ts";

/** Which §11 table a parameter comes from. Drives the admin card grouping. */
export type ThresholdGroup =
  | "cadence"
  | "scoring"
  | "quality"
  | "alignment"
  | "kpi"
  | "sessions";

export interface ThresholdParameter<T> {
  readonly group: ThresholdGroup;
  /** What §11's own table calls it, so the two can be read side by side. */
  readonly label: string;
  /** The METHOD.md section that defines the behaviour, not just §11's table. */
  readonly section: string;
  /** One line on why this default is the right one to ship. */
  readonly why: string;
  readonly default: T;
  /** What an override may say. Enforced on every write to rhythm settings. */
  readonly schema: z.ZodType<T>;
}

/** Declares one parameter, inferring its value type from the default. */
const param = <T>(parameter: ThresholdParameter<T>): ThresholdParameter<T> =>
  parameter;

/** A 0.0 to 1.0 boundary: confidence, score, verdict. */
const unit = z.number().min(0).max(1);
/** A percentage the product compares progress or achievement against. */
const percent = z.number().min(0).max(200);
const wholeDays = z.number().int().min(0).max(365);
const positiveHours = z.number().int().min(1).max(720);

/** A `low` to `high` pair, where low never exceeds high. */
const bounds = (min: number, max: number) =>
  z
    .object({
      low: z.number().int().min(min).max(max),
      high: z.number().int().min(min).max(max),
    })
    .refine((value) => value.low <= value.high, {
      message: "the lower bound cannot exceed the upper bound",
    });

export const CHECK_IN_FREQUENCIES = [
  "daily",
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
] as const;
export type CheckInFrequency = (typeof CHECK_IN_FREQUENCIES)[number];

/** ISO-8601 weekday numbering: Monday is 1, Sunday is 7. */
export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export const COACH_STRICTNESS = ["advisory", "warn", "strict"] as const;
export type CoachStrictness = (typeof COACH_STRICTNESS)[number];

/**
 * Every parameter, keyed by a stable dotted key.
 *
 * The key is what a workspace's override map is keyed by and what an audit row
 * records, so it never changes once shipped. Renaming one is a data migration,
 * not an edit.
 */
export const THRESHOLDS = {
  // --- Cadence and escalation ---------------------------------------------
  "cadence.checkInFrequency": param({
    group: "cadence",
    label: "Check-in frequency",
    section: "§7.1",
    why: "Weekly. The rhythm is the product (§1 principle 5), and a week is short enough to act on and long enough to have moved.",
    default: "weekly" as CheckInFrequency,
    schema: z.enum(CHECK_IN_FREQUENCIES),
  }),
  "cadence.anchorDay": param({
    group: "cadence",
    label: "Check-in anchor day",
    section: "§7.1",
    why: "Monday, so the week is planned rather than reported on after the fact.",
    default: 1,
    schema: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
      z.literal(7),
    ]),
  }),
  "cadence.toleranceDays": param({
    group: "cadence",
    label: "Cadence tolerance",
    section: "§7.1",
    why: "One day either side of the due date, so a check-in a day early or late does not double-advance the rhythm or count as missed.",
    default: 1,
    schema: wholeDays,
  }),
  "cadence.stalenessGraceDays": param({
    group: "cadence",
    label: "Staleness grace",
    section: "§3.5",
    why: "Three days past the due date, after which the goal reads outdated. Neglect must be visible (§1 principle 8), and three days is late rather than busy.",
    default: 3,
    schema: wholeDays,
  }),
  "cadence.checkInLadderDays": param({
    group: "cadence",
    label: "Check-in escalation ladder",
    section: "§11",
    why: "Champion at due, champion again at one day overdue, reviewer once the grace is exceeded, coordinator at seven days, sponsor at fourteen. Widening rather than repeating is what makes an escalation mean something.",
    default: { championRepeat: 1, coordinator: 7, sponsor: 14 },
    schema: z.object({
      championRepeat: wholeDays,
      coordinator: wholeDays,
      sponsor: wholeDays,
    }),
  }),
  "cadence.acknowledgementLadderDays": param({
    group: "cadence",
    label: "Acknowledgement ladder",
    section: "§11",
    why: "The reviewer is nudged one day after publication and escalated at three. A check-in nobody acknowledged is a loop left open.",
    default: { nudge: 1, escalate: 3 },
    schema: z.object({ nudge: wholeDays, escalate: wholeDays }),
  }),
  "cadence.blockerClockHours": param({
    group: "cadence",
    label: "Blocker clock",
    section: "§3.2",
    why: "Twenty-four hours to the next action. A blocker with no next action inside a day is not being worked.",
    default: 24,
    schema: positiveHours,
  }),
  "cadence.blockerLadderHours": param({
    group: "cadence",
    label: "Blocker ladder",
    section: "§11",
    why: "Owner warned at twenty hours, coordinator at twenty-four, sponsor at forty-eight. The warning arrives before the deadline, not after it.",
    default: { owner: 20, coordinator: 24, sponsor: 48 },
    schema: z.object({
      owner: positiveHours,
      coordinator: positiveHours,
      sponsor: positiveHours,
    }),
  }),
  "cadence.nudgeDeduplicationHours": param({
    group: "cadence",
    label: "Nudge deduplication window",
    section: "§11",
    why: "One nudge per subject per member per day unless the escalation step increases. The alternative is a product nobody reads.",
    default: 24,
    schema: positiveHours,
  }),
  "cadence.nudgeCeilingPerWeek": param({
    group: "cadence",
    label: "Nudge volume ceiling",
    section: "§11",
    why: "Ten per member per week, so noise is bounded and measurable rather than emergent.",
    default: 10,
    schema: z.number().int().min(0).max(200),
  }),
  "cadence.dueSoonLeadDays": param({
    group: "cadence",
    label: "Due-soon lead",
    section: "§11",
    why: "One day before the anchor day. Long enough to act on, short enough not to be forgotten.",
    default: 1,
    schema: wholeDays,
  }),
  "cadence.planningOpenLeadWeeks": param({
    group: "cadence",
    label: "Planning-open lead",
    section: "§2.4",
    why: "Six weeks before an annual cycle starts, three before a quarterly. Planning that starts in the cycle it plans is already late.",
    default: { annual: 6, quarterly: 3 },
    schema: z.object({
      annual: z.number().int().min(0).max(52),
      quarterly: z.number().int().min(0).max(52),
    }),
  }),
  "cadence.publicationCountdownDays": param({
    group: "cadence",
    label: "Publication deadline countdown",
    section: "§11",
    why: "Fourteen, seven and one days before the deadline. Three reminders spaced so the last one is still actionable.",
    default: [14, 7, 1],
    schema: z.array(wholeDays).min(1).max(6),
  }),
  "cadence.reviewPreparationLeadWeeks": param({
    group: "cadence",
    label: "Review preparation lead",
    section: "§11",
    why: "Two weeks before the cycle ends, so scoring is prepared rather than improvised in the room.",
    default: 2,
    schema: z.number().int().min(0).max(52),
  }),

  // --- Confidence and scoring --------------------------------------------
  "scoring.confidenceHigh": param({
    group: "scoring",
    label: "Confidence high boundary",
    section: "§3.2",
    why: "0.7 and above is high: move on to the next key result.",
    default: 0.7,
    schema: unit,
  }),
  "scoring.confidenceLow": param({
    group: "scoring",
    label: "Confidence low boundary",
    section: "§3.2",
    why: "Below 0.4 is low: capture a blocker, name an owner and a next action within 24 hours.",
    default: 0.4,
    schema: unit,
  }),
  "scoring.confidenceCritical": param({
    group: "scoring",
    label: "Critical confidence",
    section: "§3.2",
    why: "0.3 and below is raised with management the same day. The one rule inside the low band.",
    default: 0.3,
    schema: unit,
  }),
  "scoring.draftSandbagging": param({
    group: "scoring",
    label: "Draft sandbagging threshold",
    section: "§3.2",
    why: "A set averaging above 0.90 at drafting is business as usual, not an OKR. Stretch honestly (§1 principle 4).",
    default: 0.9,
    schema: unit,
  }),
  "scoring.draftComfortable": param({
    group: "scoring",
    label: "Draft comfortable boundary",
    section: "§3.2",
    why: "Above 0.75 up to 0.90 is comfortable: stretch until it feels like a 6 or 7 out of 10.",
    default: 0.75,
    schema: unit,
  }),
  "scoring.draftAmbitious": param({
    group: "scoring",
    label: "Draft ambitious boundary",
    section: "§3.2",
    why: "Below 0.25 is a moonshot bordering on fantasy. Above it, ambitious but arguable.",
    default: 0.25,
    schema: unit,
  }),
  "scoring.scoreBands": param({
    group: "scoring",
    label: "Score band boundaries",
    section: "§3.3",
    why: "0.9 fully achieved, 0.7 strong, 0.4 partial. 0.7 to 0.9 is the intended level for a stretch target.",
    default: { achieved: 0.9, strong: 0.7, partial: 0.4 },
    schema: z.object({ achieved: unit, strong: unit, partial: unit }),
  }),
  "scoring.scoreAnnotations": param({
    group: "scoring",
    label: "Score annotation boundaries",
    section: "§3.3",
    why: "1.0 was too safe, 0.6 and above was the intended level, below 0.3 was disconnected from capacity. Between 0.3 and 0.6 the coach says nothing, on purpose.",
    default: { tooSafe: 1, intended: 0.6, disconnected: 0.3 },
    schema: z.object({ tooSafe: unit, intended: unit, disconnected: unit }),
  }),
  "scoring.portfolioVerdicts": param({
    group: "scoring",
    label: "Portfolio verdict boundaries",
    section: "§3.4",
    why: "Above 0.85 the targets were too safe, 0.60 to 0.85 is healthy, 0.40 to 0.60 partial, below that capacity was outrun.",
    default: { tooSafe: 0.85, healthy: 0.6, partial: 0.4 },
    schema: z.object({ tooSafe: unit, healthy: unit, partial: unit }),
  }),
  "scoring.closeSandbagging": param({
    group: "scoring",
    label: "Close sandbagging threshold",
    section: "§8.3",
    why: "Scores clustering above 0.85 at the close means the targets were safe, and the next cycle's drafting should hear about it.",
    default: 0.85,
    schema: unit,
  }),
  "scoring.rootCauseThreshold": param({
    group: "scoring",
    label: "Root-cause threshold",
    section: "§8.4",
    why: "A key result scoring below 0.7 needs a named cause. Diagnose before you prescribe (§1 principle 10).",
    default: 0.7,
    schema: unit,
  }),
  "scoring.progressSignalPass": param({
    group: "scoring",
    label: "Progress signal pass",
    section: "§3.7",
    why: "Green at or above 75% of the way. Shown beside health, never instead of it.",
    default: 75,
    schema: percent,
  }),
  "scoring.progressSignalFail": param({
    group: "scoring",
    label: "Progress signal fail",
    section: "§3.7",
    why: "Red below 50%. Amber is everything between, which is most of a cycle.",
    default: 50,
    schema: percent,
  }),

  // --- Quality and planning ---------------------------------------------
  "quality.coachStrictness": param({
    group: "quality",
    label: "Coach strictness",
    section: "§4",
    why: "Warn: a warning is worth another look, not a refusal. The six publish gates are always hard, whatever this says.",
    default: "warn" as CoachStrictness,
    schema: z.enum(COACH_STRICTNESS),
  }),
  "quality.wordLists": param({
    group: "quality",
    label: "Quality word lists",
    section: "§4.1, §4.2",
    why: "The §4 lists. A workspace adds its own vocabulary; the canon terms remain, so a local addition can never disable a canon rule.",
    default: QUALITY_WORD_LISTS as unknown as Record<string, readonly string[]>,
    schema: z.record(z.string(), z.array(z.string())),
  }),
  "sessions.quarterlyStageMinutes": param({
    group: "sessions",
    label: "Quarterly stage minutes",
    section: "§8.1",
    why: "The §8.1 durations, eleven of them in stage order. Pacing rather than a rule: §8.1 says going over is normal and visible, and the facilitator lands it.",
    default: [5, 12, 9, 3, 7, 3, 5, 3, 5, 4, 4] as readonly number[],
    schema: z.array(z.number().int().min(1).max(120)).length(11),
  }),
  "quality.strengthScoreBands": param({
    group: "quality",
    label: "Strength score boundaries",
    section: "§4",
    why: "Red below 45%, green at 75% and above. Amber between is a set worth another pass.",
    default: { red: 45, green: 75 },
    schema: z.object({ red: percent, green: percent }),
  }),
  "quality.keyResultsPerObjective": param({
    group: "quality",
    label: "Key results per objective",
    section: "§2.7",
    why: "Two to five. One measure cannot prove an objective from every angle, and six is a to-do list.",
    default: { low: 2, high: 5 },
    schema: bounds(0, 20),
  }),
  "quality.objectiveLengthWords": param({
    group: "quality",
    label: "Objective length bounds",
    section: "§4.1",
    why: "Four to eighteen words. Shorter and nobody outside the team understands it; longer and the team cannot recite it.",
    default: { low: 4, high: 18 },
    schema: bounds(1, 100),
  }),
  "quality.companyObjectiveCap": param({
    group: "quality",
    label: "Company objective cap",
    section: "§2.7",
    why: "Five, hard. If the annual set already contains everything, no quarter can choose (§1 principle 3).",
    default: 5,
    schema: z.number().int().min(1).max(50),
  }),
  "quality.objectivesPerUnitCap": param({
    group: "quality",
    label: "Objectives per unit cap",
    section: "§2.7",
    why: "Three per department or team. Focus is a decision, not a wish.",
    default: 3,
    schema: z.number().int().min(1).max(50),
  }),
  "quality.strategicIssueBounds": param({
    group: "quality",
    label: "Strategic issue bounds",
    section: "§2.3",
    why: "Three to ten, ranked by impact. Fewer than three is not a diagnosis; more than ten is not ranked. The floor was five until 2026-08-17: it held for a mid-sized company and blocked a team of eight on day one, which taught them to invent two issues rather than to diagnose, and inventing is the exact failure the check exists to prevent. A workspace that wants five back raises this.",
    default: { low: 3, high: 10 },
    schema: bounds(0, 100),
  }),
  "quality.priorityBounds": param({
    group: "quality",
    label: "Priority bounds",
    section: "§2.3",
    why: "Three to five, each with a twelve-month success statement.",
    default: { low: 3, high: 5 },
    schema: bounds(0, 50),
  }),
  "quality.annualStrategyBounds": param({
    group: "quality",
    label: "Annual strategy bounds",
    section: "§2.1",
    why: "Two to five strategic thrusts for the year.",
    default: { low: 2, high: 5 },
    schema: bounds(0, 50),
  }),
  "quality.carryForwardIssueImpact": param({
    group: "quality",
    label: "Carry-forward issue impact",
    section: "§8.9",
    why: "A carried-forward key result enters the next cycle's issue list at impact four, high enough to be looked at and short of automatic.",
    default: 4,
    schema: z.number().int().min(1).max(5),
  }),
  "quality.inputPackLeadWorkingDays": param({
    group: "quality",
    label: "Input pack lead time",
    section: "§2.6",
    why: "Three working days before session one. An incomplete pack delivered on time beats a complete pack delivered late.",
    default: 3,
    schema: wholeDays,
  }),

  // --- Alignment ---------------------------------------------------------
  "alignment.healthyThreshold": param({
    group: "alignment",
    label: "Alignment healthy threshold",
    section: "§5.2",
    why: "75 and above is healthy. Below it the coach lists the gaps, each linking to the goal that caused it.",
    default: 75,
    schema: z.number().int().min(0).max(100),
  }),
  "alignment.penalties": param({
    group: "alignment",
    label: "Alignment penalties",
    section: "§5.2",
    why: "10 for no company anchor, 12 per orphan, 4 per objective with no key results, 3 per level skip, 8 per siloed department, floor 5. An orphan costs most because a goal supporting nothing is the clearest failure on the page.",
    default: {
      noAnchor: 10,
      orphan: 12,
      noKeyResults: 4,
      levelSkip: 3,
      silo: 8,
      floor: 5,
    },
    schema: z.object({
      noAnchor: z.number().int().min(0).max(100),
      orphan: z.number().int().min(0).max(100),
      noKeyResults: z.number().int().min(0).max(100),
      levelSkip: z.number().int().min(0).max(100),
      silo: z.number().int().min(0).max(100),
      floor: z.number().int().min(0).max(100),
    }),
  }),

  // --- KPIs and recovery -------------------------------------------------
  "kpi.healthyThreshold": param({
    group: "kpi",
    label: "KPI healthy threshold",
    section: "§6.4",
    why: "90% of target and above is healthy.",
    default: 90,
    schema: percent,
  }),
  "kpi.watchThreshold": param({
    group: "kpi",
    label: "KPI watch threshold",
    section: "§6.4",
    why: "70% to below 90% is watch: watch the leading drivers. Below 70% launch a recovery OKR.",
    default: 70,
    schema: percent,
  }),
  "kpi.recoveryKeyResultCap": param({
    group: "kpi",
    label: "Recovery key result cap",
    section: "§6.5",
    why: "Four. A recovery that names more than four drivers has not chosen.",
    default: 4,
    schema: z.number().int().min(1).max(20),
  }),
  "kpi.recoveryProposalDelayPeriods": param({
    group: "kpi",
    label: "Recovery proposal delay",
    section: "§6.5",
    why: "Two consecutive unhealthy periods before the coach proposes anything, so one bad month never generates an unsolicited OKR. The draft is available for one-click launch immediately regardless.",
    default: 2,
    schema: z.number().int().min(1).max(12),
  }),

  // --- Sessions ----------------------------------------------------------
  "sessions.weeklyMinutes": param({
    group: "sessions",
    label: "Weekly session length",
    section: "§7.1",
    why: "Fifteen to thirty minutes. Long enough for four steps, short enough to hold weekly.",
    default: { low: 15, high: 30 },
    schema: bounds(1, 600),
  }),
  "sessions.monthlyMinutes": param({
    group: "sessions",
    label: "Monthly review length",
    section: "§7.5",
    why: "Thirty to sixty minutes.",
    default: { low: 30, high: 60 },
    schema: bounds(1, 600),
  }),
  "sessions.quarterlyMinutes": param({
    group: "sessions",
    label: "Quarterly review length",
    section: "§8.1",
    why: "Sixty minutes across the §8.1 stages.",
    default: 60,
    schema: z.number().int().min(1).max(600),
  }),
  "sessions.annualRevalidationMinutes": param({
    group: "sessions",
    label: "Annual revalidation length",
    section: "§2.1",
    why: "Thirty to sixty minutes. The annual frame is revalidated each quarter, never rewritten.",
    default: { low: 30, high: 60 },
    schema: bounds(1, 600),
  }),
  "sessions.weeklyCommitmentBounds": param({
    group: "sessions",
    label: "Weekly commitment bounds",
    section: "§7.2",
    why: "Two to three commitments per week. More than three is a list nobody keeps.",
    default: { low: 2, high: 3 },
    schema: bounds(0, 20),
  }),
  "sessions.roomPulseBands": param({
    group: "sessions",
    label: "Room pulse read boundaries",
    section: "§8.2",
    why: "4.0 and 3.0 on a five-point read, so the facilitator knows whether to open the room or move on.",
    default: { high: 4, low: 3 },
    schema: z.object({
      high: z.number().min(1).max(5),
      low: z.number().min(1).max(5),
    }),
  }),
  "sessions.diagnosticCycleScore": param({
    group: "sessions",
    label: "Diagnostic cycle-score threshold",
    section: "§8.6",
    why: "0.7. Below it the cycle missed, and the rhythm score decides whether that is a strategy problem or a cadence one (§1 principle 10).",
    default: 0.7,
    schema: unit,
  }),
  "sessions.diagnosticRhythmScore": param({
    group: "sessions",
    label: "Diagnostic rhythm-score threshold",
    section: "§8.6",
    why: "3.5 on a five-point read. A missed cycle with a strong rhythm and a missed cycle with a weak one need opposite fixes.",
    default: 3.5,
    schema: z.number().min(1).max(5),
  }),
} as const;

export type ThresholdKey = keyof typeof THRESHOLDS;

/** The value type of one parameter, inferred from its declared default. */
export type ThresholdValue<K extends ThresholdKey> =
  (typeof THRESHOLDS)[K] extends ThresholdParameter<infer T> ? T : never;

/** Every threshold, resolved. What an engine takes as an argument. */
export type ResolvedThresholds = {
  readonly [K in ThresholdKey]: ThresholdValue<K>;
};

/** A workspace's deviations. Sparse: an absent key reads the canon default. */
export type ThresholdOverrides = {
  readonly [K in ThresholdKey]?: ThresholdValue<K>;
};

export const THRESHOLD_KEYS = Object.keys(THRESHOLDS) as ThresholdKey[];

export function isThresholdKey(key: string): key is ThresholdKey {
  return Object.hasOwn(THRESHOLDS, key);
}

/** The canon defaults, with nothing overridden. */
export function canonThresholds(): ResolvedThresholds {
  const resolved: Record<string, unknown> = {};
  for (const key of THRESHOLD_KEYS) {
    resolved[key] = THRESHOLDS[key].default;
  }
  return resolved as ResolvedThresholds;
}

export interface ThresholdProblem {
  readonly key: string;
  readonly message: string;
}

export interface ValidationResult {
  /** Only the keys that parsed, so a caller can store a partial correction. */
  readonly overrides: ThresholdOverrides;
  readonly problems: readonly ThresholdProblem[];
}

/**
 * Validates a stored or submitted override map against the registry.
 *
 * Reports rather than throws, and reports every problem rather than the first,
 * because the caller is usually an admin screen that should show all of them at
 * once. An unknown key is a problem in its own right: §11 says "a value not in
 * this registry is not a setting", so silently ignoring one would let a
 * workspace believe it had configured something it had not.
 */
export function validateOverrides(input: unknown): ValidationResult {
  const problems: ThresholdProblem[] = [];
  const overrides: Record<string, unknown> = {};

  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return {
      overrides: {},
      problems: [
        { key: "", message: "Overrides must be an object keyed by threshold." },
      ],
    };
  }

  for (const [key, value] of Object.entries(input)) {
    if (!isThresholdKey(key)) {
      problems.push({
        key,
        message: `"${key}" is not a threshold in the METHOD.md §11 registry.`,
      });
      continue;
    }
    const parsed = THRESHOLDS[key].schema.safeParse(value);
    if (!parsed.success) {
      problems.push({
        key,
        message: parsed.error.issues.map((issue) => issue.message).join("; "),
      });
      continue;
    }
    overrides[key] = parsed.data;
  }

  return { overrides: overrides as ThresholdOverrides, problems };
}

/**
 * The canon defaults with a workspace's deviations applied.
 *
 * Invalid and unknown keys are dropped rather than allowed to poison a read:
 * a threshold that cannot be parsed has no business deciding what a member
 * sees, and the canon default always can. Writes are validated at the boundary
 * with `validateOverrides`, so a stored value that fails here means the schema
 * tightened after it was written, which is exactly when falling back is right.
 */
export function resolveThresholds(
  overrides?: ThresholdOverrides | unknown,
): ResolvedThresholds {
  const resolved = canonThresholds() as Record<string, unknown>;
  if (overrides === undefined || overrides === null) {
    return resolved as ResolvedThresholds;
  }
  const { overrides: valid } = validateOverrides(overrides);
  for (const [key, value] of Object.entries(valid)) {
    resolved[key] = value;
  }
  // One parameter adds rather than replaces. METHOD.md §11 words the word
  // lists as "a workspace may add terms; the canon terms remain", so a
  // workspace that lists three verbs of its own gets those three on top of the
  // canon rather than a catalogue of three. Replacing would let a workspace
  // switch off a canon rule by overriding it with an empty list, which is a
  // change to the practice and not a setting.
  if (valid["quality.wordLists"] !== undefined) {
    const canon = THRESHOLDS["quality.wordLists"].default;
    const added = valid["quality.wordLists"] as Record<
      string,
      readonly string[]
    >;
    const merged: Record<string, readonly string[]> = { ...canon };
    for (const [list, terms] of Object.entries(added)) {
      merged[list] = [...new Set([...(canon[list] ?? []), ...terms])];
    }
    resolved["quality.wordLists"] = merged;
  }
  return resolved as ResolvedThresholds;
}

/** Every parameter in one group, for an admin card that renders them together. */
export function thresholdsInGroup(
  group: ThresholdGroup,
): readonly ThresholdKey[] {
  return THRESHOLD_KEYS.filter((key) => THRESHOLDS[key].group === group);
}
