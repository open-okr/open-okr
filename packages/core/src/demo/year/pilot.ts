/**
 * The pilot, before the year (P9-T22c-b-a, scenario NW-P-02, NW-P-03,
 * NW-P-13).
 *
 * Two spaces try OpenOKR for a quarter before the company does. The scenario
 * names the pilot's spaces, its people, Tomás's confidence falling in week
 * five, its score of 0.55 and its two learnings, and not its objectives, so
 * these are the two the pilot's people would have written: the ones Q1's C1
 * and CS1 grow out of, with values that end where Q1's baselines begin.
 *
 * It ran on 0.1.2 and the instance does not, so what is seeded is what the
 * pilot left (`docs/design/northwind-year-seed.md` §5): a closed quarter
 * with its check-ins and its review, not the lock it ran into.
 */
import { callAction } from "../../actions/registry.ts";
import { addDays } from "./calendar.ts";
import { narrative, writeYearObjective, type YearObjective } from "./okr.ts";
import { cycleHolding, need, type YearEvent } from "./timeline.ts";

const PILOT_OBJECTIVES: readonly YearObjective[] = [
  {
    key: "PL1",
    title: "New accounts reach value faster",
    level: "team",
    kind: "aspirational",
    spaceKey: "product",
    championKey: "sara",
    reviewerKey: "priya",
    keyResults: [
      {
        key: "PL1.1",
        title: "Cut median time to first value from 11 days to 7",
        direction: "reduce",
        indicatorType: "lagging",
        baselineValue: 11,
        targetValue: 7,
        unit: "days",
        ownerKey: "sara",
      },
      {
        key: "PL1.2",
        title: "Raise 30-day activation from 47% to 55%",
        direction: "increase",
        indicatorType: "lagging",
        baselineValue: 47,
        targetValue: 55,
        unit: "%",
        ownerKey: "sara",
      },
    ],
  },
  {
    key: "PL2",
    title: "No customer is surprised by their own renewal",
    level: "team",
    kind: "aspirational",
    spaceKey: "customerSuccess",
    championKey: "tomas",
    reviewerKey: "priya",
    keyResults: [
      {
        key: "PL2.1",
        title: "Flag renewals 90 days out for 70% of accounts, from 40%",
        direction: "increase",
        indicatorType: "lagging",
        baselineValue: 40,
        targetValue: 70,
        unit: "%",
        ownerKey: "tomas",
      },
      {
        key: "PL2.2",
        title:
          "Raise accounts over $10k with a health reading under 30 days old from 60% to 90%",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 60,
        targetValue: 90,
        unit: "%",
        ownerKey: "tomas",
      },
    ],
  },
];

/** Where each key result finished, and the grade the review gave it. */
const PILOT_FINISH: Readonly<
  Record<
    string,
    { readonly value: number; readonly score: number; readonly reason: string }
  >
> = {
  "PL1.1": {
    value: 9,
    score: 0.5,
    reason: "Nine days at the close, half the way to seven.",
  },
  "PL1.2": {
    value: 51,
    score: 0.5,
    reason: "51% at the close, half the way to 55%.",
  },
  "PL2.1": {
    value: 55,
    score: 0.5,
    reason: "55% flagged at the close, half the way to 70%.",
  },
  "PL2.2": {
    value: 81,
    score: 0.7,
    reason: "81% with a fresh reading, most of the way to 90%.",
  },
};

/** The pilot's Mondays: 5 October to 30 November (NW-P-03). */
const PILOT_WEEKS = Array.from({ length: 9 }, (_unused, week) =>
  addDays("2026-10-05", week * 7),
);

/** Tomás's confidence on renewals flagged: 7 in 10, then 3 in week five. */
const renewalsConfidence = (week: number): number =>
  week < 4 ? 0.7 : week === 4 ? 0.3 : 0.5;

const PILOT_START: YearEvent = {
  on: "2026-10-01",
  step: "NW-P-02",
  label: "The pilot quarter, a first cycle declared, and its two objectives",
  // After the day's people and spaces.
  order: 10,
  async run(context) {
    const pilot = await cycleHolding(
      context,
      context.real("2026-10-01"),
      "quarterly",
    );
    context.ids.cycles.set("pilot", pilot.id);
    // On 0.1.2 drafting waited for this box (NW-P-02); the declaration is
    // what the pilot left behind.
    await callAction(context.action, "cycles.update", {
      id: pilot.id,
      firstCycle: true,
      sponsorId: need(context.ids.people, "elena", "Person"),
      facilitatorId: need(context.ids.people, "priya", "Person"),
    });
    for (const objective of PILOT_OBJECTIVES) {
      await writeYearObjective(context, "pilot", objective);
    }
    await callAction(context.action, "workflow.publish", {
      cycleId: pilot.id,
    });
  },
};

const PILOT_CHECK_INS: readonly YearEvent[] = PILOT_WEEKS.map(
  (monday, week) => ({
    on: monday,
    step: "NW-P-03",
    label: `The pilot's check-ins, week ${week + 1}`,
    async run(context) {
      const share = (week + 1) / PILOT_WEEKS.length;
      for (const objective of PILOT_OBJECTIVES) {
        const renewals = objective.key === "PL2";
        const confidence = renewals ? renewalsConfidence(week) : 0.6;
        await callAction(context.action, "goals.importCheckIn", {
          goalId: need(context.ids.goals, objective.key, "Objective"),
          authorMemberId: need(
            context.ids.people,
            objective.championKey,
            "Champion",
          ),
          status: confidence < 0.4 ? "caution" : "on_track",
          confidence,
          narrative: narrative(
            renewals && week === 4
              ? "Renewals flagged 90 days out stalled at 48%: the health readings for three of our largest accounts are two months old. Confidence 3 in 10 until we fix the readings."
              : `Week ${week + 1}. Moving, more slowly than we hoped.`,
          ),
          values: objective.keyResults.map((keyResult) => {
            const finish = PILOT_FINISH[keyResult.key];
            const from = keyResult.baselineValue ?? 0;
            const to = finish?.value ?? from;
            return {
              keyResultId: need(
                context.ids.keyResults,
                keyResult.key,
                "Key result",
              ),
              value: Math.round((from + (to - from) * share) * 10) / 10,
              confidence:
                keyResult.key === "PL2.1" ? renewalsConfidence(week) : 0.6,
            };
          }),
          publishedAt: `${context.real(monday)}T10:00:00.000Z`,
          legacy: {
            type: "csv",
            id: `northwind-year:${objective.key}:${monday}`,
          },
        });
      }
    },
  }),
);

const PILOT_REVIEW: YearEvent = {
  on: "2026-12-14",
  step: "NW-P-13",
  label: "The pilot's review, and its close",
  async run(context) {
    const pilotId = need(context.ids.cycles, "pilot", "Cycle");
    const session = await callAction(context.action, "sessions.create", {
      spaceId: need(context.ids.spaces, "product", "Space"),
      cycleId: pilotId,
      kind: "quarterly",
      title: "Pilot review",
      scheduledFor: `${context.real("2026-12-14")}T09:00:00.000Z`,
      facilitatorId: need(context.ids.people, "priya", "Person"),
    });
    await callAction(context.action, "sessions.open", { id: session.id });
    await callAction(context.action, "sessions.givePulse", {
      sessionId: session.id,
      pulse: 4,
      word: "hopeful",
    });
    for (const [key, finish] of Object.entries(PILOT_FINISH)) {
      await callAction(context.action, "sessions.scoreKeyResult", {
        sessionId: session.id,
        keyResultId: need(context.ids.keyResults, key, "Key result"),
        score: finish.score,
        reason: finish.reason,
      });
    }
    await callAction(context.action, "sessions.addRetroNote", {
      sessionId: session.id,
      columnKey: "worked",
      text: "The Monday session, not the dashboard, is where the decisions happened.",
      anonymous: false,
    });
    await callAction(context.action, "sessions.addRetroNote", {
      sessionId: session.id,
      columnKey: "didnt",
      text: "Four key results per objective were too many to talk through in thirty minutes.",
      anonymous: false,
    });
    // Both feed Q1's input pack (NW-P-13), and neither is carried as an
    // issue: they are about how to run the practice, not work to rank.
    for (const text of [
      "We learned that four key results per objective was too many to discuss in thirty minutes.",
      "We learned that the weekly session is where the value is, not the dashboard.",
    ]) {
      await callAction(context.action, "sessions.captureLearning", {
        sessionId: session.id,
        text,
        carryForward: false,
      });
    }
    await callAction(context.action, "sessions.close", { id: session.id });
    await callAction(context.action, "cycles.close", { cycleId: pilotId });
  },
};

export const PILOT_EVENTS: readonly YearEvent[] = [
  PILOT_START,
  ...PILOT_CHECK_INS,
  PILOT_REVIEW,
];
