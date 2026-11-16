/**
 * What a practice card's save, reset or profile switch reports back.
 *
 * Its own module rather than inside `practice-actions.ts`, because a
 * `"use server"` file may export only async functions.
 */
export interface PracticeState {
  readonly error: string | null;
  readonly saved: string | null;
}

export const NOTHING_SAVED: PracticeState = { error: null, saved: null };

/** The parts of `practice.read` that deciding what a save changes needs. */
export interface PracticeSnapshot {
  readonly profile: string;
  readonly practice: Readonly<Record<string, string>>;
  readonly overrides: Readonly<Record<string, string>>;
  readonly profiles: readonly {
    readonly key: string;
    readonly practice: Readonly<Record<string, string>>;
  }[];
  readonly registry: readonly {
    readonly key: string;
    readonly default: string;
  }[];
}

/**
 * What a submitted form changes, as the `overrides` `practice.update` takes.
 *
 * A card submits every select, so only differences go, or the audit trail
 * would record every setting as changed. A value equal to what the workspace
 * runs now is no change. A value equal to the profile's on a key the
 * workspace has overridden is `null`, which clears that override: it is
 * exactly what returning a setting to its profile means. Anything else is
 * written as chosen.
 */
export function diffPractice(
  current: PracticeSnapshot,
  submitted: Iterable<readonly [string, string]>,
): Record<string, string | null> {
  const profile = current.profiles.find(
    (entry) => entry.key === current.profile,
  );
  const defaults = new Map(
    current.registry.map((entry) => [entry.key, entry.default]),
  );
  const changed: Record<string, string | null> = {};
  for (const [key, value] of submitted) {
    if (current.practice[key] === value) {
      continue;
    }
    const profileValue = profile?.practice[key] ?? defaults.get(key);
    changed[key] =
      key in current.overrides && value === profileValue ? null : value;
  }
  return changed;
}
