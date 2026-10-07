/**
 * Redrafting what a close carried (P9-T22c-c-a, shared from P9-T22c-d-a).
 *
 * A review keeps or modifies objectives, and its close puts each into the
 * next quarter as a draft whose key results start from their last values
 * (§8.9). The next quarter's table is what the teams made of those drafts:
 * a key result kept is retitled and retargeted, one the quarter does not
 * measure is removed, and new ones are added. Q2 and Q3 both start this way.
 */
import { callAction } from "../../actions/registry.ts";
import { addYearKeyResult, type YearKeyResult } from "./okr.ts";
import type { YearPersonKey } from "./people.ts";
import { need, type YearContext } from "./timeline.ts";

/** A carried key result as the next quarter redrafts it. */
interface Redrafted {
  /** Its label in the next quarter. */
  readonly key: string;
  readonly title: string;
  readonly baselineValue?: number;
  readonly targetValue?: number;
  readonly ownerKey?: YearPersonKey;
}

/** A carried objective as the next quarter redrafts it. */
export interface Redraft {
  /** Its label without a quarter: "C1". */
  readonly key: string;
  readonly title?: string;
  /** A commitment's key results are given their capacity verdicts again. */
  readonly committed?: boolean;
  readonly parentGoal?: string;
  readonly parentKeyResult?: string;
  /** Carried key results by their label in the closed quarter; one left out is removed. */
  readonly keyResults: Readonly<Record<string, Redrafted>>;
  readonly added?: readonly YearKeyResult[];
}

/**
 * Where a carry runs: the closed quarter's label prefix ("" for Q1, whose
 * labels have none) and the next quarter's cycle key, which is its prefix.
 */
export interface Carry {
  readonly from: string;
  readonly to: string;
}

const labelOf = (prefix: string, key: string) =>
  prefix ? `${prefix}:${key}` : key;

export async function cycleEndsOn(
  context: YearContext,
  cycleKey: string,
): Promise<string> {
  const cycle = (await callAction(context.action, "cycles.list", {})).find(
    (one) => one.id === need(context.ids.cycles, cycleKey, "Cycle"),
  );
  if (!cycle) {
    throw new Error(`Cycle "${cycleKey}" is not there to draft in.`);
  }
  return cycle.endsOn;
}

/**
 * Finds the drafts a close carried and names them under the next quarter.
 *
 * A carried draft keeps its title and its key results' titles (§8.9), and is
 * the only objective of that title in its cycle when the close writes it.
 * Its key results are named `<to>-from:<label>` until the redraft renames
 * them.
 */
export async function nameCarried(
  context: YearContext,
  carry: Carry,
  keys: readonly string[],
): Promise<void> {
  const { goals: drafts } = await callAction(context.action, "goals.list", {
    cycleId: need(context.ids.cycles, carry.to, "Cycle"),
    includeClosed: false,
    limit: 500,
  });
  const labels = new Map(
    [...context.ids.keyResults].map(([label, id]) => [id, label]),
  );
  for (const key of keys) {
    const source = await callAction(context.action, "goals.read", {
      id: need(context.ids.goals, labelOf(carry.from, key), "Objective"),
    });
    const draft = drafts.find((goal) => goal.title === source.title);
    if (!draft) {
      throw new Error(`${key} was not carried into ${carry.to}.`);
    }
    context.ids.goals.set(`${carry.to}:${key}`, draft.id);
    for (const keyResult of source.keyResults) {
      const label = labels.get(keyResult.id);
      const carried = draft.keyResults.find(
        (one) => one.title === keyResult.title,
      );
      if (label && carried) {
        context.ids.keyResults.set(`${carry.to}-from:${label}`, carried.id);
      }
    }
  }
}

/**
 * Applies a redraft to a carried objective.
 *
 * A carried key result leaves its due date and its capacity verdict behind
 * with the old cycle (§8.9, P9-T20e-b), so each is given the new quarter's
 * again here, as Phase 5 asks of the people redrafting.
 */
export async function redraft(
  context: YearContext,
  carry: Carry,
  edit: Redraft,
): Promise<void> {
  const goalId = need(
    context.ids.goals,
    `${carry.to}:${edit.key}`,
    "Objective",
  );
  const endsOn = await cycleEndsOn(context, carry.to);
  await callAction(context.action, "goals.update", {
    id: goalId,
    ...(edit.title ? { title: edit.title } : {}),
    ...(edit.parentGoal
      ? { parentGoalId: need(context.ids.goals, edit.parentGoal, "Objective") }
      : {}),
    ...(edit.parentKeyResult
      ? {
          parentKeyResultId: need(
            context.ids.keyResults,
            edit.parentKeyResult,
            "Key result",
          ),
        }
      : {}),
  });
  const source = await callAction(context.action, "goals.read", {
    id: need(context.ids.goals, labelOf(carry.from, edit.key), "Objective"),
  });
  const labels = new Map(
    [...context.ids.keyResults].map(([label, id]) => [id, label]),
  );
  for (const keyResult of source.keyResults) {
    const label = labels.get(keyResult.id);
    if (!label) {
      continue;
    }
    const carriedId = context.ids.keyResults.get(`${carry.to}-from:${label}`);
    if (!carriedId) {
      continue;
    }
    const kept = edit.keyResults[label];
    if (!kept) {
      await callAction(context.action, "goals.removeKeyResult", {
        id: carriedId,
      });
      continue;
    }
    await callAction(context.action, "goals.updateKeyResult", {
      id: carriedId,
      title: kept.title,
      ...(kept.baselineValue === undefined
        ? {}
        : { baselineValue: kept.baselineValue }),
      ...(kept.targetValue === undefined
        ? {}
        : { targetValue: kept.targetValue }),
      ...(kept.ownerKey
        ? { ownerId: need(context.ids.people, kept.ownerKey, "Owner") }
        : {}),
      dueOn: endsOn,
      ...(edit.committed ? { capacity: "fits" as const } : {}),
    });
    context.ids.keyResults.set(kept.key, carriedId);
  }
  for (const keyResult of edit.added ?? []) {
    await addYearKeyResult(context, goalId, keyResult, endsOn);
  }
}
