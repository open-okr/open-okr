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
import {
  YEAR_SPACES,
  type YearPersonKey,
  type YearSpaceKey,
} from "./people.ts";
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
  /**
   * It is a KPI's own key result, so the KPI's monthly reading moves it and a
   * check-in does not (P9-T18a).
   */
  readonly readsKpi?: boolean;
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
  /** Every how many weeks it checks in: its space's frequency (§7.1). */
  readonly every?: number;
  /** Weeks it does not check in: a holiday its space marked, or a miss. */
  readonly skip?: readonly number[];
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
  /** Who writes it in a given week, where that is not its author: a leave. */
  authorOf?(objective: RunningObjective, week: number): YearPersonKey;
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
      const from = objective.from ?? 0;
      if (
        week < from ||
        week > (objective.until ?? week) ||
        (week - from) % (objective.every ?? 1) !== 0 ||
        objective.skip?.includes(week)
      ) {
        continue;
      }
      // A check-in published later in the week than the round it belongs to
      // has not happened yet on the days in between: written now, it would
      // stand in the workspace dated after today (§1 of the seed's design).
      if (
        (run.publishedOn?.(objective, monday) ?? monday) !== monday &&
        context.real(run.publishedOn?.(objective, monday) ?? monday) >
          context.today
      ) {
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
        if (keyResult.kind === "milestone" || keyResult.readsKpi) {
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
        authorMemberId: need(
          context.ids.people,
          run.authorOf?.(objective, week) ?? objective.authorKey,
          "Author",
        ),
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
          const [goal] = await tx
            .update(goals)
            .set({ addedMidCycleAt: at })
            .where(activeOnly(goals, eq(goals.id, subject.goalId)))
            .returning({ title: goals.title });
          return {
            result: subject.goalId,
            activity: {
              kind: "goal.updated" as const,
              subjectType: "goal" as const,
              subjectId: subject.goalId,
              payload: { title: goal?.title ?? "" },
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

/**
 * Books a quarter's whole rhythm in the spaces named, the way a coordinator
 * does before it starts (§7.1).
 *
 * Booking books nothing in the past, and for a quarter that ended a few days
 * ago it books the review it is missing, today, which a team booking late
 * should get. The seed books every quarter on its scenario day, which for a
 * quarter long over is long after it ended, so a quarter already over on the
 * real calendar is left alone: its rituals are the ones the story holds.
 */
export async function bookRhythm(
  context: YearContext,
  cycleKey: string,
  spaces: readonly YearSpaceKey[],
): Promise<void> {
  const cycleId = need(context.ids.cycles, cycleKey, "Cycle");
  const cycle = (await callAction(context.action, "cycles.list", {})).find(
    (one) => one.id === cycleId,
  );
  if (!cycle || cycle.endsOn < context.today) {
    return;
  }
  // The quarter under way today is booked last, once the rest of the year to
  // date has run: a booking made at the plan would keep weekly sessions for a
  // space that later moved to every two weeks, sessions in holiday weeks
  // marked after it, and sessions for a space archived since.
  if (cycle.startsOn <= context.today) {
    context.deferredBookings.push({ cycleKey, spaces });
    return;
  }
  await bookSpaces(context, cycleId, spaces);
}

/** The bookings `bookRhythm` held back, for the spaces still standing. */
export async function bookDeferredRhythms(context: YearContext): Promise<void> {
  if (context.deferredBookings.length === 0) {
    return;
  }
  const standing = new Set(
    (await callAction(context.action, "spaces.list", {})).map(
      (space) => space.id,
    ),
  );
  const cycles = await callAction(context.action, "cycles.list", {});
  for (const booking of context.deferredBookings) {
    const cycleId = need(context.ids.cycles, booking.cycleKey, "Cycle");
    // A quarter the story has already closed by today owes nothing more: its
    // rituals are the ones the story held.
    if (cycles.find((one) => one.id === cycleId)?.status === "closed") {
      continue;
    }
    await bookSpaces(
      context,
      cycleId,
      booking.spaces.filter((key) => {
        const id = context.ids.spaces.get(key);
        return id !== undefined && standing.has(id);
      }),
    );
  }
}

async function bookSpaces(
  context: YearContext,
  cycleId: string,
  spaces: readonly YearSpaceKey[],
): Promise<void> {
  for (const key of spaces) {
    const space = YEAR_SPACES.find((one) => one.key === key);
    if (!space) {
      continue;
    }
    await callAction(context.action, "sessions.bookCycle", {
      spaceId: need(context.ids.spaces, key, "Space"),
      cycleId,
      weekday: 1,
      time: "09:30",
      facilitatorId: need(
        context.ids.people,
        space.coordinatorKey,
        "Coordinator",
      ),
    });
  }
}
