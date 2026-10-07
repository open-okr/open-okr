/**
 * Q1's quarter and its close (P9-T22c-b-b, scenario chapter 1, NW-Q1-15 to
 * NW-Q1-32).
 *
 * Every objective checks in on the Mondays from week 3, when the teams'
 * set has published, to week 11, the last before the review; each key result
 * moves from its baseline to where the scenario says it finished. The
 * quarter's events land on their own days: the KPI that turns unhealthy and
 * the key result added for it, the monthly reviews, the confidence drop and
 * its blocker, the milestones, the divergence Marketing reports late, and the
 * committed key result escalated. The review on 18 March grades every key
 * result, names the causes, reads the diagnostic, decides every objective and
 * closes the quarter.
 *
 * The grades are the scores §2.10 computes from where each key result
 * finished, so the scorecard shows exactly one adjustment, C1.2's, as the
 * scenario has it.
 */
import { activeOnly, keyResults } from "@openokr/db";
import { keyResultProgress, resolveThresholds } from "@openokr/method";
import { eq } from "drizzle-orm";
import { callAction } from "../../actions/registry.ts";
import { runOperation } from "../../operations/operation.ts";
import { addDays } from "./calendar.ts";
import { addYearKeyResult, narrative } from "./okr.ts";
import type { YearPersonKey } from "./people.ts";
import {
  cycleHolding,
  need,
  type YearContext,
  type YearEvent,
} from "./timeline.ts";

/** A key result as Q1 runs it: where it starts, aims and finishes. */
interface RunningKeyResult {
  readonly key: string;
  readonly kind?: "maintain" | "milestone" | "baseline";
  readonly direction?: "increase" | "reduce" | "maintain";
  readonly baseline?: number;
  readonly target?: number;
  /** Where it stands at week 11, which is what the review grades. */
  readonly finish?: number;
  /** Week by week, weeks 3 to 11, where the story gives the path. */
  readonly path?: readonly number[];
  /** The week it is done in, for a milestone or a baseline. */
  readonly doneOn?: string;
  /** The grade's line; committed misses need theirs (§8.3). */
  readonly reason?: string;
}

interface RunningObjective {
  readonly key: string;
  readonly authorKey: YearPersonKey;
  readonly committed?: boolean;
  readonly keyResults: readonly RunningKeyResult[];
}

/** Q1's Mondays from week 3 to week 11 (18 January to 15 March). */
const WEEKS = Array.from({ length: 9 }, (_unused, week) =>
  addDays("2027-01-18", week * 7),
);

const Q1_RUN: readonly RunningObjective[] = [
  {
    key: "C1",
    authorKey: "priya",
    keyResults: [
      { key: "C1.1", direction: "reduce", baseline: 9, target: 6, finish: 7 },
      {
        key: "C1.2",
        direction: "increase",
        baseline: 51,
        target: 58,
        // 54% on 1 March (NW-Q1-23), 55% at the grading (NW-Q1-26).
        path: [51.5, 52, 52, 52.5, 53, 53.5, 54, 54.5, 55],
        finish: 55,
      },
      {
        key: "C1.3",
        direction: "increase",
        baseline: 63,
        target: 75,
        finish: 72,
      },
    ],
  },
  {
    key: "C2",
    authorKey: "tomas",
    committed: true,
    keyResults: [
      {
        key: "C2.1",
        direction: "reduce",
        baseline: 2.9,
        target: 2.4,
        // 3.3 after the January release (NW-Q1-17), 2.7 on 8 March (NW-Q1-25).
        path: [2.9, 3, 3.3, 3.1, 2.95, 2.85, 2.75, 2.7, 2.55],
        finish: 2.55,
        reason:
          "2.55 against 2.4: the January release regression added three weeks of reopened tickets.",
      },
      {
        key: "C2.2",
        direction: "reduce",
        baseline: 128,
        target: 115,
        path: [127, 126, 126, 125, 124, 122, 121, 120, 118],
        finish: 118,
        reason:
          "$118 against $115: the regression's ticket load cost two agents' time in February.",
      },
    ],
  },
  {
    key: "C3",
    authorKey: "mei",
    committed: true,
    keyResults: [
      {
        key: "C3.1",
        direction: "increase",
        baseline: 60,
        target: 100,
        finish: 100,
      },
      { key: "C3.2", kind: "milestone", doneOn: "2027-02-26" },
      {
        key: "C3.3",
        kind: "maintain",
        direction: "maintain",
        baseline: 99.9,
        target: 100,
        finish: 99.95,
      },
    ],
  },
  {
    key: "P1",
    authorKey: "sara",
    keyResults: [
      {
        key: "P1.1",
        direction: "reduce",
        baseline: 1.2,
        target: 0.6,
        finish: 0.8,
      },
      // Amara records the NPS baseline at the first monthly review in March.
      { key: "P1.2", kind: "baseline", doneOn: "2027-03-01", finish: 32 },
    ],
  },
  {
    key: "P2",
    authorKey: "amara",
    keyResults: [
      {
        key: "P2.1",
        direction: "increase",
        baseline: 0,
        target: 12,
        finish: 12,
      },
    ],
  },
  {
    key: "E1",
    authorKey: "mei",
    keyResults: [
      {
        key: "E1.1",
        direction: "increase",
        baseline: 5,
        target: 12,
        finish: 10,
      },
      {
        key: "E1.2",
        direction: "reduce",
        baseline: 610,
        target: 400,
        finish: 450,
      },
    ],
  },
  {
    key: "E2",
    authorKey: "leo",
    committed: true,
    keyResults: [
      {
        key: "E2.1",
        kind: "maintain",
        direction: "maintain",
        baseline: 99.9,
        target: 100,
        finish: 99.95,
      },
      {
        key: "E2.2",
        direction: "reduce",
        baseline: 90,
        target: 45,
        finish: 50,
        reason:
          "50 minutes against 45: on-call coverage was thin in the weeks the release regression ran.",
      },
    ],
  },
  {
    key: "E3",
    authorKey: "mei",
    committed: true,
    keyResults: [{ key: "E3.1", kind: "milestone", doneOn: "2027-02-12" }],
  },
  {
    key: "S1",
    authorKey: "daniel",
    keyResults: [
      {
        key: "S1.1",
        direction: "increase",
        baseline: 68,
        target: 80,
        finish: 76,
      },
      { key: "S1.2", direction: "reduce", baseline: 7, target: 4, finish: 5 },
    ],
  },
  {
    key: "S2",
    authorKey: "jonas",
    keyResults: [
      {
        key: "S2.1",
        direction: "increase",
        baseline: 8,
        target: 12,
        finish: 10,
      },
      {
        key: "S2.2",
        direction: "increase",
        baseline: 2.1,
        target: 3,
        finish: 2.6,
      },
    ],
  },
  {
    key: "CS1",
    authorKey: "tomas",
    keyResults: [
      {
        key: "CS1.1",
        direction: "increase",
        baseline: 81,
        target: 100,
        finish: 96,
      },
      {
        key: "CS1.2",
        direction: "increase",
        baseline: 55,
        target: 90,
        finish: 74,
      },
    ],
  },
  {
    key: "SU1",
    authorKey: "kofi",
    keyResults: [
      {
        key: "SU1.1",
        direction: "increase",
        baseline: 17,
        target: 25,
        finish: 22,
      },
      {
        key: "SU1.2",
        direction: "increase",
        baseline: 30,
        target: 50,
        finish: 48,
      },
    ],
  },
  {
    key: "M1",
    authorKey: "nadia",
    keyResults: [
      {
        key: "M1.1",
        direction: "increase",
        baseline: 40,
        target: 60,
        // Stuck at 44% from late January, under a status reported green
        // (NW-Q1-21).
        path: [42, 44, 44, 44, 44, 44, 44, 44, 44],
        finish: 44,
      },
      {
        key: "M1.2",
        direction: "increase",
        baseline: 120,
        target: 180,
        finish: 150,
      },
    ],
  },
  {
    key: "F1",
    authorKey: "hugo",
    committed: true,
    keyResults: [
      { key: "F1.1", direction: "reduce", baseline: 9, target: 5, finish: 5 },
    ],
  },
];

/** C2.3, added on 1 February for the January regression (NW-Q1-17). */
const C2_3 = {
  key: "C2.3",
  title: "Cut reopened tickets from the January release from 18% to 5%",
  direction: "reduce" as const,
  indicatorType: "leading" as const,
  baselineValue: 18,
  targetValue: 5,
  unit: "%",
  ownerKey: "kofi" as const,
  capacity: "fits" as const,
};
/** Weeks 6 to 11, from the first check-in after it was added. */
const C2_3_PATH = [16, 13, 11, 9, 7, 6];

/** Where a key result stands in a given week, from its path or a straight line. */
function valueIn(
  keyResult: RunningKeyResult,
  week: number,
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
  const share = (week + 1) / WEEKS.length;
  const value =
    keyResult.baseline + (keyResult.finish - keyResult.baseline) * share;
  return Math.round(value * 100) / 100;
}

/** The status and confidence an objective reports in a given week. */
function reported(
  objective: RunningObjective,
  week: number,
): { status: "on_track" | "caution" | "off_track"; confidence: number } {
  const monday = WEEKS[week] ?? "";
  if (objective.key === "C1") {
    // Bulk import slips: guided setup drops to 3 in 10 (NW-Q1-19).
    return monday === "2027-02-08"
      ? { status: "caution", confidence: 0.3 }
      : { status: "on_track", confidence: 0.6 };
  }
  if (objective.key === "C2") {
    // Below the committed floor on 8 March, escalated, then 6 in 10.
    if (monday === "2027-03-08") {
      return { status: "caution", confidence: 0.4 };
    }
    return monday >= "2027-02-01" && monday < "2027-03-15"
      ? { status: "caution", confidence: 0.7 }
      : { status: "on_track", confidence: 0.8 };
  }
  if (objective.key === "M1") {
    // Reported green for four weeks while M1.1 did not move (NW-Q1-21).
    return monday >= "2027-02-22"
      ? { status: "caution", confidence: 0.5 }
      : { status: "on_track", confidence: 0.6 };
  }
  return objective.committed
    ? { status: "on_track", confidence: 0.8 }
    : { status: "on_track", confidence: 0.6 };
}

/** What a check-in says, where the story has something to say. */
function said(objective: RunningObjective, monday: string): string {
  const lines: Record<string, string> = {
    "C1:2027-02-08":
      "Bulk import slipped two weeks, and guided setup waits on it. Confidence on C1.3 drops to 3 in 10. Next action: Mei confirms the new date on Thursday.",
    "C1:2027-02-15":
      "Bulk import shipped on Friday. Guided setup is moving again; back to 6 in 10.",
    "C2:2027-02-01":
      "The January release broke the export button and tickets per account rose to 3.3. We added C2.3 for the reopened tickets.",
    "C2:2027-03-08":
      "Tickets per account at 2.7, confidence 4 in 10. Escalated to Elena: she approved two support agents on the reopened-ticket backlog for three weeks.",
    "M1:2027-02-22":
      "At risk. The target profile changed in January and our lead scoring has not caught up, so M1.1 has not moved from 44% in four weeks.",
  };
  return (
    lines[`${objective.key}:${monday}`] ??
    "Moving as planned this week. Nothing new in the way."
  );
}

/** When an objective's weekly check-in is published: Monday, or as late as it was. */
function publishedOn(objective: RunningObjective, monday: string): string {
  // Marketing checks in on the Wednesday, inside the grace (NW-Q1-16).
  if (objective.key === "M1" && monday === "2027-01-25") {
    return "2027-01-27";
  }
  return monday;
}

const weeklyCheckIns = (week: number, monday: string): YearEvent => ({
  on: monday,
  ...(week === 0 ? { step: "NW-Q1-15" } : {}),
  label: `Q1's check-ins, week ${week + 3}`,
  async run(context) {
    for (const objective of Q1_RUN) {
      const { status, confidence } = reported(objective, week);
      const values: {
        keyResultId: string;
        value?: number;
        confidence?: number;
        done?: boolean;
      }[] = [];
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
        const value = valueIn(keyResult, week);
        if (value !== undefined) {
          values.push({
            keyResultId,
            value,
            confidence:
              keyResult.key === "C1.3" || keyResult.key === "C2.1"
                ? confidence
                : objective.committed
                  ? 0.8
                  : 0.6,
          });
        }
      }
      if (objective.key === "C2" && monday >= "2027-02-08") {
        const value = C2_3_PATH[week - 3];
        if (value !== undefined) {
          values.push({
            keyResultId: need(context.ids.keyResults, "C2.3", "Key result"),
            value,
            confidence: 0.8,
          });
        }
      }
      const on = publishedOn(objective, monday);
      await callAction(context.action, "goals.importCheckIn", {
        goalId: need(context.ids.goals, objective.key, "Objective"),
        authorMemberId: need(context.ids.people, objective.authorKey, "Author"),
        status,
        confidence,
        narrative: narrative(said(objective, monday)),
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
const milestoneDone = (
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
async function sessionOn(
  context: YearContext,
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
        cycleId: need(context.ids.cycles, "q1", "Cycle"),
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

const monthlyReview = (
  step: string,
  on: string,
  trends: Readonly<Record<string, "improving" | "flat" | "declining">>,
  decision: { readonly keyResult: string; readonly text: string },
): YearEvent => ({
  on,
  step,
  label: `The monthly review of ${on}`,
  // After the day's check-ins.
  order: 20,
  async run(context) {
    const sessionId = await sessionOn(
      context,
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
    await callAction(context.action, "sessions.recordDecision", {
      sessionId,
      keyResultId: need(
        context.ids.keyResults,
        decision.keyResult,
        "Key result",
      ),
      text: decision.text,
    });
    await callAction(context.action, "sessions.close", { id: sessionId });
  },
});

const Q1_EVENTS: readonly YearEvent[] = [
  ...WEEKS.map((monday, week) => weeklyCheckIns(week, monday)),
  {
    on: "2027-02-01",
    step: "NW-Q1-17",
    label: "Tickets per account turns unhealthy; C2.3 added mid-cycle",
    // Before the day's check-ins, which report C2.3 from the week after.
    order: -5,
    async run(context) {
      const q1 = (await callAction(context.action, "cycles.list", {})).find(
        (cycle) => cycle.id === need(context.ids.cycles, "q1", "Cycle"),
      );
      if (!q1) {
        throw new Error("Q1 is not there to add C2.3 to.");
      }
      const keyResultId = await addYearKeyResult(
        context,
        need(context.ids.goals, "C2", "Objective"),
        C2_3,
        q1.endsOn,
      );
      // The product marks an addition with the day it is written, which for
      // a quarter long over is today; the story's day is 1 February.
      await markAddedOn(context, keyResultId);
      await callAction(context.action, "kpis.recordResponse", {
        kpiId: need(context.ids.kpis, "tickets", "KPI"),
        kind: "key_result",
        keyResultId,
      });
    },
  },
  monthlyReview(
    "NW-Q1-18",
    "2027-02-01",
    { C1: "flat", C2: "declining", C3: "improving" },
    {
      keyResult: "C2.3",
      text: "C2.3 added against C2 for the January release regression; everything else continues.",
    },
  ),
  {
    on: "2027-02-08",
    step: "NW-Q1-19",
    label: "Bulk import slips, and the blocker on guided setup",
    order: 10,
    async run(context) {
      const sessionId = await sessionOn(
        context,
        "weekly",
        context.real("2027-02-08"),
        "Weekly check-in",
      );
      const blocker = await callAction(
        context.action,
        "sessions.createBlocker",
        {
          sessionId,
          keyResultId: need(context.ids.keyResults, "C1.3", "Key result"),
          type: "dependency",
          description:
            "Guided setup waits on bulk import (E3), which slipped two weeks.",
          ownerId: need(context.ids.people, "mei", "Person"),
          nextAction: "Mei confirms the new date on Thursday",
        },
      );
      context.ids.blockers.set("C1.3", blocker.id);
    },
  },
  milestoneDone(
    "NW-Q1-20",
    "E3",
    "E3.1",
    "2027-02-12",
    "mei",
    "Bulk import is generally available. E3.1 is done, and P1's dependency on it is delivered.",
  ),
  {
    on: "2027-02-15",
    step: "NW-Q1-20",
    label: "The blocker on guided setup closes",
    order: 10,
    async run(context) {
      await callAction(context.action, "sessions.resolveBlocker", {
        id: need(context.ids.blockers, "C1.3", "Blocker"),
      });
    },
  },
  milestoneDone(
    "NW-Q1-22",
    "C3",
    "C3.2",
    "2027-02-26",
    "mei",
    "The auditor is engaged and the observation window started today, three days before it was due.",
  ),
  {
    // Four weeks before Q2, so it exists when Q1 closes: a close feeds the
    // next quarter that is there, and without Q2 that would be the quarter
    // provisioning made for today.
    on: "2027-03-04",
    step: "NW-Q2-01",
    label: "Q2's planning opens, four weeks ahead",
    async run(context) {
      const q2 = await cycleHolding(
        context,
        context.real("2027-04-15"),
        "quarterly",
      );
      context.ids.cycles.set("q2", q2.id);
      await callAction(context.action, "cycles.update", {
        id: q2.id,
        sponsorId: need(context.ids.people, "elena", "Person"),
        facilitatorId: need(context.ids.people, "priya", "Person"),
      });
    },
  },
  monthlyReview(
    "NW-Q1-23",
    "2027-03-01",
    { C1: "declining", C2: "improving", C3: "improving" },
    {
      keyResult: "C1.2",
      text: "Activation is behind pace and trending off track: one engineer moves to the activation checklist for four weeks.",
    },
  ),
];

/** Sets an addition's mark to the day the story made it. */
async function markAddedOn(context: YearContext, keyResultId: string) {
  await runOperation(
    { pool: context.seed.pool },
    {
      action: "demo.year.markAddedOn",
      workspaceId: context.seed.workspaceId,
      actor: { kind: "human", userId: context.seed.adminUserId },
      async execute({ tx }) {
        // openokr:allow-mutation: the builder's own audited operation.
        await tx
          .update(keyResults)
          .set({ addedMidCycleAt: new Date(`${context.on}T11:00:00.000Z`) })
          .where(activeOnly(keyResults, eq(keyResults.id, keyResultId)));
        return {
          result: keyResultId,
          activity: {
            kind: "key_result.updated" as const,
            subjectType: "key_result" as const,
            subjectId: keyResultId,
            payload: {},
          },
          audit: {
            action: "demo.year.markAddedOn",
            targetType: "key_result",
            targetId: keyResultId,
            payload: { on: context.on },
          },
        };
      },
    },
  );
}

// ── The review on 18 March ───────────────────────────────────────────────

/** The score §2.10 computes from where a key result finished. */
function computed(keyResult: RunningKeyResult): number {
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

const C1_2_ADJUSTED = {
  score: 0.71,
  reason:
    "The last three days of March's cohort are missing from the warehouse; with them, activation reads 56%.",
};

const ROOT_CAUSES: readonly {
  readonly keyResult: string;
  readonly cause: number;
  readonly detail?: string;
}[] = [
  { keyResult: "C2.1", cause: 9, detail: "The January release regression" },
  { keyResult: "C2.2", cause: 9, detail: "The January release regression" },
  { keyResult: "C2.3", cause: 9, detail: "The January release regression" },
  { keyResult: "E2.2", cause: 4, detail: "On-call coverage was thin" },
  {
    keyResult: "M1.1",
    cause: 2,
    detail: "Lead scoring depends on a profile Sales owns",
  },
  {
    keyResult: "M1.2",
    cause: 2,
    detail: "Lead scoring depends on a profile Sales owns",
  },
  { keyResult: "S2.1", cause: 1 },
  { keyResult: "S2.2", cause: 1 },
  { keyResult: "CS1.2", cause: 4 },
];

const DECISIONS: Readonly<
  Record<string, { decision: "achieved" | "keep" | "modify"; why: string }>
> = {
  C3: {
    decision: "achieved",
    why: "Every control in and the window started early.",
  },
  E3: { decision: "achieved", why: "Bulk import shipped." },
  F1: { decision: "achieved", why: "The books close in five days." },
  C1: { decision: "keep", why: "Still the year's first priority." },
  P1: { decision: "keep", why: "Onboarding still needs us in the room." },
  P2: {
    decision: "keep",
    why: "The cohort evidence is only starting to arrive.",
  },
  E1: {
    decision: "keep",
    why: "Ten of twelve answers shipped; finish the set.",
  },
  E2: { decision: "keep", why: "A commitment that runs every quarter." },
  S1: { decision: "keep", why: "Deal fit is improving and not done." },
  CS1: { decision: "keep", why: "Renewal season comes in the autumn." },
  SU1: { decision: "keep", why: "Deflection is moving." },
  C2: {
    decision: "modify",
    why: "Re-sliced for Q2 now the regression is behind us.",
  },
  M1: { decision: "modify", why: "Measure lead quality directly." },
  S2: { decision: "modify", why: "Pipeline, not activity." },
};

const Q1_REVIEW: YearEvent = {
  on: "2027-03-18",
  step: "NW-Q1-27",
  label: "Q1's review, held in one session, and the quarter closed",
  async run(context) {
    const cycleId = need(context.ids.cycles, "q1", "Cycle");
    const session = await callAction(context.action, "sessions.create", {
      spaceId: need(context.ids.spaces, "company", "Space"),
      cycleId,
      kind: "quarterly",
      title: "Q1 review",
      scheduledFor: `${context.real("2027-03-18")}T09:00:00.000Z`,
      facilitatorId: need(context.ids.people, "priya", "Person"),
    });
    const sessionId = session.id;
    await callAction(context.action, "sessions.open", { id: sessionId });
    await callAction(context.action, "sessions.givePulse", {
      sessionId,
      pulse: 4,
      word: "steady",
    });

    // Every key result graded at what §2.10 computes, except C1.2, adjusted
    // with its reason (NW-Q1-26).
    for (const objective of Q1_RUN) {
      for (const keyResult of objective.keyResults) {
        const score = computed(keyResult);
        await callAction(context.action, "sessions.scoreKeyResult", {
          sessionId,
          keyResultId: need(
            context.ids.keyResults,
            keyResult.key,
            "Key result",
          ),
          ...(keyResult.key === "C1.2"
            ? C1_2_ADJUSTED
            : {
                score,
                reason:
                  keyResult.reason ??
                  (score >= 1 ? "Met." : "Graded from where it finished."),
              }),
        });
      }
    }
    await callAction(context.action, "sessions.scoreKeyResult", {
      sessionId,
      keyResultId: need(context.ids.keyResults, "C2.3", "Key result"),
      score: Math.round(((18 - 6) / (18 - 5)) * 100) / 100,
      reason:
        "6% against 5%: the last reopened tickets closed in the final week.",
    });

    await callAction(context.action, "sessions.giveKudos", {
      sessionId,
      toMemberId: need(context.ids.people, "mei", "Person"),
      text: "Started the audit observation window three days early.",
    });
    for (const [columnKey, text] of [
      ["worked", "Writing key results as outcomes in the peer review."],
      ["didnt", "Too many objectives per team to talk through on a Monday."],
      ["didnt", "Marketing heard about the profile change last."],
    ] as const) {
      await callAction(context.action, "sessions.addRetroNote", {
        sessionId,
        columnKey,
        text,
        anonymous: false,
      });
    }
    for (const cause of ROOT_CAUSES) {
      await callAction(context.action, "sessions.setRootCause", {
        sessionId,
        keyResultId: need(
          context.ids.keyResults,
          cause.keyResult,
          "Key result",
        ),
        causeKey: cause.cause,
        ...(cause.detail ? { detail: cause.detail } : {}),
      });
    }
    // Statement four lowest: "few enough OKRs that focus was possible".
    await callAction(context.action, "sessions.submitProcessHealth", {
      sessionId,
      scores: [4, 4, 3, 2, 4].map((score, index) => ({
        statementKey: index + 1,
        score,
      })),
    });
    await callAction(context.action, "sessions.recordDiagnostic", {
      sessionId,
    });
    for (const [goalKey, decided] of Object.entries(DECISIONS)) {
      await callAction(context.action, "sessions.decideObjective", {
        sessionId,
        goalId: need(context.ids.goals, goalKey, "Objective"),
        decision: decided.decision,
        why: decided.why,
      });
    }
    await callAction(context.action, "sessions.captureLearning", {
      sessionId,
      text: "We learned that a release regression shows in tickets within ten days; watch the reopen rate weekly.",
      carryForward: true,
    });
    await callAction(context.action, "sessions.addAction", {
      sessionId,
      what: "Improve: two objectives per team in Q2, so focus is possible",
      ownerId: need(context.ids.people, "priya", "Person"),
      dueOn: context.real("2027-04-05"),
    });
    await callAction(context.action, "sessions.close", { id: sessionId });
    await callAction(context.action, "cycles.close", { cycleId });
  },
};

export const Q1_RUN_EVENTS: readonly YearEvent[] = [...Q1_EVENTS, Q1_REVIEW];
