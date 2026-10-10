/**
 * Wall-clock times in a zone, as instants (docs/design/guided-inputs.md
 * §4.9).
 *
 * "The 31st" in the workspace is a different stretch of time in Jakarta and
 * in London, so a date a person picks becomes an instant only once a zone is
 * named. Moved here from the cadence engine so a form's server action and the
 * engine read a day the same way.
 */

/** How far ahead of UTC a zone is at an instant, in milliseconds. */
export function zoneOffsetAt(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const read = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value);
  // `en-CA` renders midnight as 24 in some runtimes.
  const hour = read("hour") % 24;
  const asUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    hour,
    read("minute"),
    read("second"),
    instant % 1000,
  );
  return asUtc - instant;
}

/**
 * The instant a wall-clock reading on a `YYYY-MM-DD` date names in a zone.
 *
 * Two passes, because the offset belongs to the date and changes twice a year
 * in most zones: one correction is enough for every real zone, and the second
 * settles the case where the first lands on the other side of a transition.
 */
export function zonedInstant(
  on: string,
  timeZone: string,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
): Date {
  const [year, month, day] = on.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const naive = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second,
    millisecond,
  );
  let instant = naive - zoneOffsetAt(naive, timeZone);
  instant = naive - zoneOffsetAt(instant, timeZone);
  return new Date(instant);
}

/**
 * The first and last instant of a local day in a zone.
 *
 * The end is `23:59:59.999` rather than the next midnight, so a range "to the
 * 31st" holds the whole of the 31st and a bound compared inclusively never
 * takes a row from the 1st.
 */
export function localDayBounds(
  on: string,
  timeZone: string,
): { readonly start: Date; readonly end: Date } {
  return {
    start: zonedInstant(on, timeZone),
    end: zonedInstant(on, timeZone, 23, 59, 59, 999),
  };
}

/**
 * The instant a `YYYY-MM-DDTHH:MM` reading on a zone's clock names: what a
 * `datetime-local` control posts, which carries no zone of its own. Null when
 * the text is not one, so a caller holding an instant with an offset can
 * read it as it is.
 */
export function localDateTimeInstant(
  value: string,
  timeZone: string,
): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    value.trim(),
  );
  if (!match) {
    return null;
  }
  const [, on, hour, minute, second] = match as unknown as [
    string,
    string,
    string,
    string,
    string | undefined,
  ];
  return zonedInstant(
    on,
    timeZone,
    Number(hour),
    Number(minute),
    Number(second ?? 0),
  );
}
