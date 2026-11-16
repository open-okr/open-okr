/**
 * What a rhythm save hands back (P6-G20).
 *
 * Its own module because `rhythm-actions.ts` is a `"use server"` file and
 * those may export only async functions.
 */
export interface RhythmState {
  /** The refusal, as `rhythm.update` worded it. */
  readonly error: string | null;
  /** What changed, for the line that confirms it. Empty before a save. */
  readonly saved: string | null;
}

export const NOTHING_SAVED: RhythmState = { error: null, saved: null };

/**
 * One field's value on the page: a number (or null for blank), the text of a
 * dropdown or a rename, or a word list.
 */
export type FieldValue = number | string | readonly string[] | null;

/** Whether two field values are the same one. Word lists compare by content. */
function sameValue(left: FieldValue, right: FieldValue): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((word, index) => word === right[index])
    );
  }
  return left === right;
}

/**
 * The names of the fields whose value is not what the workspace has stored.
 *
 * The page keeps every field's value by the name the save reads it under, so
 * what is unsaved is a comparison of two maps. A field the stored map does not
 * know is a change only when it holds something, so a field drawn after the
 * page loaded does not count as unsaved while it is blank.
 */
export function changedFields(
  stored: Readonly<Record<string, FieldValue>>,
  now: Readonly<Record<string, FieldValue>>,
): string[] {
  return Object.keys(now).filter((name) => {
    const value = now[name] as FieldValue;
    const before = stored[name];
    if (before === undefined) {
      return !(
        value === null ||
        value === "" ||
        (Array.isArray(value) && value.length === 0)
      );
    }
    return !sameValue(before, value);
  });
}
