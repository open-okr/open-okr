/**
 * The year's close and 2028's frame (P9-T22c-e-b, scenario chapter 4,
 * NW-Q4-03, NW-Q4-06 and NW-Q4-08).
 *
 * Annual planning for 2028 opens on 20 November and its offsite on
 * 1 December keeps the mission and vision and replaces the achieved
 * strategy. The annual review of 2027 runs on 8 December, before a word of
 * 2028 is drafted, as the same review a quarter gets: graded on the latest
 * readings, A4's eased target beside its original. Its close carries A1, A2
 * and A4 into 2028 as drafts, and 2028's set publishes on 17 December with a
 * fifth objective for the new strategy. The SOC 2 report ticks A3's
 * milestone on the day it is issued.
 */
import { callAction } from "../../actions/registry.ts";
import { richTextFromPlainText } from "../../rich-text/from-text.ts";
import { YEAR_FRAME } from "./annual.ts";
import { narrative, writeYearObjective, type YearObjective } from "./okr.ts";
import { type Carry, nameCarried, type Redraft, redraft } from "./redraft.ts";
import { milestoneDone } from "./rhythm.ts";
import { cycleHolding, need, type YearEvent } from "./timeline.ts";

/** 2027's annual close carried into 2028's annual cycle. */
const INTO_2028: Carry = { from: "", to: "annual2028" };

/** The offsite's strategies: the fourth achieved and replaced (NW-Q4-03). */
const STRATEGIES_2028 = [
  ...YEAR_FRAME.strategies.slice(0, 3),
  "Grow expansion from the accounts that reached value",
];

const PRIORITIES_2028 = [
  {
    text: "Value in the first two days",
    successStatement:
      "The median time to first value is 2 days by December 2028",
  },
  {
    text: "Margins at 15%, held",
    successStatement:
      "Operating margin is at or above 15% in every month of the second half",
  },
  {
    text: "Expansion from the accounts that reached value",
    successStatement:
      "Expansion seats added reach 260 a month by December 2028",
  },
];

/** What the annual review read on 6 December, by annual key result. */
const ANNUAL_VALUES: Readonly<Record<string, readonly [string, number][]>> = {
  a1: [
    ["a1.ttfv", 3.8],
    ["a1.activation", 66],
    ["a1.retention", 93],
  ],
  a2: [
    ["a2.nrr", 104],
    ["a2.supportCost", 97],
  ],
  a3: [
    ["a3.questionnaires", 2],
    ["a3.uptime", 99.4],
  ],
  a4: [
    ["a4.winRate", 31],
    ["a4.brightline", 47],
    ["a4.salesCycle", 46],
  ],
};

const ANNUAL_AUTHORS = {
  a1: "priya",
  a2: "elena",
  a3: "mei",
  a4: "daniel",
} as const;

/** The annual review's grades (NW-Q4-06). */
const ANNUAL_GRADES: readonly {
  readonly keyResult: string;
  readonly score: number;
  readonly reason: string;
}[] = [
  { keyResult: "a1.ttfv", score: 0.87, reason: "3.8 days against 3." },
  { keyResult: "a1.activation", score: 0.79, reason: "66% against 70%." },
  { keyResult: "a1.retention", score: 0.67, reason: "93% against 95%." },
  {
    keyResult: "a2.margin",
    score: 0.76,
    reason:
      "13.6% against 15%: Brightline's price pressure cost two quarters of margin.",
  },
  {
    keyResult: "a2.nrr",
    score: 0.5,
    reason:
      "104% against 108%: expansion was paused for most of Q2 and returned in Q4.",
  },
  {
    keyResult: "a2.supportCost",
    score: 0.94,
    reason: "$97 against $95: the merger ran two support set-ups in October.",
  },
  { keyResult: "a3.soc2", score: 1, reason: "Issued on 10 September." },
  { keyResult: "a3.questionnaires", score: 1, reason: "Two days." },
  {
    keyResult: "a3.uptime",
    score: 0.92,
    reason: "In band in 11 of 12 months; December's failover is the one miss.",
  },
  {
    keyResult: "a4.winRate",
    score: 0.83,
    reason:
      "31% against the 32% it was eased to on 21 June; 35% was the original.",
  },
  { keyResult: "a4.brightline", score: 0.84, reason: "47% against 50%." },
  { keyResult: "a4.salesCycle", score: 0.6, reason: "46 days against 40." },
];

/** The annual review's root causes: every commitment below 1.0 (§8.4). */
const ANNUAL_CAUSES: readonly {
  readonly keyResult: string;
  readonly cause: number;
  readonly detail?: string;
}[] = [
  { keyResult: "a2.margin", cause: 6 },
  { keyResult: "a2.nrr", cause: 5 },
  { keyResult: "a2.supportCost", cause: 4 },
  {
    keyResult: "a3.uptime",
    cause: 9,
    detail: "A database failover failed on 3 December",
  },
];

const ANNUAL_DECISIONS: Readonly<
  Record<
    string,
    {
      readonly decision: "achieved" | "keep" | "modify";
      readonly why: string;
    }
  >
> = {
  a1: {
    decision: "modify",
    why: "The 2028 target for time to first value is 2 days.",
  },
  a2: {
    decision: "keep",
    why: "Brightline's price pressure cost two quarters of margin; the promise stands.",
  },
  a3: {
    decision: "achieved",
    why: "The report is in customers' hands; December's failover is the one miss.",
  },
  a4: { decision: "keep", why: "Brightline is still in the segment." },
};

const REDRAFTS_2028: readonly Redraft[] = [
  {
    key: "a1",
    keyResults: {
      "a1.ttfv": {
        key: "annual2028:a1.ttfv",
        title: "Cut median time to first value from 3.8 days to 2",
        targetValue: 2,
      },
      "a1.activation": {
        key: "annual2028:a1.activation",
        title: "Raise 30-day activation from 66% to 75%",
        targetValue: 75,
      },
      "a1.retention": {
        key: "annual2028:a1.retention",
        title: "Raise 90-day logo retention from 93% to 96%",
        targetValue: 96,
      },
    },
  },
  {
    key: "a2",
    committed: true,
    keyResults: {
      "a2.margin": {
        key: "annual2028:a2.margin",
        title: "Raise operating margin from 13.6% to 15%",
      },
      "a2.nrr": {
        key: "annual2028:a2.nrr",
        title: "Raise net revenue retention from 104% to 108%",
      },
      "a2.supportCost": {
        key: "annual2028:a2.supportCost",
        title: "Cut support cost per account from $97 to $90 a month",
        targetValue: 90,
      },
    },
  },
  {
    key: "a4",
    keyResults: {
      "a4.winRate": {
        key: "annual2028:a4.winRate",
        title: "Raise mid-market win rate from 31% to 35%",
        targetValue: 35,
      },
      "a4.brightline": {
        key: "annual2028:a4.brightline",
        title: "Raise win rate against Brightline from 47% to 55%",
        targetValue: 55,
      },
      "a4.salesCycle": {
        key: "annual2028:a4.salesCycle",
        title: "Cut median sales cycle from 46 days to 40",
      },
    },
  },
];

/** The new strategy's objective (NW-Q4-08). */
const A5: YearObjective = {
  key: "annual2028:a5",
  title: "Expansion comes from the accounts that reached value",
  level: "company",
  kind: "aspirational",
  championKey: "tomas",
  reviewerKey: "elena",
  keyResults: [
    {
      key: "annual2028:a5.seats",
      title: "Raise expansion seats added from 185 to 260 a month",
      direction: "increase",
      indicatorType: "leading",
      baselineValue: 185,
      targetValue: 260,
      unit: "seats",
      ownerKey: "tomas",
      kpiKey: "expansionSeats",
    },
    {
      key: "annual2028:a5.within90",
      title:
        "Raise accounts expanding within 90 days of reaching value from 12% to 25%",
      direction: "increase",
      indicatorType: "leading",
      baselineValue: 12,
      targetValue: 25,
      unit: "%",
      ownerKey: "tomas",
    },
  ],
};

export const ANNUAL_CLOSE_EVENTS: readonly YearEvent[] = [
  milestoneDone(
    "NW-Q3-13",
    "a3",
    "a3.soc2",
    "2027-09-10",
    "leo",
    "The SOC 2 Type II report is issued, twenty days before A3's date.",
  ),
  {
    on: "2027-11-20",
    step: "NW-Q4-03",
    label: "Annual planning for 2028 opens, six weeks ahead",
    async run(context) {
      const annual = await cycleHolding(
        context,
        context.real("2028-06-30"),
        "annual",
      );
      context.ids.cycles.set("annual2028", annual.id);
      await callAction(context.action, "cycles.update", {
        id: annual.id,
        sponsorId: need(context.ids.people, "elena", "Person"),
        facilitatorId: need(context.ids.people, "priya", "Person"),
      });
    },
  },
  {
    on: "2027-11-24",
    step: "NW-Q4-03",
    label: "2028's input pack distributed",
    async run(context) {
      const cycleId = need(context.ids.cycles, "annual2028", "Cycle");
      for (let itemKey = 1; itemKey <= 7; itemKey += 1) {
        await callAction(context.action, "workflow.setPackItem", {
          cycleId,
          itemKey,
          gathered: true,
        });
      }
      await callAction(context.action, "workflow.distributePack", { cycleId });
    },
  },
  {
    on: "2027-12-01",
    step: "NW-Q4-03",
    label: "The offsite: mission and vision hold, strategy four replaced",
    async run(context) {
      const frame = await callAction(context.action, "frame.set", {
        yearLabel: String(context.realYear + 1),
        horizonLabel: YEAR_FRAME.horizonLabel,
        agreed: true,
        mission: richTextFromPlainText(YEAR_FRAME.mission),
        vision: richTextFromPlainText(YEAR_FRAME.vision),
        // As revised at midyear (NW-Q2-22).
        notDoing: richTextFromPlainText(
          YEAR_FRAME.notDoing.replace("No pricing rebuild before July. ", ""),
        ),
        strategies: STRATEGIES_2028.map((text) => ({ text })),
      });
      context.ids.strategies = frame.strategies.map((strategy) => strategy.id);
      const cycleId = need(context.ids.cycles, "annual2028", "Cycle");
      for (const priority of PRIORITIES_2028) {
        await callAction(context.action, "workflow.addPriority", {
          cycleId,
          text: priority.text,
          successStatement: priority.successStatement,
        });
      }
    },
  },
  {
    on: "2027-12-06",
    step: "NW-Q4-06",
    label: "The annual objectives' latest values, before the annual review",
    // After the day's KPI readings.
    order: 10,
    async run(context) {
      for (const [goalKey, values] of Object.entries(ANNUAL_VALUES)) {
        await callAction(context.action, "goals.importCheckIn", {
          goalId: need(context.ids.goals, goalKey, "Objective"),
          authorMemberId: need(
            context.ids.people,
            ANNUAL_AUTHORS[goalKey as keyof typeof ANNUAL_AUTHORS],
            "Author",
          ),
          status: "on_track",
          confidence: 0.6,
          narrative: narrative(
            "The year's latest values, for the annual review.",
          ),
          values: values.map(([keyResult, value]) => ({
            keyResultId: need(context.ids.keyResults, keyResult, "Key result"),
            value,
          })),
          publishedAt: `${context.real("2027-12-06")}T16:00:00.000Z`,
          legacy: { type: "csv", id: `northwind-year:${goalKey}:2027-12-06` },
        });
      }
    },
  },
  {
    on: "2027-12-08",
    step: "NW-Q4-06",
    label:
      "The annual review of 2027, before 2028 is drafted, and the year closed",
    async run(context) {
      const cycleId = need(context.ids.cycles, "annual", "Cycle");
      const session = await callAction(context.action, "sessions.create", {
        spaceId: need(context.ids.spaces, "company", "Space"),
        cycleId,
        kind: "quarterly",
        title: "2027 annual review",
        scheduledFor: `${context.real("2027-12-08")}T09:00:00.000Z`,
        facilitatorId: need(context.ids.people, "priya", "Person"),
      });
      const sessionId = session.id;
      await callAction(context.action, "sessions.open", { id: sessionId });
      await callAction(context.action, "sessions.givePulse", {
        sessionId,
        pulse: 4,
        word: "proud",
      });
      for (const grade of ANNUAL_GRADES) {
        await callAction(context.action, "sessions.scoreKeyResult", {
          sessionId,
          keyResultId: need(
            context.ids.keyResults,
            grade.keyResult,
            "Key result",
          ),
          score: grade.score,
          reason: grade.reason,
        });
      }
      await callAction(context.action, "sessions.addRetroNote", {
        sessionId,
        columnKey: "worked",
        text: "Changing OKRs within the week Brightline launched, not at the next cycle.",
        anonymous: false,
      });
      for (const cause of ANNUAL_CAUSES) {
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
      await callAction(context.action, "sessions.submitProcessHealth", {
        sessionId,
        scores: [4, 4, 4, 3, 4].map((score, index) => ({
          statementKey: index + 1,
          score,
        })),
      });
      for (const [goalKey, decided] of Object.entries(ANNUAL_DECISIONS)) {
        await callAction(context.action, "sessions.decideObjective", {
          sessionId,
          goalId: need(context.ids.goals, goalKey, "Objective"),
          decision: decided.decision,
          why: decided.why,
        });
      }
      await callAction(context.action, "sessions.close", { id: sessionId });
      await callAction(context.action, "cycles.close", { cycleId });
    },
  },
  {
    on: "2027-12-09",
    step: "NW-Q4-08",
    label: "2028's annual objectives drafted from the review's decisions",
    async run(context) {
      await nameCarried(context, INTO_2028, ["a1", "a2", "a4"]);
      for (const edit of REDRAFTS_2028) {
        await redraft(context, INTO_2028, edit);
      }
      await writeYearObjective(context, "annual2028", A5);
    },
  },
  {
    on: "2027-12-17",
    step: "NW-Q4-08",
    label: "2028's annual objectives published",
    async run(context) {
      await callAction(context.action, "workflow.publish", {
        cycleId: need(context.ids.cycles, "annual2028", "Cycle"),
      });
    },
  },
];
