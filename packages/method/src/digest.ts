/**
 * The weekly digest, as METHOD.md §7.2 Step 4 describes it (P4-T15b-a).
 *
 * §7.2's own sentence: "The product assembles it: headline average and the
 * change on last week, what is on track, what is at risk with owners, blockers
 * on the 24-hour clock, and the commitment count. The coordinator adds a note
 * for leadership."
 *
 * **Pure, and here rather than in a template file, because it is the method
 * speaking.** The digest is what the product says to a team about their own week,
 * so its structure and its wording are canon, the same as a coaching message. A
 * version of these sentences living in `apps/web` would be a second copy of the
 * canon that nothing verifies.
 *
 * **It is also the fallback that makes the assist optional.** The digest assist
 * rewrites these lines as prose. With no provider, these lines *are* the digest,
 * and they are complete: every one of §7.2's six parts is here, in order.
 */

/** One goal that is not on track, with who is accountable for it. */
export interface DigestRisk {
  readonly title: string;
  /** The champion's name, or null when nobody is named yet. */
  readonly ownerName: string | null;
  /** §3.2's own band label, already resolved. */
  readonly status: string;
}

/** One open blocker and how long it has been open, in hours. */
export interface DigestBlocker {
  readonly title: string;
  readonly ownerName: string | null;
  readonly ageHours: number;
}

export interface WeeklyDigestInput {
  readonly spaceName: string;
  /** The week this digest is for, as an ISO date. */
  readonly weekStart: string;
  /** 0 to 1, in §3.2's scale. */
  readonly averageConfidence: number;
  /** Last week's average, or null when this is the first week. */
  readonly previousAverageConfidence: number | null;
  readonly onTrackCount: number;
  readonly atRiskCount: number;
  /** The ones at risk, named. §7.2 asks for owners, so owners are required. */
  readonly risks: readonly DigestRisk[];
  readonly blockers: readonly DigestBlocker[];
  readonly commitmentCount: number;
  /** What the coordinator added for leadership, or null. */
  readonly coordinatorNote: string | null;
}

/**
 * §7.2's 24-hour clock, which is the only threshold this file knows about.
 *
 * It is not a configurable number: §7.2 states it in words as part of the ritual
 * ("blockers on the 24-hour clock"), which is why it is a constant here rather
 * than an entry in the §11 registry. A blocker older than this is the thing the
 * digest is meant to make impossible to miss.
 */
export const BLOCKER_CLOCK_HOURS = 24;

const percent = (value: number): string => `${Math.round(value * 100)}%`;

/** The change on last week, in words, or null when there is no last week. */
const changeOn = (now: number, previous: number | null): string | null => {
  if (previous === null) {
    return null;
  }
  const points = Math.round((now - previous) * 100);
  if (points === 0) {
    return "level with last week";
  }
  return points > 0
    ? `up ${points} points on last week`
    : `down ${Math.abs(points)} points on last week`;
};

const list = (parts: readonly string[]): string =>
  parts.length <= 1
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

/**
 * The digest, as lines.
 *
 * Lines rather than one paragraph, because a digest is read in a channel where
 * the second line is what people scan for. Each line is one of §7.2's parts, in
 * §7.2's order, and a part with nothing to say says so rather than being omitted:
 * "no blockers open" is information and a missing line is not.
 */
export function weeklyDigestLines(input: WeeklyDigestInput): readonly string[] {
  const lines: string[] = [];

  const change = changeOn(
    input.averageConfidence,
    input.previousAverageConfidence,
  );
  lines.push(
    `${input.spaceName}, week of ${input.weekStart}: confidence ${percent(
      input.averageConfidence,
    )}${change === null ? "" : `, ${change}`}.`,
  );

  lines.push(
    input.onTrackCount === 1
      ? "1 objective on track."
      : `${input.onTrackCount} objectives on track.`,
  );

  if (input.atRiskCount === 0) {
    lines.push("Nothing at risk.");
  } else {
    const named = input.risks.map(
      (risk) =>
        `${risk.title} (${risk.ownerName ?? "no owner named"}, ${risk.status.replace(
          "_",
          " ",
        )})`,
    );
    lines.push(
      `${input.atRiskCount} at risk: ${
        named.length === 0 ? "owners not recorded" : list(named)
      }.`,
    );
  }

  if (input.blockers.length === 0) {
    lines.push("No blockers open.");
  } else {
    const named = input.blockers.map((blocker) => {
      const clock =
        blocker.ageHours >= BLOCKER_CLOCK_HOURS
          ? `${blocker.ageHours}h, past the ${BLOCKER_CLOCK_HOURS}-hour clock`
          : `${blocker.ageHours}h`;
      return `${blocker.title} (${blocker.ownerName ?? "no owner named"}, ${clock})`;
    });
    const overdue = input.blockers.filter(
      (blocker) => blocker.ageHours >= BLOCKER_CLOCK_HOURS,
    ).length;
    lines.push(
      `${input.blockers.length} blocker${
        input.blockers.length === 1 ? "" : "s"
      } open${overdue === 0 ? "" : `, ${overdue} past the clock`}: ${list(named)}.`,
    );
  }

  lines.push(
    input.commitmentCount === 1
      ? "1 commitment for next week."
      : `${input.commitmentCount} commitments for next week.`,
  );

  if (input.coordinatorNote !== null && input.coordinatorNote.trim() !== "") {
    lines.push(`For leadership: ${input.coordinatorNote.trim()}`);
  }

  return lines;
}

/**
 * Every number the digest states, so an assist that rewrites it can be checked.
 *
 * The digest assist is allowed to say these and nothing else. Recomputed from
 * the same input rather than parsed back out of the lines, because parsing prose
 * for numbers is how a check quietly stops checking.
 */
export function weeklyDigestNumbers(
  input: WeeklyDigestInput,
): readonly number[] {
  const numbers = [
    Math.round(input.averageConfidence * 100),
    input.onTrackCount,
    input.atRiskCount,
    input.blockers.length,
    input.commitmentCount,
    BLOCKER_CLOCK_HOURS,
  ];
  if (input.previousAverageConfidence !== null) {
    numbers.push(Math.round(input.previousAverageConfidence * 100));
    numbers.push(
      Math.abs(
        Math.round(
          (input.averageConfidence - input.previousAverageConfidence) * 100,
        ),
      ),
    );
  }
  for (const blocker of input.blockers) {
    numbers.push(blocker.ageHours);
  }
  return numbers;
}
