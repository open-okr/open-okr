import type { callAction } from "@openokr/core";
import type { MapNode } from "./work-map.tsx";

/**
 * Turning a `goals.list` row into the rows the goal table draws.
 *
 * Its own module because two screens need the same mapping and the mockups
 * draw them the same way. `01-work-map` is the only drawing of a goal row this
 * repository has, and UIUX-PLAN.md §10 makes an undrawn detail's mockup value
 * the proposed default, so S-13's explorer wears the Work Map's treatment
 * rather than a second one invented beside it. Before this, the explorer drew
 * a card per goal and the Work Map drew a table, from the same action, on the
 * same data.
 *
 * The ordering stays with each caller. The Work Map walks the parent pointer
 * over everything in the cycle; the explorer walks it over whatever survived
 * its filters and has to mark a goal whose parent did not. Two different
 * questions, one row shape.
 */

type Goal = Awaited<
  ReturnType<typeof callAction<"goals.list">>
>["goals"][number];

/** What happens next on this goal, in the words the cadence already uses. */
function nextStepFor(goal: Goal): string {
  if (goal.closedAt) {
    return `closed · ${goal.successStatus ?? "no outcome"}`;
  }
  if (goal.daysPastDue !== null && goal.daysPastDue > 0) {
    return `check-in ${goal.daysPastDue} day${
      goal.daysPastDue === 1 ? "" : "s"
    } overdue`;
  }
  if (goal.nextCheckInOn) {
    return `check in by ${goal.nextCheckInOn}`;
  }
  return "no cadence set";
}

/**
 * The goal's own row, then one per key result.
 *
 * `note` carries anything true of the row rather than of the goal: the
 * explorer uses it to say a parent is outside the current filter, which used
 * to be a chip in a card that no longer exists.
 */
export function mapNodesFor(
  goal: Goal,
  depth: number,
  note?: string,
): MapNode[] {
  const confidences = goal.keyResults
    .map((keyResult) => keyResult.confidence)
    .filter((value): value is number => value !== null);

  const rows: MapNode[] = [
    {
      id: goal.id,
      kind: "goal",
      title: goal.title,
      depth,
      owner: goal.champion.name,
      health: goal.health,
      progressPct: goal.progressPct,
      // The mean of the key results that carry one. A goal has no confidence
      // of its own: §3.2 puts confidence on the measure, and the goal's figure
      // is a summary of them rather than a number anybody typed.
      confidence:
        confidences.length === 0
          ? null
          : confidences.reduce((sum, value) => sum + value, 0) /
            confidences.length,
      timeframe: goal.timeframe
        ? `${goal.timeframe.startsOn} to ${goal.timeframe.endsOn}`
        : null,
      nextStep: nextStepFor(goal),
      goalId: goal.id,
      keyResultId: null,
      currentValue: null,
      unit: null,
      ...(note === undefined ? {} : { note }),
    },
  ];

  for (const keyResult of goal.keyResults) {
    rows.push({
      id: keyResult.id,
      kind: "key_result",
      title: keyResult.title,
      depth: depth + 1,
      owner: goal.champion.name,
      // A key result carries no health of its own: §3.5 puts health on the
      // goal, and inventing one per measure would be a second answer.
      health: goal.health,
      progressPct: keyResult.progressPct,
      confidence: keyResult.confidence,
      timeframe: keyResult.dueOn,
      nextStep: `${keyResult.currentValue} of ${keyResult.targetValue}${
        keyResult.unit ? ` ${keyResult.unit}` : ""
      }`,
      goalId: goal.id,
      keyResultId: keyResult.id,
      currentValue: keyResult.currentValue,
      unit: keyResult.unit,
    });
  }

  return rows;
}
