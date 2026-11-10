import { CHECK_IN_FREQUENCIES, type CheckInFrequency } from "@openokr/method";

/**
 * The frequencies the workspace's check-in picker offers (plan 0.7.0, M4).
 *
 * METHOD.md §7.1 and §11 name daily, weekly, every two weeks and monthly.
 * Quarterly stays in `CHECK_IN_FREQUENCIES` because a stored value must keep
 * reading, but no goal checks in at it (P9-T19a-d-a), so it is not offered.
 * A workspace that already chose it still sees it selected: a picker that
 * dropped the stored value would change it on the next save without anybody
 * choosing to.
 */
export function checkInFrequencyOptions(
  current: string,
): readonly CheckInFrequency[] {
  return CHECK_IN_FREQUENCIES.filter(
    (option) => option !== "quarterly" || current === "quarterly",
  );
}
