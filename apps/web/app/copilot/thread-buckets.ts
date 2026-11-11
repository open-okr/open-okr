/**
 * When each conversation was last used, as History groups it (plan 0.8.1
 * CP2, review F19): Today, Yesterday, This week, Earlier.
 *
 * The thread list returned `updatedAt` and the panel showed none of it, so
 * twenty titles read as one undated pile. Days are the reader's own, in
 * their browser's time zone, because "yesterday" is a fact about where they
 * are.
 */

export type ThreadBucket = "today" | "yesterday" | "thisWeek" | "earlier";

/** The order History shows the groups in. */
const THREAD_BUCKETS: readonly ThreadBucket[] = [
  "today",
  "yesterday",
  "thisWeek",
  "earlier",
];

/** Midnight at the start of the local day `at` falls in. */
const startOfDay = (at: Date): number =>
  new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();

const DAY_MS = 24 * 60 * 60 * 1000;

/** Which group a conversation last used at `updatedAt` falls in, seen at `now`. */
export function threadBucket(updatedAt: string, now: Date): ThreadBucket {
  const used = new Date(updatedAt);
  if (Number.isNaN(used.getTime())) {
    return "earlier";
  }
  const today = startOfDay(now);
  const day = startOfDay(used);
  if (day >= today) {
    return "today";
  }
  // A day back, through `Date` rather than by subtracting 24 hours, so a
  // daylight-saving change cannot move a conversation into the wrong group.
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day >= yesterday.getTime()) {
    return "yesterday";
  }
  // The seven days before today, rather than the calendar week, so "this
  // week" means the same on a Monday as on a Friday.
  if (today - day < 7 * DAY_MS) {
    return "thisWeek";
  }
  return "earlier";
}

/** The conversations in History's groups, newest first inside each. */
export function groupThreads<T extends { readonly updatedAt: string }>(
  threads: readonly T[],
  now: Date,
): readonly {
  readonly bucket: ThreadBucket;
  readonly threads: readonly T[];
}[] {
  const sorted = [...threads].sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );
  return THREAD_BUCKETS.map((bucket) => ({
    bucket,
    threads: sorted.filter(
      (thread) => threadBucket(thread.updatedAt, now) === bucket,
    ),
  })).filter((group) => group.threads.length > 0);
}
