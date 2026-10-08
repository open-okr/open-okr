/**
 * Q4's close and Q1 2028's company set (P9-T22c-e-b, scenario chapter 4,
 * NW-Q4-07, NW-Q4-09 to NW-Q4-11, NW-Q4-14).
 *
 * The board approves 2028's plan on 9 December and F4 is met. Q4 is graded
 * on 13 December, before the holidays; the review and the retrospective are
 * held apart on 15 and 16 December. The room closes C6, the recovery, as
 * achieved, keeps C5 and C8 as the product proposes for unfinished
 * aspirational objectives, carries two learnings into 2028, and closes Q4
 * into Q1 2028, whose company set is redrafted and published on 22 December.
 */
import { callAction } from "../../actions/registry.ts";
import { richTextFromPlainText } from "../../rich-text/from-text.ts";
import { Q4_LATE_WEEKS, Q4_OBJECTIVES } from "./q4-run.ts";
import { type Carry, nameCarried, type Redraft, redraft } from "./redraft.ts";
import { computed, milestoneDone } from "./rhythm.ts";
import { cycleHolding, need, type YearEvent } from "./timeline.ts";

/** Q4's close carried into Q1 2028. */
const INTO_Q1_2028: Carry = { from: "q4", to: "q1of2028" };

/** The grades that are not what §2.10 computes, with their explanations. */
const GRADES: Readonly<Record<string, { score?: number; reason: string }>> = {
  "q4:E2.1": {
    score: 0.67,
    reason:
      "Held in two of three months: the database failover of 3 December took December below the band.",
  },
  "q4:CS3.1": {
    reason: "$97 against $95: the merger's double-running costs in October.",
  },
};

/** §8.4's causes: 1 ambition, 4 capacity, 6 market, 9 other with its line. */
const ROOT_CAUSES: readonly {
  readonly keyResult: string;
  readonly cause: number;
  readonly detail?: string;
}[] = [
  {
    keyResult: "q4:E2.1",
    cause: 9,
    detail: "A database failover failed on 3 December",
  },
  { keyResult: "q4:CS3.1", cause: 4 },
  { keyResult: "q4:C5.1", cause: 6 },
  { keyResult: "q4:S3.1", cause: 6 },
  { keyResult: "q4:G1.2", cause: 1 },
];

const DECISIONS: Readonly<
  Record<
    string,
    {
      readonly decision: "achieved" | "keep" | "modify";
      readonly why: string;
    }
  >
> = {
  "q4:C6": {
    decision: "achieved",
    why: "Both key results met, and November's margin is healthy.",
  },
  "q4:C7": { decision: "achieved", why: "Every renewal flagged in time." },
  "q4:F4": { decision: "achieved", why: "The board approved the 2028 plan." },
  "q4:C1": { decision: "keep", why: "Two days is 2028's target." },
  "q4:CS3": {
    decision: "keep",
    why: "The merged team's cost is still above $95.",
  },
  "q4:P4": { decision: "keep", why: "The first session keeps improving." },
  "q4:G1": { decision: "keep", why: "Conversion is moving toward 7%." },
  "q4:E2": { decision: "keep", why: "A commitment that runs every quarter." },
  "q4:S3": { decision: "keep", why: "Late-stage deals are still the edge." },
  // Unfinished and aspirational: the product proposes Keep, and the room
  // accepts (NW-Q4-11).
  "q4:C5": { decision: "keep", why: "Brightline is still in the segment." },
  "q4:C8": { decision: "keep", why: "Expansion is 2028's new strategy." },
  "q4:E1": {
    decision: "modify",
    why: "The renewal questions are answered; onboarding questions next.",
  },
};

const Q1_2028_REDRAFTS: readonly Redraft[] = [
  {
    key: "C1",
    parentGoal: "annual2028:a1",
    keyResults: {
      "q4:C1.1": {
        key: "q1of2028:C1.1",
        title: "Cut median time to first value from 3.8 days to 3",
        targetValue: 3,
      },
      "q4:C1.2": {
        key: "q1of2028:C1.2",
        title: "Raise 30-day activation from 66% to 70%",
        targetValue: 70,
      },
    },
  },
  {
    key: "C5",
    parentGoal: "annual2028:a4",
    keyResults: {
      "q4:C5.1": {
        key: "q1of2028:C5.1",
        title: "Raise win rate against Brightline from 47% to 52%",
        targetValue: 52,
      },
    },
  },
  {
    key: "C8",
    parentGoal: "annual2028:a5",
    keyResults: {
      "q4:C8.1": {
        key: "q1of2028:C8.1",
        title: "Raise expansion seats added from 185 to 210 a month",
        targetValue: 210,
      },
      "q4:C8.2": {
        key: "q1of2028:C8.2",
        title: "Raise net revenue retention from 104% to 105%",
        targetValue: 105,
      },
    },
  },
];

export const Q4_CLOSE_EVENTS: readonly YearEvent[] = [
  ...Q4_LATE_WEEKS,
  {
    // Four weeks ahead, so Q4's close has somewhere to feed (NW-Q4-14).
    on: "2027-12-03",
    label: "Q1 2028's planning opens, four weeks ahead",
    async run(context) {
      const next = await cycleHolding(
        context,
        context.real("2028-02-15"),
        "quarterly",
      );
      context.ids.cycles.set("q1of2028", next.id);
      await callAction(context.action, "cycles.update", {
        id: next.id,
        sponsorId: need(context.ids.people, "elena", "Person"),
        facilitatorId: need(context.ids.people, "priya", "Person"),
      });
    },
  },
  milestoneDone(
    "NW-Q4-07",
    "q4:F4",
    "q4:F4.1",
    "2027-12-09",
    "hugo",
    "The board approved the 2028 plan this afternoon.",
  ),
  {
    on: "2027-12-15",
    step: "NW-Q4-10",
    label: "Q4's review, held apart from its retrospective",
    async run(context) {
      const cycleId = need(context.ids.cycles, "q4", "Cycle");
      const spaceId = need(context.ids.spaces, "company", "Space");
      const facilitatorId = need(context.ids.people, "priya", "Person");
      const review = await callAction(context.action, "sessions.create", {
        spaceId,
        cycleId,
        kind: "quarterly",
        title: "Q4 review",
        scheduledFor: `${context.real("2027-12-15")}T09:00:00.000Z`,
        facilitatorId,
        part: "review",
      });
      const retrospective = await callAction(
        context.action,
        "sessions.create",
        {
          spaceId,
          cycleId,
          kind: "quarterly",
          title: "Q4 retrospective",
          scheduledFor: `${context.real("2027-12-16")}T09:00:00.000Z`,
          facilitatorId,
          part: "retrospective",
        },
      );
      context.ids.sessions.set("q4:retrospective", retrospective.id);
      const sessionId = review.id;
      await callAction(context.action, "sessions.open", { id: sessionId });
      await callAction(context.action, "sessions.givePulse", {
        sessionId,
        pulse: 4,
        word: "ready",
      });
      // Graded on 13 December, before the holidays (NW-Q4-09).
      for (const objective of Q4_OBJECTIVES) {
        for (const keyResult of objective.keyResults) {
          const score = computed(keyResult);
          const given = GRADES[keyResult.key];
          await callAction(context.action, "sessions.scoreKeyResult", {
            sessionId,
            keyResultId: need(
              context.ids.keyResults,
              keyResult.key,
              "Key result",
            ),
            score: given?.score ?? score,
            reason:
              given?.reason ??
              (score >= 1 ? "Met." : "Graded from where it finished."),
          });
        }
      }
      await callAction(context.action, "sessions.setNarrative", {
        sessionId,
        goalId: need(context.ids.goals, "q4:E2", "Objective"),
        body: richTextFromPlainText(
          "Uptime held until 3 December, when a database failover failed and the platform was down for four hours. The runbook and a tested replica are due on 17 December.",
        ),
      });
      await callAction(context.action, "sessions.giveKudos", {
        sessionId,
        toMemberId: need(context.ids.people, "hugo", "Person"),
        text: "Margin back over 13.5% for the first time since 2026.",
      });
      await callAction(context.action, "sessions.close", { id: sessionId });
    },
  },
  {
    on: "2027-12-16",
    step: "NW-Q4-11",
    label:
      "Q4's retrospective: C6 achieved, C5 and C8 kept, and the quarter closed",
    async run(context) {
      const sessionId = need(
        context.ids.sessions,
        "q4:retrospective",
        "Session",
      );
      await callAction(context.action, "sessions.open", { id: sessionId });
      for (const [columnKey, text] of [
        ["worked", "Marking holidays kept the summer's rhythm honest."],
        ["worked", "The recovery read the real margin, never a projection."],
        ["didnt", "The failover runbook had never been tested."],
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
      await callAction(context.action, "sessions.submitProcessHealth", {
        sessionId,
        scores: [4, 4, 4, 4, 4].map((score, index) => ({
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
      for (const text of [
        "We learned that a competitor's launch is a reason to change OKRs within the week, not at the next cycle.",
        "We learned that marking holidays is what kept the summer's rhythm honest.",
      ]) {
        await callAction(context.action, "sessions.captureLearning", {
          sessionId,
          text,
          carryForward: true,
        });
      }
      await callAction(context.action, "sessions.close", { id: sessionId });
      await callAction(context.action, "cycles.close", {
        cycleId: need(context.ids.cycles, "q4", "Cycle"),
      });
    },
  },
  {
    on: "2027-12-20",
    step: "NW-Q4-14",
    label: "Q1 2028's company objectives drafted from what Q4 kept",
    async run(context) {
      await nameCarried(context, INTO_Q1_2028, ["C1", "C5", "C8"]);
      for (const edit of Q1_2028_REDRAFTS) {
        await redraft(context, INTO_Q1_2028, edit);
      }
    },
  },
  {
    on: "2027-12-22",
    step: "NW-Q4-14",
    label: "Q1 2028's company step publishes",
    async run(context) {
      await callAction(context.action, "workflow.publish", {
        cycleId: need(context.ids.cycles, "q1of2028", "Cycle"),
        step: "company",
      });
    },
  },
];
