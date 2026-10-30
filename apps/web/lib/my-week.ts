import type { callAction } from "@openokr/core";

type Goal = Awaited<
  ReturnType<typeof callAction<"goals.list">>
>["goals"][number];

/** How far ahead a goal counts as due now: the check-in walker's lead. */
const DUE_LEAD_DAYS = 2;

export interface WeekCard {
  readonly goal: Goal;
  /** A check-in when due or overdue, an extra update otherwise (H1). */
  readonly action: "checkIn" | "update";
  readonly href: string;
}

/**
 * A key result owner's week (OKRGoal UX review, backlog 12): the open goals the
 * reader champions, most overdue first, each with the one action that fits.
 * METHOD.md §2.5 puts the check-in on the champion, so it is their list.
 */
export function myWeek(
  goals: readonly Goal[],
  memberId: string,
): readonly WeekCard[] {
  return goals
    .filter((goal) => goal.champion.id === memberId && goal.closedAt === null)
    .slice()
    .sort((a, b) => (b.daysPastDue ?? -9999) - (a.daysPastDue ?? -9999))
    .map((goal) => {
      const due =
        goal.daysPastDue !== null && goal.daysPastDue >= -DUE_LEAD_DAYS;
      return {
        goal,
        action: due ? "checkIn" : "update",
        href: due
          ? `/check-in?goal=${goal.id}`
          : `/check-in?goal=${goal.id}&update=1`,
      };
    });
}

export interface TeamRhythm {
  readonly spaceId: string;
  readonly name: string;
  /** Goals whose check-in is not past due. */
  readonly current: number;
  readonly total: number;
}

/**
 * Each team's rhythm right now, for the people who run the cycle (the
 * review's champion cockpit): of a space's open goals, how many are not past
 * their due date. Weakest first, so the team that needs a word is on top.
 * A goal in no space is left out, because no coordinator answers for it.
 */
export function rhythmByTeam(
  goals: readonly Goal[],
  spaces: readonly { readonly id: string; readonly name: string }[],
): readonly TeamRhythm[] {
  return spaces
    .map((space) => {
      const own = goals.filter(
        (goal) => goal.spaceId === space.id && goal.closedAt === null,
      );
      return {
        spaceId: space.id,
        name: space.name,
        current: own.filter((goal) => (goal.daysPastDue ?? 0) <= 0).length,
        total: own.length,
      };
    })
    .filter((row) => row.total > 0)
    .sort(
      (a, b) =>
        a.current / a.total - b.current / b.total ||
        a.name.localeCompare(b.name),
    );
}
