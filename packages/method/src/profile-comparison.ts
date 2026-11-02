/**
 * The five profiles side by side (METHOD.md §12.3).
 *
 * One function decides which rows the comparison has and how every cell reads.
 * The practice screen's comparison and `pnpm method:check` both call it, so
 * the screen, the document and what choosing a profile does cannot drift
 * apart: §12.2 once listed four "differences" that were the defaults already,
 * and nothing could notice, because the check compared the names alone.
 *
 * **A row is anything one profile sets differently from Recommended**, a
 * practice setting or a §11 threshold. A value all five share is not a
 * comparison, and listing every one would bury the rows that differ.
 *
 * Pure. No database, no clock, no network, no framework.
 */
import {
  PRACTICE,
  PRACTICE_KEYS,
  PROFILE_KEYS,
  PROFILES,
  type PracticeKey,
  type PracticeSetting,
  type ProfileKey,
  resolvePractice,
} from "./practice.ts";
import {
  ALIGNMENT_CHECKS,
  CYCLE_CHECKS,
  KEY_RESULT_CHECKS,
  OBJECTIVE_CHECKS,
} from "./quality.ts";
import {
  type CheckInFrequency,
  canonThresholds,
  THRESHOLD_KEYS,
  THRESHOLDS,
  type ThresholdKey,
} from "./thresholds.ts";
import { GATE_TITLES } from "./workflow.ts";

export interface ProfileComparisonRow {
  readonly kind: "practice" | "threshold";
  readonly key: PracticeKey | ThresholdKey;
  /** The row as a person reads it, the same on the screen and in METHOD.md. */
  readonly name: string;
  /** What each profile gives a fresh workspace, in words, in profile order. */
  readonly values: Readonly<Record<ProfileKey, string>>;
  /** The profiles whose value is not Recommended's. Never empty. */
  readonly differs: readonly ProfileKey[];
}

const CHECK_TITLES: ReadonlyMap<string, string> = new Map(
  [
    ...OBJECTIVE_CHECKS,
    ...KEY_RESULT_CHECKS,
    ...ALIGNMENT_CHECKS,
    ...CYCLE_CHECKS,
  ].map((check) => [check.id, check.title]),
);

/**
 * A setting's name as a person reads it, with its item where it has one: a
 * check by its id and title, a gate by its number and what it asks for.
 */
export function practiceSettingName(key: PracticeKey): string {
  const setting: PracticeSetting = PRACTICE[key];
  if (setting.item === undefined) {
    return setting.label;
  }
  const checkTitle = CHECK_TITLES.get(setting.item);
  if (setting.group === "checks" && checkTitle) {
    return `${setting.item} ${checkTitle}`;
  }
  if (setting.group === "gates") {
    const title = GATE_TITLES[Number(setting.item.replace(/\D/g, "")) - 1];
    return title ? `${setting.item}: ${title}` : setting.item;
  }
  return `${setting.label}: ${setting.item}`;
}

/** As §11 words the rhythm, rather than as it is stored. */
const FREQUENCY_WORDS: Readonly<Record<CheckInFrequency, string>> = {
  daily: "Daily",
  weekly: "Weekly",
  biweekly: "Every two weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
};

/** A threshold's value in words: a number, a range, or a rhythm. */
function thresholdWords(value: unknown): string {
  if (typeof value === "string") {
    return FREQUENCY_WORDS[value as CheckInFrequency] ?? value;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("low" in record && "high" in record) {
      return `${thresholdWords(record.low)} to ${thresholdWords(record.high)}`;
    }
    return Object.entries(record)
      .map(([part, inner]) => `${part} ${thresholdWords(inner)}`)
      .join(", ");
  }
  return String(value);
}

/** One row from five values, marking those that are not Recommended's. */
function rowOf(
  kind: ProfileComparisonRow["kind"],
  key: PracticeKey | ThresholdKey,
  name: string,
  values: Record<ProfileKey, string>,
): ProfileComparisonRow | null {
  const differs = PROFILE_KEYS.filter(
    (profile) => values[profile] !== values.recommended,
  );
  return differs.length === 0 ? null : { kind, key, name, values, differs };
}

/**
 * Every practice setting, then every threshold, that some profile sets
 * differently from Recommended, each in its registry's order.
 *
 * The values are what each profile gives a workspace that has changed nothing
 * itself, which is the comparison somebody choosing a profile needs. A
 * workspace's own changes stay on top of whichever profile it chooses.
 */
export function compareProfiles(): readonly ProfileComparisonRow[] {
  const resolved = Object.fromEntries(
    PROFILE_KEYS.map((profile) => [profile, resolvePractice(profile)]),
  ) as Record<ProfileKey, ReturnType<typeof resolvePractice>>;
  const canon = canonThresholds() as Record<string, unknown>;
  const thresholdOf = (profile: ProfileKey, key: ThresholdKey): unknown => {
    const sets = PROFILES[profile].thresholds as Record<string, unknown>;
    return key in sets ? sets[key] : canon[key];
  };

  const rows: (ProfileComparisonRow | null)[] = [
    ...PRACTICE_KEYS.map((key) => {
      const options = PRACTICE[key].optionLabels as Record<string, string>;
      return rowOf(
        "practice",
        key,
        practiceSettingName(key),
        Object.fromEntries(
          PROFILE_KEYS.map((profile) => {
            const value = resolved[profile][key];
            return [profile, options[value] ?? value];
          }),
        ) as Record<ProfileKey, string>,
      );
    }),
    ...THRESHOLD_KEYS.map((key) =>
      rowOf(
        "threshold",
        key,
        THRESHOLDS[key].label,
        Object.fromEntries(
          PROFILE_KEYS.map((profile) => [
            profile,
            thresholdWords(thresholdOf(profile, key)),
          ]),
        ) as Record<ProfileKey, string>,
      ),
    ),
  ];
  return rows.filter((entry): entry is ProfileComparisonRow => entry !== null);
}
