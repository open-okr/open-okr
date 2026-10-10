/**
 * A wall-clock time, `HH:MM`: a time on somebody's clock, not an instant
 * (docs/design/guided-inputs.md §4.9).
 *
 * One rule where there were three, and one of them took `99:99`. An hour of
 * one digit is accepted, because "9:30" is how people write it, and stored
 * with two, so every reader compares the same shape.
 */
export const WALL_CLOCK_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** The hour and minute of a wall-clock time, or null when it is not one. */
export function parseWallClock(
  text: string,
): { readonly hour: number; readonly minute: number } | null {
  const match = WALL_CLOCK_PATTERN.exec(text.trim());
  if (!match) {
    return null;
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/** Whether `text` is a wall-clock time. */
export function isWallClock(text: string): boolean {
  return parseWallClock(text) !== null;
}

/** `9:30` as `09:30`, or null when it is not a time. */
export function normaliseWallClock(text: string): string | null {
  const parsed = parseWallClock(text);
  if (!parsed) {
    return null;
  }
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(parsed.hour)}:${two(parsed.minute)}`;
}
