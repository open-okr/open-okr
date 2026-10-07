/**
 * The practice a workspace runs: METHOD.md §12, resolved (P9-T01).
 *
 * `packages/method` owns the registry, the profiles and the resolution. This
 * module owns where they are stored: two columns on `rhythm_settings`, the row
 * that already holds the §11 thresholds, because every policy decision reads
 * both.
 *
 * A missing row resolves to the recommended profile with nothing changed,
 * rather than failing, for the same reason `resolveRhythm` resolves a missing
 * row to the canon: nothing must be configured before the product works.
 */
import type { RhythmSettingsRow } from "@openokr/db";
import {
  differencesFromProfile,
  isProfileKey,
  type PracticeKey,
  type PracticeOverrides,
  type ProfileKey,
  type ResolvedPractice,
  resolvePractice,
  validatePracticeOverrides,
} from "@openokr/method";

export interface WorkspacePractice {
  readonly profile: ProfileKey;
  /** Only what this workspace changed on top of its profile. */
  readonly overrides: PracticeOverrides;
  /** Every setting, resolved: defaults, then the profile, then the changes. */
  readonly practice: ResolvedPractice;
  /** The settings where the changes make it differ from its profile. */
  readonly differsFromProfile: readonly PracticeKey[];
}

/** The practice a stored row describes, or the defaults for no row at all. */
export function practiceFromRow(
  row: Pick<RhythmSettingsRow, "profile" | "practice"> | null | undefined,
): WorkspacePractice {
  const profile: ProfileKey =
    row?.profile && isProfileKey(row.profile) ? row.profile : "recommended";
  // Validated on the way out as well as on the way in: a stored value the
  // registry would now refuse is dropped here, so what this returns as the
  // workspace's changes is exactly what `resolvePractice` applied.
  const overrides = validatePracticeOverrides(row?.practice ?? {}).overrides;
  return {
    profile,
    overrides,
    practice: resolvePractice(profile, overrides),
    differsFromProfile: differencesFromProfile(profile, overrides),
  };
}
