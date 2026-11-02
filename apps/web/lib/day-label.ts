/**
 * A calendar day as a reader writes it: "9 Nov 2026", in the reader's locale.
 *
 * The Goals list printed "Next check-in 2026-11-09" beside a due date of
 * "31/12/2026", two formats in one row (Dirk's review). A day is a calendar
 * date, not an instant, so it is read and written in UTC: a reader west of
 * Greenwich must not see the day before.
 *
 * Takes "YYYY-MM-DD" or a full ISO timestamp, whose first ten characters are
 * the day. Anything else comes back as it was given, rather than as
 * "Invalid Date".
 */
export function dayLabel(day: string, locale: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!match) {
    return day;
  }
  const [, year, month, date] = match;
  return new Intl.DateTimeFormat(locale === "ms" ? "ms-MY" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(Number(year), Number(month) - 1, Number(date))));
}
