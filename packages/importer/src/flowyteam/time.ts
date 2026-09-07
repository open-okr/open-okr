/**
 * A source timestamp into an instant (P6-T04b).
 *
 * The connection reads dates as text (`dateStrings: true`), which is right: a
 * `DATE` column read as a JavaScript Date is read in this process's timezone,
 * and a quarter starting on the first would import as starting on the last day
 * of the month before. It leaves a second problem behind for `datetime` and
 * `timestamp` columns, though.
 *
 * `"2026-02-01 09:00:00"` has no zone in it, and `new Date` on a string with
 * no zone and a space instead of a `T` reads it as **local** time. FlowyTeam is
 * a Laravel application and stores these columns in UTC, so on a machine seven
 * hours ahead every imported comment, check-in and record was landing seven
 * hours early. Found on this machine, which runs at UTC+7; on a server in UTC
 * the bug is invisible, which is exactly why it is worth a named function
 * rather than a `String()` at each call site.
 *
 * A value that already carries a zone, or a `T`, is left alone: it came from
 * somewhere that already said what it meant.
 */

const NAIVE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d+)?$/;

export function sourceInstant(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (value instanceof Date) {
    // A driver that returned a Date anyway. Nothing to reinterpret: whatever
    // zone it chose is already baked in.
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  const text = String(value).trim();
  if (text === "" || text.startsWith("0000-00-00")) {
    // MySQL's zero date, which means "not set" and parses to nothing useful.
    return undefined;
  }
  const match = NAIVE.exec(text);
  if (!match) {
    // Already zoned, or a shape this does not recognise. Handed on as it is,
    // so the caller's own date check refuses it rather than this guessing.
    return text;
  }
  const [, year, month, day, hour, minute, second, fraction] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${fraction ?? ""}Z`;
}
