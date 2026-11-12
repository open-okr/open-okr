/**
 * A timestamp an auditor can read without guessing the format.
 *
 * `YYYY-MM-DD HH:mm:ss` in the reader's own time zone, which the column
 * header names. Built from numeric parts rather than a locale's own pattern,
 * because a month name differs between the ICU the server renders with and
 * the one the browser hydrates with, and a timestamp that changes as the page
 * wakes up is one nobody trusts.
 */
export function stamper(timeZone: string): {
  readonly zone: string;
  readonly stamp: (iso: string) => string;
} {
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  };
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-GB", { ...options, timeZone });
  } catch {
    // A zone this runtime does not know. UTC is at least a zone the header
    // can name truthfully.
    format = new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" });
  }
  return {
    zone: format.resolvedOptions().timeZone,
    stamp: (iso) => {
      const part = Object.fromEntries(
        format.formatToParts(new Date(iso)).map((one) => [one.type, one.value]),
      );
      return `${part.year}-${part.month}-${part.day} ${part.hour}:${part.minute}:${part.second}`;
    },
  };
}
