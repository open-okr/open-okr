/**
 * The METHOD.md §12 practice settings, as data (P9-T01).
 *
 * §11's thresholds are the numbers the practice fires on. These are the
 * choices: who may write and when, whether phases bind, which kinds of OKR and
 * key result a workspace uses, how hard each check and gate is, and how the
 * close and the rhythm behave. Phase 9 turned the locks METHOD.md used to hard
 * code into these, each with the best-practice default first.
 *
 * Built the same way `thresholds.ts` is, for the same reasons:
 * - **Declared once.** Every setting is here with its §12.1 label, the METHOD.md
 *   section that defines the behaviour, a source, its options and its default.
 *   A setting that is not here does not exist, and the conformance suite
 *   compares §12.1 with this table in both directions.
 * - **Sparse storage.** A workspace stores only what it changed, in
 *   `rhythm_settings.practice`, beside the profile it chose in
 *   `rhythm_settings.profile`. `resolvePractice` lays the defaults, the chosen
 *   profile and the workspace's changes on top of each other, in that order, so
 *   switching profile keeps the workspace's changes and switching back finds
 *   them where they were.
 * - **A bad value never poisons a read.** An unknown key or a value that no
 *   longer parses is dropped at resolution, and refused with a reason at the
 *   write boundary by `validatePracticeOverrides`.
 *
 * **Every value is a word, never a number.** A number the practice judges by is
 * a §11 threshold, even when a profile sets it, so profiles carry those
 * separately (`ProfileDefinition.thresholds`).
 *
 * Pure. No database, no clock, no network, no framework.
 */
import { z } from "zod";
import type { ThresholdOverrides } from "./thresholds.ts";

/** Which part of the practice a setting belongs to. Drives the admin cards. */
export type PracticeGroup =
  | "writing"
  | "model"
  | "checks"
  | "gates"
  | "levels"
  | "scoring"
  | "rhythm"
  | "review"
  | "kpi";

export interface PracticeSetting<T extends string = string> {
  /** What §12.1's own table calls the row, so the two read side by side. */
  readonly label: string;
  /**
   * For a row that is one setting per item (each check, each gate, each
   * level, each key result kind), which item this is.
   */
  readonly item?: string;
  readonly group: PracticeGroup;
  /** The METHOD.md section that defines the behaviour. */
  readonly section: string;
  /** Who the default comes from, as §12.1's source column says. */
  readonly source: string;
  readonly options: readonly T[];
  readonly default: T;
}

/** Declares one setting, keeping its option type. */
const setting = <const T extends string>(
  entry: PracticeSetting<T>,
): PracticeSetting<T> => entry;

/** The two words most settings are, in the order §12.1 lists the default. */
const ON_OFF = ["on", "off"] as const;
const OFF_ON = ["off", "on"] as const;

/**
 * Each check's options. `asMethod` is the level METHOD.md §4 gives the check,
 * which for some checks is more than one level (KR-3 blocks on a missing
 * target and warns on a missing baseline), so it is a value of its own rather
 * than a copy of one of the other three.
 */
export const CHECK_ENFORCEMENT = ["asMethod", "block", "warn", "off"] as const;
export type CheckEnforcement = (typeof CHECK_ENFORCEMENT)[number];

export const GATE_ENFORCEMENT = ["block", "warn", "off"] as const;
export type GateEnforcement = (typeof GATE_ENFORCEMENT)[number];

/**
 * Every check id, in the order METHOD.md §4 lists them.
 *
 * Written out rather than read from the quality catalogue, so each check's
 * setting is a key the type system knows. The practice test holds the two
 * lists equal, so a check added to one and not the other fails the build.
 */
export const PRACTICE_CHECK_IDS = [
  "OBJ-1",
  "OBJ-2",
  "OBJ-3",
  "OBJ-4",
  "OBJ-5",
  "KR-1",
  "KR-2",
  "KR-3",
  "KR-4",
  "KR-5",
  "KR-6",
  "KR-7",
  "AL-1",
  "AL-2",
  "AL-3",
  "AL-4",
  "AL-5",
  "AL-6",
  "CY-1",
  "CY-2",
  "CY-3",
  "CY-4",
  "CY-5",
  "CY-6",
  "CY-7",
  "CY-8",
] as const;
export type PracticeCheckId = (typeof PRACTICE_CHECK_IDS)[number];

const checkSettings = Object.fromEntries(
  PRACTICE_CHECK_IDS.map((id) => [
    `checks.${id}`,
    setting({
      label: "Check enforcement",
      item: id,
      group: "checks",
      section: "§4",
      source: "§4",
      options: CHECK_ENFORCEMENT,
      default: "asMethod",
    }),
  ]),
) as Record<`checks.${PracticeCheckId}`, PracticeSetting<CheckEnforcement>>;

export const GATE_NUMBERS = [1, 2, 3, 4, 5, 6] as const;
export type GateNumber = (typeof GATE_NUMBERS)[number];

/** §4.5's defaults: the two structural gates block, three warn, one is off. */
const GATE_DEFAULTS: Readonly<Record<GateNumber, GateEnforcement>> = {
  1: "block",
  2: "block",
  3: "warn",
  4: "warn",
  5: "warn",
  6: "off",
};

const gateSettings = Object.fromEntries(
  GATE_NUMBERS.map((gate) => [
    `gates.${gate}`,
    setting({
      label: "Publish gate enforcement",
      item: `Gate ${gate}`,
      group: "gates",
      section: "§4.5",
      source: "§4.5",
      options: GATE_ENFORCEMENT,
      default: GATE_DEFAULTS[gate],
    }),
  ]),
) as Record<`gates.${GateNumber}`, PracticeSetting<GateEnforcement>>;

export const OKR_LEVELS = [
  "company",
  "department",
  "team",
  "individual",
] as const;
export type OkrLevel = (typeof OKR_LEVELS)[number];

const levelSettings = Object.fromEntries(
  OKR_LEVELS.map((level) => [
    `levels.${level}`,
    setting({
      label: "Levels in use",
      item: level,
      group: "levels",
      section: "§2.7",
      source: "Castro; Cagan",
      // Individual OKRs are off by default: "not for everyone and should never
      // be required" (§2.7).
      options: level === "individual" ? OFF_ON : ON_OFF,
      default: level === "individual" ? "off" : "on",
    }),
  ]),
) as Record<`levels.${OkrLevel}`, PracticeSetting<"on" | "off">>;

export const KEY_RESULT_KINDS = [
  "metric",
  "maintain",
  "milestone",
  "baseline",
] as const;
export type KeyResultKind = (typeof KEY_RESULT_KINDS)[number];

const keyResultKindSettings = Object.fromEntries(
  KEY_RESULT_KINDS.map((kind) => [
    `keyResultKinds.${kind}`,
    setting({
      label: "Key result kinds",
      item: kind,
      group: "model",
      section: "§2.10",
      source: "Lamorte; re:Work",
      options: ON_OFF,
      default: "on",
    }),
  ]),
) as Record<`keyResultKinds.${KeyResultKind}`, PracticeSetting<"on" | "off">>;

/**
 * Every practice setting, keyed by a stable dotted key.
 *
 * The key is what a workspace's stored choices and an audit row name, so it
 * never changes once shipped. Renaming one is a data change, not an edit.
 */
export const PRACTICE = {
  // --- Writing and changing ----------------------------------------------
  "writing.when": setting({
    label: "Who may write OKRs, and when",
    group: "writing",
    section: "§2.9",
    source: "Doerr; Akmal, 1 October 2026",
    options: ["anytime", "planningWindow", "afterPhases"],
    default: "anytime",
  }),
  "phases.enforcement": setting({
    label: "Phase enforcement",
    group: "writing",
    section: "§2.3",
    source: "No source requires phases before drafting",
    options: ["guided", "binding", "hidden"],
    default: "guided",
  }),
  "writing.midCycleAs": setting({
    label: "New objectives mid-cycle start as",
    group: "writing",
    section: "§2.9",
    source: "whatmatters",
    options: ["live", "ownerDraft", "reviewerApproval"],
    default: "live",
  }),
  "reasons.midCycleAddition": setting({
    label: "Reason when adding mid-cycle",
    group: "writing",
    section: "§2.9",
    source: "OpenOKR default",
    options: ["off", "optional", "required"],
    default: "optional",
  }),
  "reasons.easingTarget": setting({
    label: "Reason when easing a target",
    group: "writing",
    section: "§2.9",
    source: "whatmatters",
    options: ["required", "optional"],
    default: "required",
  }),

  // --- The model ---------------------------------------------------------
  "okr.kinds": setting({
    label: "OKR kinds",
    group: "model",
    section: "§2.8",
    source: "Google's OKR playbook",
    options: ["both", "aspirationalOnly", "committedOnly"],
    default: "both",
  }),
  ...keyResultKindSettings,
  reviewer: setting({
    label: "Reviewer per goal",
    group: "model",
    section: "§2.5",
    source: "OpenOKR default",
    options: ["off", "optional", "required"],
    default: "optional",
  }),

  // --- Checks and gates --------------------------------------------------
  ...checkSettings,
  strictMode: setting({
    label: "Strict mode",
    group: "checks",
    section: "§4",
    source: "OpenOKR default",
    options: OFF_ON,
    default: "off",
  }),
  ...gateSettings,
  "gates.override": setting({
    label: "Gate override",
    group: "gates",
    section: "§4.5",
    source: "REQUIREMENTS §3.2",
    options: ON_OFF,
    default: "on",
  }),

  // --- Levels ------------------------------------------------------------
  ...levelSettings,

  // --- Progress, confidence and scoring ----------------------------------
  "progress.rollUp": setting({
    label: "Progress roll-up from aligned goals",
    group: "scoring",
    section: "§3.1",
    source: "Perdoo (vendor)",
    options: OFF_ON,
    default: "off",
  }),
  "confidence.display": setting({
    label: "Confidence shown as",
    group: "scoring",
    section: "§3.2",
    source: "Wodtke",
    options: ["xIn10", "decimal", "percent"],
    default: "xIn10",
  }),
  "scoring.enabled": setting({
    label: "Scoring",
    group: "scoring",
    section: "§3.3",
    source: "Lamorte; Castro",
    options: ON_OFF,
    default: "on",
  }),
  "scoring.adjustment": setting({
    label: "Score adjustment at close",
    group: "scoring",
    section: "§3.3",
    source: "Doerr",
    options: ["withReason", "notAllowed"],
    default: "withReason",
  }),
  "scoring.colours": setting({
    label: "Score colours",
    group: "scoring",
    section: "§3.3",
    source: "re:Work; whatmatters",
    options: ["google", "doerr"],
    default: "google",
  }),
  "progress.signal": setting({
    label: "Progress signal",
    group: "scoring",
    section: "§3.7",
    source: "Microsoft Viva Goals (vendor)",
    options: ["paceAware", "absolute"],
    default: "paceAware",
  }),

  // --- The rhythm --------------------------------------------------------
  "escalation.criticalConfidence": setting({
    label: "Critical confidence escalation",
    group: "rhythm",
    section: "§3.2",
    source: "OpenOKR default",
    options: OFF_ON,
    default: "off",
  }),
  "escalation.sponsorInLadders": setting({
    label: "Sponsor in escalation ladders",
    group: "rhythm",
    section: "§7.3",
    source: "OpenOKR default",
    options: OFF_ON,
    default: "off",
  }),

  // --- The review and the close ------------------------------------------
  "review.format": setting({
    label: "Quarterly review format",
    group: "review",
    section: "§8",
    source: "Workpath (vendor)",
    options: ["oneSession", "split"],
    default: "oneSession",
  }),
  "review.rootCauses": setting({
    label: "Root causes at the review",
    group: "review",
    section: "§8.4",
    source: "OpenOKR default",
    options: ["asMethod", "optional"],
    default: "asMethod",
  }),
  "close.carryForward": setting({
    label: "Carry forward unfinished aspirational objectives",
    group: "review",
    section: "§8.8",
    source: "Google's OKR playbook",
    options: ["proposed", "notProposed"],
    default: "proposed",
  }),

  // --- KPIs --------------------------------------------------------------
  "kpi.unhealthyResponse": setting({
    label: "Unhealthy KPI response",
    group: "kpi",
    section: "§6.5",
    source: "Wodtke",
    options: ["offer", "draftRecovery"],
    default: "offer",
  }),
} as const;

export type PracticeKey = keyof typeof PRACTICE;

/** The value type of one setting, read from its declared options. */
export type PracticeValue<K extends PracticeKey> =
  (typeof PRACTICE)[K] extends PracticeSetting<infer T> ? T : never;

/** Every setting, resolved. What a policy or an engine takes as an argument. */
export type ResolvedPractice = {
  readonly [K in PracticeKey]: PracticeValue<K>;
};

/** A workspace's or a profile's changes. Sparse: an absent key reads below it. */
export type PracticeOverrides = {
  readonly [K in PracticeKey]?: PracticeValue<K>;
};

export const PRACTICE_KEYS = Object.keys(PRACTICE) as PracticeKey[];

export function isPracticeKey(key: string): key is PracticeKey {
  return Object.hasOwn(PRACTICE, key);
}

/** Every default, with nothing changed. */
export function defaultPractice(): ResolvedPractice {
  const resolved: Record<string, string> = {};
  for (const key of PRACTICE_KEYS) {
    resolved[key] = PRACTICE[key].default;
  }
  return resolved as ResolvedPractice;
}

/** Every setting in one group, for the admin card that renders them together. */
export function practiceInGroup(group: PracticeGroup): readonly PracticeKey[] {
  return PRACTICE_KEYS.filter((key) => PRACTICE[key].group === group);
}

// --- Profiles ---------------------------------------------------------------

export const PROFILE_KEYS = [
  "recommended",
  "googleStyle",
  "radicalFocus",
  "lightweight",
  "governed",
] as const;
export type ProfileKey = (typeof PROFILE_KEYS)[number];

export interface ProfileDefinition {
  /** What §12.2's own table calls it. */
  readonly label: string;
  /** Who it is for, in §12.2's words. */
  readonly for: string;
  /** The practice settings it sets differently from Recommended. */
  readonly practice: PracticeOverrides;
  /**
   * The §11 thresholds it sets differently from the canon.
   *
   * Declared here so a profile is one record, and applied from P9-T05, which
   * is when choosing a profile on the settings screen first changes what a
   * workspace practises. `cadence.checkInFrequency` has its own column on
   * `rhythm_settings`, so applying it is a write to that column rather than a
   * layer at read time, and P9-T05 decides that write with its screen.
   */
  readonly thresholds: ThresholdOverrides;
}

/** §12.2. Each profile sets only what differs from Recommended. */
export const PROFILES: Readonly<Record<ProfileKey, ProfileDefinition>> = {
  recommended: {
    label: "Recommended",
    for: "Most organisations",
    practice: {},
    thresholds: {},
  },
  googleStyle: {
    label: "Google-style",
    for: "Organisations following Google's playbook closely",
    practice: {
      "levels.individual": "on",
      "levels.department": "off",
      reviewer: "off",
      // Google's score colours are the default already, so nothing is set
      // for them here.
    },
    thresholds: {},
  },
  radicalFocus: {
    label: "Radical Focus",
    for: "Small companies and teams starting out, following Wodtke",
    practice: {
      // Confidence as x in 10 and weekly wins are the defaults already.
      "phases.enforcement": "hidden",
    },
    thresholds: {
      "quality.objectivesPerUnitCap": 1,
      "quality.keyResultsPerObjective": { low: 2, high: 3 },
    },
  },
  lightweight: {
    label: "Lightweight",
    for: "Teams that want to track OKRs without the planning workflow",
    practice: {
      "phases.enforcement": "hidden",
      reviewer: "off",
      "gates.3": "off",
      "gates.4": "off",
      "gates.5": "off",
      "review.rootCauses": "optional",
    },
    thresholds: { "cadence.checkInFrequency": "biweekly" },
  },
  governed: {
    label: "Governed",
    for: "Organisations that run a formal planning process",
    practice: {
      "phases.enforcement": "binding",
      "writing.when": "planningWindow",
      "writing.midCycleAs": "reviewerApproval",
      reviewer: "required",
      "gates.3": "block",
      "gates.4": "block",
      "gates.5": "block",
      "checks.AL-3": "warn",
      "escalation.sponsorInLadders": "on",
    },
    thresholds: {},
  },
};

export function isProfileKey(key: string): key is ProfileKey {
  return (PROFILE_KEYS as readonly string[]).includes(key);
}

// --- Validation and resolution ----------------------------------------------

export interface PracticeProblem {
  readonly key: string;
  readonly message: string;
}

export interface PracticeValidation {
  /** Only the keys that parsed, so a caller can store a partial correction. */
  readonly overrides: PracticeOverrides;
  readonly problems: readonly PracticeProblem[];
}

const schemaFor = (key: PracticeKey): z.ZodType<string> =>
  z.enum(PRACTICE[key].options as readonly [string, ...string[]]);

/**
 * Validates a stored or submitted set of changes against the registry.
 *
 * Reports every problem rather than the first, because the caller is usually an
 * admin screen that should show them all at once. An unknown key is a problem in
 * its own right: a setting that is not in the registry does not exist, and
 * ignoring it would let a workspace believe it had chosen something it had not.
 */
export function validatePracticeOverrides(input: unknown): PracticeValidation {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return {
      overrides: {},
      problems: [
        {
          key: "",
          message: "Practice settings must be an object keyed by setting.",
        },
      ],
    };
  }

  const problems: PracticeProblem[] = [];
  const overrides: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!isPracticeKey(key)) {
      problems.push({
        key,
        message: `"${key}" is not a practice setting in METHOD.md §12.`,
      });
      continue;
    }
    const parsed = schemaFor(key).safeParse(value);
    if (!parsed.success) {
      problems.push({
        key,
        message: `"${String(value)}" is not an option for ${describe(key)}. Choose one of: ${PRACTICE[key].options.join(", ")}.`,
      });
      continue;
    }
    overrides[key] = parsed.data;
  }
  return { overrides: overrides as PracticeOverrides, problems };
}

/** A setting's name as a person reads it: its row, and its item when it has one. */
export function describe(key: PracticeKey): string {
  const entry: PracticeSetting = PRACTICE[key];
  return entry.item ? `${entry.label} (${entry.item})` : entry.label;
}

/**
 * The practice a workspace is running: the defaults, then its profile, then
 * its own changes.
 *
 * Invalid and unknown keys are dropped rather than allowed to poison a read. A
 * write is validated at the boundary, so a stored value that fails here means
 * the registry tightened after it was written, which is exactly when falling
 * back is right. An unknown profile reads as Recommended for the same reason.
 */
export function resolvePractice(
  profile: string | null | undefined,
  overrides?: unknown,
): ResolvedPractice {
  const resolved = defaultPractice() as Record<string, string>;
  const chosen =
    profile && isProfileKey(profile) ? PROFILES[profile] : PROFILES.recommended;
  Object.assign(resolved, chosen.practice);
  if (overrides !== undefined && overrides !== null) {
    Object.assign(resolved, validatePracticeOverrides(overrides).overrides);
  }
  return resolved as ResolvedPractice;
}

/**
 * The keys where a workspace's own changes differ from its profile.
 *
 * What the settings screen marks as "differs from profile", and what choosing a
 * profile reports, because a workspace's changes are kept when it switches.
 */
export function differencesFromProfile(
  profile: string | null | undefined,
  overrides?: unknown,
): readonly PracticeKey[] {
  const base = resolvePractice(profile);
  const actual = resolvePractice(profile, overrides);
  return PRACTICE_KEYS.filter((key) => base[key] !== actual[key]);
}
