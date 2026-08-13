/**
 * Rhythm settings: the METHOD.md §11 registry, resolved per workspace
 * (TECHNICAL-PLAN §4.3, §4.14, P3-T02).
 *
 * `packages/method` owns the canon and the schemas. This module owns the one
 * awkward join between the canon and the schema TECHNICAL-PLAN §4.3 specifies:
 * three §11 parameters have their own columns on `rhythm_settings`, and the rest
 * live in its sparse `overrides` map.
 *
 * So those three are **refused inside `overrides`**. §11's own rule is that no
 * threshold lives anywhere else, and a value with two homes is a value nobody
 * owns: an admin would set one, a reader would read the other, and neither would
 * be wrong. `resolveRhythm` folds the columns into the resolved set, so every
 * consumer still sees one flat map with every key present.
 *
 * A missing row resolves to the canon rather than failing. Provisioning writes
 * one and a backfill gave every older workspace one, but "every setting has a
 * working default and nothing must be configured before the product works" is a
 * hard rule, and a read that cannot answer without a row would break it.
 */
import type { RhythmSettingsRow } from "@openokr/db";
import {
  type CheckInFrequency,
  type CoachStrictness,
  canonThresholds,
  isTermKey,
  isThresholdKey,
  type ResolvedTerminology,
  type ResolvedThresholds,
  resolveTerminology,
  resolveThresholds,
  TERMINOLOGY,
  type ThresholdKey,
  type ThresholdProblem,
  validateOverrides,
  validateTerminology,
} from "@openokr/method";

/**
 * The three §11 keys TECHNICAL-PLAN §4.3 gives dedicated columns.
 *
 * Kept here rather than in `packages/method`, because which values happen to
 * have a column is a storage fact and the method package knows nothing about
 * storage.
 */
export const COLUMN_BACKED_THRESHOLDS = [
  "cadence.checkInFrequency",
  "cadence.anchorDay",
  "quality.coachStrictness",
] as const satisfies readonly ThresholdKey[];

type ColumnBackedThreshold = (typeof COLUMN_BACKED_THRESHOLDS)[number];

function isColumnBacked(key: string): key is ColumnBackedThreshold {
  return (COLUMN_BACKED_THRESHOLDS as readonly string[]).includes(key);
}

export interface ResolvedRhythm {
  readonly thresholds: ResolvedThresholds;
  readonly terminology: ResolvedTerminology;
}

/** What a caller may change about the rhythm. Every field optional. */
export interface RhythmPatch {
  readonly defaultCheckInFrequency?: CheckInFrequency;
  readonly checkInAnchorDay?: number;
  readonly coachStrictness?: CoachStrictness;
  /** Sparse. Merged over what is stored, so one key can be set at a time. */
  readonly overrides?: Record<string, unknown>;
  readonly labels?: Record<string, unknown>;
}

/**
 * The canon, with this workspace's deviations and its three column-backed
 * parameters applied.
 *
 * The columns win over anything the map happens to hold, so a row written before
 * the refusal below existed still resolves the way its admin screen shows it.
 */
export function resolveRhythm(
  row:
    | Pick<
        RhythmSettingsRow,
        | "defaultCheckInFrequency"
        | "checkInAnchorDay"
        | "coachStrictness"
        | "overrides"
        | "labels"
      >
    | null
    | undefined,
): ResolvedRhythm {
  if (!row) {
    return {
      thresholds: resolveThresholds(),
      terminology: resolveTerminology(),
    };
  }

  const thresholds = resolveThresholds({
    ...row.overrides,
    "cadence.checkInFrequency": row.defaultCheckInFrequency,
    "cadence.anchorDay": row.checkInAnchorDay,
    "quality.coachStrictness": row.coachStrictness,
  });

  return { thresholds, terminology: resolveTerminology(row.labels) };
}

export interface RhythmValidation {
  readonly patch: RhythmPatch;
  readonly problems: readonly ThresholdProblem[];
}

/**
 * Validates a patch before it reaches a write.
 *
 * Reports every problem rather than the first, because the caller is an admin
 * card that should show all of them at once. A column-backed key inside
 * `overrides` is reported by name with what to use instead, rather than being
 * dropped: an admin who wrote it deserves to know it went nowhere.
 */
export function validateRhythmPatch(patch: RhythmPatch): RhythmValidation {
  const problems: ThresholdProblem[] = [];
  const result: {
    defaultCheckInFrequency?: CheckInFrequency;
    checkInAnchorDay?: number;
    coachStrictness?: CoachStrictness;
    overrides?: Record<string, unknown>;
    labels?: Record<string, unknown>;
  } = {};

  if (patch.defaultCheckInFrequency !== undefined) {
    result.defaultCheckInFrequency = patch.defaultCheckInFrequency;
  }
  if (patch.checkInAnchorDay !== undefined) {
    if (
      !Number.isInteger(patch.checkInAnchorDay) ||
      patch.checkInAnchorDay < 1 ||
      patch.checkInAnchorDay > 7
    ) {
      problems.push({
        key: "checkInAnchorDay",
        message: "The anchor day is an ISO weekday, 1 (Monday) to 7 (Sunday).",
      });
    } else {
      result.checkInAnchorDay = patch.checkInAnchorDay;
    }
  }
  if (patch.coachStrictness !== undefined) {
    result.coachStrictness = patch.coachStrictness;
  }

  if (patch.overrides !== undefined) {
    const columnBacked = Object.keys(patch.overrides).filter(isColumnBacked);
    for (const key of columnBacked) {
      problems.push({
        key,
        message: `"${key}" has its own column on rhythm_settings. Set it there rather than in the override map, so it has one home.`,
      });
    }

    // `null` means "return this threshold to the canon", which is how a
    // workspace drops one deviation without touching the rest. It is not a
    // value, so it never reaches the parameter's schema, which would rightly
    // refuse it. It still has to name a real registry key: removing a threshold
    // that does not exist is the same mistake as setting one.
    const removals: Record<string, null> = {};
    const values: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch.overrides)) {
      if (isColumnBacked(key)) {
        continue;
      }
      if (value === null) {
        if (!isThresholdKey(key)) {
          problems.push({
            key,
            message: `"${key}" is not a threshold in the METHOD.md §11 registry, so there is nothing to reset.`,
          });
          continue;
        }
        removals[key] = null;
        continue;
      }
      values[key] = value;
    }

    const validated = validateOverrides(values);
    problems.push(...validated.problems);
    result.overrides = {
      ...dropNonDeviations(validated.overrides as Record<string, unknown>),
      ...removals,
    };
  }

  if (patch.labels !== undefined) {
    const validated = validateTerminology(patch.labels);
    problems.push(
      ...validated.problems.map((problem) => ({
        key: `labels.${problem.key}`,
        message: problem.message,
      })),
    );
    result.labels = dropUnrenamedTerms(
      validated.labels as Record<string, { singular: string; plural: string }>,
    );
  }

  return { patch: result, problems };
}

/**
 * Drops any override whose value equals the canon default.
 *
 * A deviation that matches the canon is not a deviation. Storing one looks
 * harmless and is not: the stored copy would keep winning after the canon
 * itself changed, so a workspace that never chose anything would silently hold
 * yesterday's threshold for ever. The `null` a caller sends to reset a
 * threshold and the canon value it sends by accident therefore mean the same
 * thing, which is the honest reading of both.
 *
 * Found in a browser: the admin card submits every field it renders, so a save
 * with nothing changed wrote the whole canon into the override map.
 */
function dropNonDeviations(
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const deviations: Record<string, unknown> = {};
  const canon = canonThresholds() as Record<string, unknown>;
  for (const [key, value] of Object.entries(overrides)) {
    if (JSON.stringify(value) === JSON.stringify(canon[key])) {
      // Sent as a removal, so a stored deviation the caller has just reverted
      // is cleared rather than left behind.
      deviations[key] = null;
      continue;
    }
    deviations[key] = value;
  }
  return deviations;
}

/** The same rule for terminology: a label equal to the canon term is not a rename. */
function dropUnrenamedTerms(
  labels: Record<string, { singular: string; plural: string }>,
): Record<string, unknown> {
  const renames: Record<string, unknown> = {};
  for (const [term, label] of Object.entries(labels)) {
    if (!isTermKey(term)) {
      continue;
    }
    const canon = TERMINOLOGY[term] as { singular: string; plural: string };
    if (label.singular === canon.singular && label.plural === canon.plural) {
      renames[term] = null;
      continue;
    }
    renames[term] = label;
  }
  return renames;
}

/**
 * Merges a validated override patch over what is stored.
 *
 * Sparse on purpose: an admin card that submits one threshold must not clear
 * every other deviation. Setting a key to `null` removes it, which is how a
 * workspace returns a single threshold to the canon without touching the rest.
 */
export function mergeOverrides(
  stored: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...stored };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete merged[key];
      continue;
    }
    merged[key] = value;
  }
  return merged;
}
