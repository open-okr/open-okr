/**
 * Text into values, with the refusal phrased for the person who typed it
 * (P6-T01a).
 *
 * Every function here throws a sentence rather than returning a flag, and the
 * runner turns the sentence into a row error against a line number. That is the
 * per-row error report §7.1 step 7 asks for: "row 14: target has to be a
 * number, and it says 'about 40%'".
 *
 * **A value the template cannot read is a row error and never a refused file.**
 * A thousand-row spreadsheet with two bad cells imports nine hundred and
 * ninety-eight rows and names the two, because the alternative is somebody
 * editing a file in the dark, running it again, and finding the next one.
 */

const TRUE_WORDS = new Set(["true", "yes", "y", "1"]);
const FALSE_WORDS = new Set(["false", "no", "n", "0"]);

export function asText(field: string, raw: string, max = 500): string {
  const value = raw.trim();
  if (value.length > max) {
    throw new Error(
      `${field} is longer than ${max} characters, so it was not imported rather than truncated.`,
    );
  }
  return value;
}

export function asNumber(field: string, raw: string): number {
  const cleaned = raw.trim().replace(/,/g, "").replace(/%$/, "");
  if (cleaned === "") {
    throw new Error(`${field} has to be a number, and it is empty.`);
  }
  const value = Number(cleaned);
  if (!Number.isFinite(value)) {
    throw new Error(
      `${field} has to be a number, and it says "${raw.trim()}".`,
    );
  }
  return value;
}

/**
 * A day, as `YYYY-MM-DD`.
 *
 * Three spellings are accepted because all three turn up in exported files:
 * the ISO day, `DD/MM/YYYY` and `MM/DD/YYYY`. The last two are the same
 * characters in a different order, so a slash-separated date is only read when
 * one of the two numbers is above twelve and settles it. `03/04/2026` is
 * refused by name rather than guessed at, which is the one case where guessing
 * would silently move a deadline by a month.
 */
export function asDay(field: string, raw: string): string {
  const value = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) {
    assertRealDay(field, value);
    return value;
  }
  const slashed = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(value);
  if (slashed) {
    const first = Number(slashed[1]);
    const second = Number(slashed[2]);
    const year = slashed[3] as string;
    if (first > 12 && second <= 12) {
      const day = `${year}-${pad(second)}-${pad(first)}`;
      assertRealDay(field, day);
      return day;
    }
    if (second > 12 && first <= 12) {
      const day = `${year}-${pad(first)}-${pad(second)}`;
      assertRealDay(field, day);
      return day;
    }
    throw new Error(
      `${field} says "${value}", and there is no way to tell the day from the month. Write it as YYYY-MM-DD.`,
    );
  }
  throw new Error(
    `${field} has to be a date written as YYYY-MM-DD, and it says "${value}".`,
  );
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function assertRealDay(field: string, day: string): void {
  const [year, month, date] = day.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const parsed = new Date(Date.UTC(year, month - 1, date));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== date
  ) {
    throw new Error(`${field} says "${day}", which is not a real date.`);
  }
}

/**
 * One of a fixed set, matched loosely enough to survive a spreadsheet.
 *
 * "In Progress", "in progress" and "in_progress" are the same status, and a
 * column somebody typed by hand will hold all three. Anything else is refused
 * with the whole list, because a person fixing a cell needs to know what it may
 * say.
 */
export function asEnum<T extends string>(
  field: string,
  raw: string,
  allowed: readonly T[],
): T {
  const wanted = normalise(raw);
  const found = allowed.find((option) => normalise(option) === wanted);
  if (!found) {
    throw new Error(
      `${field} says "${raw.trim()}". It has to be one of: ${allowed.join(", ")}.`,
    );
  }
  return found;
}

export function asBoolean(field: string, raw: string): boolean {
  const wanted = raw.trim().toLowerCase();
  if (TRUE_WORDS.has(wanted)) {
    return true;
  }
  if (FALSE_WORDS.has(wanted)) {
    return false;
  }
  throw new Error(
    `${field} says "${raw.trim()}". Write yes or no, true or false.`,
  );
}

/** Case, spaces and punctuation folded away, so one alias covers many spellings. */
export function normalise(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s_\-.]+/g, "");
}
