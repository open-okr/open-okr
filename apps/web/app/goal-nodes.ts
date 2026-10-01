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

/** The translate function a server page already holds. */
type Translate = (
  key: string,
  values?: Readonly<Record<string, string | number>>,
) => string;

type Goal = Awaited<
  ReturnType<typeof callAction<"goals.list">>
>["goals"][number];

/** What happens next on this goal, in the words the cadence already uses. */
function nextStepFor(t: Translate, goal: Goal): string {
  if (goal.closedAt) {
    return goal.successStatus
      ? t("goalNodes.closed", { outcome: goal.successStatus })
      : t("goalNodes.closedNoOutcome");
  }
  if (goal.daysPastDue !== null && goal.daysPastDue > 0) {
    return goal.daysPastDue === 1
      ? t("goalNodes.checkInOverdueOne", { count: goal.daysPastDue })
      : t("goalNodes.checkInOverdueOther", { count: goal.daysPastDue });
  }
  if (goal.nextCheckInOn) {
    return t("goalNodes.checkInBy", { date: goal.nextCheckInOn });
  }
  return t("goalNodes.noCadence");
}

/**
 * The goal's own row, then one per key result.
 *
 * `note` carries anything true of the row rather than of the goal: the
 * explorer uses it to say a parent is outside the current filter, which used
 * to be a chip in a card that no longer exists.
 */
export function mapNodesFor(
  t: Translate,
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
        ? t("goalNodes.timeframe", {
            startsOn: goal.timeframe.startsOn,
            endsOn: goal.timeframe.endsOn,
          })
        : null,
      nextStep: nextStepFor(t, goal),
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
      nextStep: keyResult.unit
        ? t("goalNodes.progressWithUnit", {
            current: keyResult.currentValue,
            target: keyResult.targetValue,
            unit: keyResult.unit,
          })
        : t("goalNodes.progress", {
            current: keyResult.currentValue,
            target: keyResult.targetValue,
          }),
      goalId: goal.id,
      keyResultId: keyResult.id,
      currentValue: keyResult.currentValue,
      unit: keyResult.unit,
    });
  }

  return rows;
}

/**
 * The whole set as a tree: parents before children, key results under the
 * goal that owns them.
 *
 * A goal whose parent is not in the set is drawn at the root rather than
 * dropped, the same way the explorer treats one: a tree that silently omits
 * work is worse than one that shows it at the wrong indent. Here rather than
 * in the Work Map's page since completeness review M-22, because the space
 * home draws a space's goals as the same tree and a second copy would drift.
 */
export function goalTreeNodes(t: Translate, goals: readonly Goal[]): MapNode[] {
  const present = new Set(goals.map((goal) => goal.id));
  const childrenOf = new Map<string, Goal[]>();
  const roots: Goal[] = [];
  for (const goal of goals) {
    const parent = goal.parentGoalId;
    if (parent && present.has(parent)) {
      const siblings = childrenOf.get(parent);
      if (siblings) {
        siblings.push(goal);
      } else {
        childrenOf.set(parent, [goal]);
      }
    } else {
      roots.push(goal);
    }
  }

  const out: MapNode[] = [];
  const seen = new Set<string>();
  const walk = (goal: Goal, depth: number): void => {
    if (seen.has(goal.id)) {
      // Unreachable through the interface, reachable through a bad import.
      return;
    }
    seen.add(goal.id);
    out.push(...mapNodesFor(t, goal, depth));
    for (const child of childrenOf.get(goal.id) ?? []) {
      walk(child, depth + 1);
    }
  };
  for (const root of roots) {
    walk(root, 0);
  }
  return out;
}
