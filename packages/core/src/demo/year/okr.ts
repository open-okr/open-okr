/**
 * Objectives and key results as the Northwind year writes them
 * (P9-T22c-b-a). One shape for every quarter's tables, so a chapter reads as
 * the scenario's own table and the writing is in one place.
 */
import { activeOnly, keyResultValues } from "@openokr/db";
import { and, gt, inArray } from "drizzle-orm";
import { callAction } from "../../actions/registry.ts";
import { runOperation } from "../../operations/operation.ts";
import { richTextFromPlainText } from "../../rich-text/from-text.ts";
import type { YearKpiKey } from "./kpis.ts";
import type { YearPersonKey, YearSpaceKey } from "./people.ts";
import { need, type YearContext } from "./timeline.ts";

export interface YearKeyResult {
  /** The scenario's label, "C1.2", by which later events find it. */
  readonly key: string;
  readonly title: string;
  readonly kind?: "metric" | "maintain" | "milestone" | "baseline";
  readonly direction?: "increase" | "reduce" | "maintain";
  readonly indicatorType: "leading" | "lagging";
  readonly baselineValue?: number;
  readonly targetValue?: number;
  readonly unit?: string;
  readonly ownerKey: YearPersonKey;
  /** A scenario date, where it is due before its cycle ends. */
  readonly dueOn?: string;
  readonly capacity?: "fits" | "tight" | "exceeds";
  readonly kpiKey?: YearKpiKey;
}

export interface YearObjective {
  /** The scenario's label, "C1", "P2". Unique across the year. */
  readonly key: string;
  readonly title: string;
  readonly level: "company" | "department" | "team";
  readonly kind: "committed" | "aspirational";
  /** A space's, or the company's when absent. */
  readonly spaceKey?: YearSpaceKey;
  readonly championKey: YearPersonKey;
  /** Department and company objectives have one; team ones do not (NW-P-09). */
  readonly reviewerKey?: YearPersonKey;
  /** An objective it aligns to, by its label. */
  readonly parentGoal?: string;
  /** A key result it aligns to, by its label. */
  readonly parentKeyResult?: string;
  /** Why it stands alone, when it does (METHOD.md §5.2). */
  readonly standaloneReason?: string;
  readonly description?: string;
  readonly keyResults: readonly YearKeyResult[];
}

/**
 * Dates key results' first values to the day the story wrote them.
 *
 * A key result's first value is recorded as it is created, stamped by the
 * database as the seed runs. For a quarter long over that put the start of
 * every chart after its end, months after the check-ins that moved it.
 */
async function dateFirstValues(
  context: YearContext,
  keyResultIds: readonly string[],
): Promise<void> {
  if (keyResultIds.length === 0) {
    return;
  }
  const at = new Date(`${context.on}T09:00:00.000Z`);
  await runOperation(
    { pool: context.seed.pool },
    {
      action: "demo.year.dateFirstValues",
      workspaceId: context.seed.workspaceId,
      actor: { kind: "human", userId: context.seed.adminUserId },
      async execute({ tx }) {
        // openokr:allow-mutation: the builder's own audited operation.
        const dated = await tx
          .update(keyResultValues)
          .set({ at })
          .where(
            activeOnly(
              keyResultValues,
              and(
                inArray(keyResultValues.keyResultId, [...keyResultIds]),
                gt(keyResultValues.at, at),
              ),
            ),
          )
          .returning({ id: keyResultValues.id });
        return {
          result: dated.length,
          activity: {
            kind: "key_result.updated" as const,
            subjectType: "key_result" as const,
            subjectId: keyResultIds[0] as string,
            payload: {},
          },
          audit: {
            action: "demo.year.dateFirstValues",
            targetType: "key_result",
            targetId: keyResultIds[0] as string,
            payload: { keyResults: keyResultIds.length, on: context.on },
          },
        };
      },
    },
  );
}

/** Adds one key result to an objective already written. */
export async function addYearKeyResult(
  context: YearContext,
  goalId: string,
  keyResult: YearKeyResult,
  endsOn: string,
): Promise<string> {
  const kpiId = keyResult.kpiKey
    ? need(context.ids.kpis, keyResult.kpiKey, "KPI")
    : undefined;
  const added = await callAction(context.action, "goals.addKeyResult", {
    goalId,
    title: keyResult.title,
    ...(keyResult.kind ? { kind: keyResult.kind } : {}),
    ...(keyResult.direction ? { direction: keyResult.direction } : {}),
    indicatorType: keyResult.indicatorType,
    ...(keyResult.baselineValue === undefined
      ? {}
      : { baselineValue: keyResult.baselineValue }),
    ...(keyResult.targetValue === undefined
      ? {}
      : { targetValue: keyResult.targetValue }),
    ...(keyResult.unit ? { unit: keyResult.unit } : {}),
    dueOn: keyResult.dueOn ? context.real(keyResult.dueOn) : endsOn,
    ownerId: need(context.ids.people, keyResult.ownerKey, "Owner"),
    ...(keyResult.capacity ? { capacity: keyResult.capacity } : {}),
    ...(kpiId ? { kpiId } : {}),
    weight: 1,
  });
  context.ids.keyResults.set(keyResult.key, added.id);
  await dateFirstValues(context, [added.id]);
  return added.id;
}

/** Writes an objective and its key results into a cycle the events named. */
export async function writeYearObjective(
  context: YearContext,
  cycleKey: string,
  objective: YearObjective,
): Promise<string> {
  const cycleId = need(context.ids.cycles, cycleKey, "Cycle");
  const cycles = await callAction(context.action, "cycles.list", {});
  const cycle = cycles.find((one) => one.id === cycleId);
  if (!cycle) {
    throw new Error(`Cycle "${cycleKey}" is not there to write into.`);
  }
  const spaceId = objective.spaceKey
    ? need(context.ids.spaces, objective.spaceKey, "Space")
    : undefined;
  const goal = await callAction(context.action, "goals.create", {
    title: objective.title,
    ...(objective.description
      ? { description: richTextFromPlainText(objective.description) }
      : {}),
    cycleId,
    level: objective.level,
    kind: objective.kind,
    ownerKind: spaceId ? "space" : "workspace",
    ...(spaceId ? { spaceId } : {}),
    championId: need(context.ids.people, objective.championKey, "Champion"),
    reviewerId: objective.reviewerKey
      ? need(context.ids.people, objective.reviewerKey, "Reviewer")
      : null,
    ...(objective.parentGoal
      ? {
          parentGoalId: need(
            context.ids.goals,
            objective.parentGoal,
            "Objective",
          ),
        }
      : {}),
    ...(objective.parentKeyResult
      ? {
          parentKeyResultId: need(
            context.ids.keyResults,
            objective.parentKeyResult,
            "Key result",
          ),
        }
      : {}),
    weight: 1,
  });
  context.ids.goals.set(objective.key, goal.id);
  if (objective.standaloneReason) {
    await callAction(context.action, "goals.update", {
      id: goal.id,
      standaloneReason: objective.standaloneReason,
    });
  }
  for (const keyResult of objective.keyResults) {
    await addYearKeyResult(context, goal.id, keyResult, cycle.endsOn);
  }
  return goal.id;
}

/** A check-in's narrative, as the editor stores it. */
export const narrative = (text: string) => richTextFromPlainText(text);
