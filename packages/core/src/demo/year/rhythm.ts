/**
 * A quarter's weeks as the Northwind year runs them (P9-T22c-c-a).
 *
 * Q1 wrote these for itself (P9-T22c-b-b). Q2 is the second quarter to need
 * the same things, so they live here: how a key result moves from week to
 * week, the score its finish computes to, a weekly check-in round, a
 * milestone ticked done, and the company space's sessions.
 */
import { activeOnly, goals, keyResults } from "@openokr/db";
import { keyResultProgress, resolveThresholds } from "@openokr/method";
import { eq } from "drizzle-orm";
import { callAction } from "../../actions/registry.ts";
import { runOperation } from "../../operations/operation.ts";
import { narrative } from "./okr.ts";
import type { YearPersonKey } from "./people.ts";
import { need, type YearContext, type YearEvent } from "./timeline.ts";

/** A key result as a quarter runs it: where it starts, aims and finishes. */
export interface RunningKeyResult {
  readonly key: string;
  readonly kind?: "maintain" | "milestone" | "baseline";
  readonly direction?: "increase" | "reduce" | "maintain";
  readonly baseline?: number;
  readonly target?: number;
  /** Where it stands at the last week, which is what the review grades. */
  readonly finish?: number;
  /** Week by week from the quarter's first check-in week, where the story gives the path. */
  readonly path?: readonly number[];
  /** The day it is done on, for a milestone or a baseline. */
  readonly doneOn?: string;
  /** The grade's line; committed misses need theirs (§8.3). */
  readonly reason?: string;
}

export interface RunningObjective {
  readonly key: string;
  readonly authorKey: YearPersonKey;
  readonly committed?: boolean;
  /**
   * The first week it checks in, counted from the quarter's first check-in
   * week. A team's set publishes after the company's, so it starts later.
   */
  readonly from?: number;
  /** The last week it checks in, where it stops before the quarter ends. */
  readonly until?: number;
  readonly keyResults: readonly RunningKeyResult[];
}

type CheckInValue = {
  keyResultId: string;
  value?: number;
  confidence?: number;
  done?: boolean;
};

type Reported = {
  status: "on_track" | "caution" | "off_track";
  confidence: number;
};

/** One quarter's check-in rounds: the Mondays and what each objective says on them. */
export interface QuarterRun {
  /** "Q1", for the event labels. */
  readonly name: string;
  /** The Mondays it checks in on, the first being week `firstWeek`. */
  readonly weeks: readonly string[];
  readonly firstWeek: number;
  /** The step the first round belongs to, where it has one. */
  readonly step?: string;
  readonly objectives: readonly RunningObjective[];
  reported(objective: RunningObjective, week: number): Reported;
  said(objective: RunningObjective, monday: string): string;
  /** When it is published: Monday, unless the story has it late. */
  publishedOn?(objective: RunningObjective, monday: string): string;
  /** A key result's own confidence, where it is not the objective's default. */
  confidenceOf?(
    objective: RunningObjective,
    keyResult: RunningKeyResult,
    week: number,
    reported: Reported,
  ): number | undefined;
  /** Values for key results added after the plan, which the objective's list does not hold. */
  extraValues?(
    context: YearContext,
    objective: RunningObjective,
    week: number,
  ): CheckInValue[];
}

/** Where a key result stands in a given week, from its path or a straight line. */
function valueIn(
  keyResult: RunningKeyResult,
  week: number,
  weeks: number,
): number | undefined {
  if (keyResult.path) {
    return keyResult.path[week];
  }
  if (keyResult.finish === undefined || keyResult.baseline === undefined) {
    return undefined;
  }
  if (keyResult.kind === "maintain") {
    return keyResult.finish;
  }
  const share = (week + 1) / weeks;
  const value =
    keyResult.baseline + (keyResult.finish - keyResult.baseline) * share;
  return Math.round(value * 100) / 100;
}

/** The score §2.10 computes from where a key result finished. */
export function computed(keyResult: RunningKeyResult): number {
  if (keyResult.kind === "milestone" || keyResult.kind === "baseline") {
    return 1;
  }
  const progress = keyResultProgress(
    {
      direction: keyResult.direction ?? "increase",
      baseline: keyResult.baseline ?? 0,
      target: keyResult.target ?? 0,
      current: keyResult.finish ?? keyResult.baseline ?? 0,
      ...(keyResult.kind ? { kind: keyResult.kind } : {}),
    },
    resolveThresholds(),
  );
  return Math.round(Math.min(progress, 100)) / 100;
}

/** One week's round of check-ins, every objective due that week. */
export const weeklyCheckIns = (
  run: QuarterRun,
  week: number,
  monday: string,
): YearEvent => ({
  on: monday,
  ...(week === 0 && run.step ? { step: run.step } : {}),
  label: `${run.name}'s check-ins, week ${week + run.firstWeek}`,
  async run(context) {
    for (const objective of run.objectives) {
      if (week < (objective.from ?? 0) || week > (objective.until ?? week)) {
        continue;
      }
      const reported = run.reported(objective, week);
      const values: CheckInValue[] = [];
      for (const keyResult of objective.keyResults) {
        const keyResultId = need(
          context.ids.keyResults,
          keyResult.key,
          "Key result",
        );
        if (keyResult.kind === "milestone") {
          continue;
        }
        if (keyResult.kind === "baseline") {
          if (keyResult.doneOn === monday && keyResult.finish !== undefined) {
            values.push({ keyResultId, value: keyResult.finish, done: true });
          }
          continue;
        }
        const value = valueIn(keyResult, week, run.weeks.length);
        if (value !== undefined) {
          values.push({
            keyResultId,
            value,
            confidence:
              run.confidenceOf?.(objective, keyResult, week, reported) ??
              (objective.committed ? 0.8 : 0.6),
          });
        }
      }
      values.push(...(run.extraValues?.(context, objective, week) ?? []));
      const on = run.publishedOn?.(objective, monday) ?? monday;
      await callAction(context.action, "goals.importCheckIn", {
        goalId: need(context.ids.goals, objective.key, "Objective"),
        authorMemberId: need(context.ids.people, objective.authorKey, "Author"),
        status: reported.status,
        confidence: reported.confidence,
        narrative: narrative(run.said(objective, monday)),
        values,
        publishedAt: `${context.real(on)}T10:00:00.000Z`,
        legacy: {
          type: "csv",
          id: `northwind-year:${objective.key}:${monday}`,
        },
      });
    }
  },
});

/** A milestone ticked done on its own day, in a check-in of its own. */
export const milestoneDone = (
  step: string,
  objectiveKey: string,
  keyResultKey: string,
  doneOn: string,
  authorKey: YearPersonKey,
  text: string,
): YearEvent => ({
  on: doneOn,
  step,
  label: `${keyResultKey} done`,
  async run(context) {
    await callAction(context.action, "goals.importCheckIn", {
      goalId: need(context.ids.goals, objectiveKey, "Objective"),
      authorMemberId: need(context.ids.people, authorKey, "Author"),
      status: "on_track",
      confidence: 0.9,
      narrative: narrative(text),
      values: [
        {
          keyResultId: need(context.ids.keyResults, keyResultKey, "Key result"),
          done: true,
        },
      ],
      publishedAt: `${context.real(doneOn)}T15:00:00.000Z`,
      legacy: { type: "csv", id: `northwind-year:${keyResultKey}:done` },
    });
  },
});

/** The company space's session of a kind on a real day, opened. */
export async function sessionOn(
  context: YearContext,
  cycleKey: string,
  kind: "weekly" | "monthly",
  on: string,
  title: string,
): Promise<string> {
  const spaceId = need(context.ids.spaces, "company", "Space");
  const sessions = await callAction(context.action, "sessions.list", {
    spaceId,
  });
  const booked = sessions.find(
    (session) =>
      session.kind === kind &&
      session.scheduledFor.slice(0, 10) === on &&
      session.endedAt === null,
  );
  const sessionId =
    booked?.id ??
    (
      await callAction(context.action, "sessions.create", {
        spaceId,
        cycleId: need(context.ids.cycles, cycleKey, "Cycle"),
        kind,
        title,
        scheduledFor: `${on}T09:30:00.000Z`,
        facilitatorId: need(context.ids.people, "priya", "Person"),
      })
    ).id;
  if (booked?.startedAt === null || !booked) {
    await callAction(context.action, "sessions.open", { id: sessionId });
  }
  return sessionId;
}

/** The leadership's monthly review: a trend for each company objective, and its decision. */
export const monthlyReview = (
  step: string,
  on: string,
  cycleKey: string,
  trends: Readonly<Record<string, "improving" | "flat" | "declining">>,
  decision?: { readonly keyResult: string; readonly text: string },
): YearEvent => ({
  on,
  step,
  label: `The monthly review of ${on}`,
  // After the day's check-ins.
  order: 20,
  async run(context) {
    const sessionId = await sessionOn(
      context,
      cycleKey,
      "monthly",
      context.real(on),
      "Monthly review",
    );
    for (const [goalKey, trend] of Object.entries(trends)) {
      await callAction(context.action, "sessions.setTrend", {
        sessionId,
        goalId: need(context.ids.goals, goalKey, "Objective"),
        trend,
      });
    }
    if (decision) {
      await callAction(context.action, "sessions.recordDecision", {
        sessionId,
        keyResultId: need(
          context.ids.keyResults,
          decision.keyResult,
          "Key result",
        ),
        text: decision.text,
      });
    }
    await callAction(context.action, "sessions.close", { id: sessionId });
  },
});

/**
 * Sets an addition's mark to the day the story made it.
 *
 * The product marks an addition with the day it is written, which for a
 * quarter long over is today.
 */
export async function markAddedOn(
  context: YearContext,
  subject: { readonly keyResultId: string } | { readonly goalId: string },
): Promise<void> {
  const at = new Date(`${context.on}T11:00:00.000Z`);
  await runOperation(
    { pool: context.seed.pool },
    {
      action: "demo.year.markAddedOn",
      workspaceId: context.seed.workspaceId,
      actor: { kind: "human", userId: context.seed.adminUserId },
      async execute({ tx }) {
        if ("goalId" in subject) {
          // openokr:allow-mutation: the builder's own audited operation.
          await tx
            .update(goals)
            .set({ addedMidCycleAt: at })
            .where(activeOnly(goals, eq(goals.id, subject.goalId)));
          return {
            result: subject.goalId,
            activity: {
              kind: "goal.updated" as const,
              subjectType: "goal" as const,
              subjectId: subject.goalId,
              payload: {},
            },
            audit: {
              action: "demo.year.markAddedOn",
              targetType: "goal",
              targetId: subject.goalId,
              payload: { on: context.on },
            },
          };
        }
        // openokr:allow-mutation: the builder's own audited operation.
        await tx
          .update(keyResults)
          .set({ addedMidCycleAt: at })
          .where(
            activeOnly(keyResults, eq(keyResults.id, subject.keyResultId)),
          );
        return {
          result: subject.keyResultId,
          activity: {
            kind: "key_result.updated" as const,
            subjectType: "key_result" as const,
            subjectId: subject.keyResultId,
            payload: {},
          },
          audit: {
            action: "demo.year.markAddedOn",
            targetType: "key_result",
            targetId: subject.keyResultId,
            payload: { on: context.on },
          },
        };
      },
    },
  );
}
