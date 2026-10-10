import { isLocalDate } from "@openokr/formats";

/**
 * A date as words beside its field (docs/design/guided-inputs.md §4.9,
 * UIUX-PLAN §2 "Dates"): "in 12 days", "today", "3 days ago" while it is
 * within two months, and its month and year beyond that, "Sep 2027".
 *
 * Month and year rather than "Q3 2027" for a far date: a workspace whose year
 * starts in April numbers its quarters differently from the calendar, and a
 * label that named the wrong quarter would mislead more than it helped.
 *
 * Not a client module, so a server page can say a date the same way.
 */
export function relativeDate(
  date: string,
  today: string,
  locale: string,
): string | null {
  if (!isLocalDate(date) || !isLocalDate(today)) {
    return null;
  }
  const utc = (local: string) => {
    const [year, month, day] = local.split("-").map(Number);
    return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1);
  };
  const days = Math.round((utc(date) - utc(today)) / 86_400_000);
  if (Math.abs(days) <= 60) {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
      days,
      "day",
    );
  }
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(utc(date)));
}

/** Today in the browser's own calendar, for a field no page told otherwise. */
export function browserToday(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
