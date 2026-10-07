/**
 * Q3's summer and its close (P9-T22c-d-b, scenario chapter 3, NW-Q3-06 to
 * NW-Q3-16).
 *
 * The summer changes the organisation under its OKRs: Product marks two
 * holiday weeks and Sara her leave with Amara standing in; Support merges
 * into Customer Success and SU1 moves with it; Mei hands C3 and E1 to Leo
 * and goes on leave with Priya standing in; the Growth team forms and starts
 * G1 with a baseline, then sets its target once the baseline is found. F3's
 * milestones and the SOC 2 report land, the review and the retrospective are
 * held apart on 15 and 16 September, and Q3 closes into Q4.
 */
import { callAction } from "../../actions/registry.ts";
import { richTextFromPlainText } from "../../rich-text/from-text.ts";
import { addYearKeyResult, writeYearObjective } from "./okr.ts";
import { G1_2, Q3_LATE_WEEKS, Q3_OBJECTIVES } from "./q3-run.ts";
import { cycleEndsOn } from "./redraft.ts";
import { computed, markAddedOn, milestoneDone } from "./rhythm.ts";
import { cycleHolding, need, type YearEvent } from "./timeline.ts";

/** G1, the Growth team's first objective (NW-Q3-09). */
const G1 = {
  key: "q3:G1",
  title: "Trials turn into customers without a sales call",
  level: "team" as const,
  kind: "aspirational" as const,
  spaceKey: "growth" as const,
  championKey: "yuki" as const,
  parentGoal: "q3:C1",
  reason: "New Growth team formed 9 August",
  keyResults: [
    {
      key: "q3:G1.1",
      title: "Establish the self-serve trial-to-paid rate",
      kind: "baseline" as const,
      indicatorType: "lagging" as const,
      ownerKey: "amara" as const,
      reason: "New Growth team formed 9 August",
    },
  ],
};

/**
 * §8.4's causes by their place: 1 ambition, 2 wrong measure, 4 capacity,
 * 5 priority shifted, 6 market. A commitment below 1.0 names one as well.
 */
const ROOT_CAUSES: readonly {
  readonly keyResult: string;
  readonly cause: 1 | 2 | 4 | 5 | 6;
}[] = [
  { keyResult: "q3:C2.1", cause: 4 },
  { keyResult: "q3:C6.1", cause: 6 },
  { keyResult: "q3:C6.2", cause: 5 },
  { keyResult: "q3:C6.3", cause: 6 },
  { keyResult: "q3:S3.1", cause: 6 },
  { keyResult: "q3:C5.2", cause: 6 },
  { keyResult: "q3:G1.2", cause: 1 },
  { keyResult: "q3:P4.2", cause: 2 },
  { keyResult: "q3:E1.1", cause: 4 },
];

const DECISIONS: Readonly<
  Record<
    string,
    {
      readonly decision: "achieved" | "keep" | "modify" | "abandon";
      readonly why: string;
    }
  >
> = {
  "q3:C3": {
    decision: "achieved",
    why: "The SOC 2 Type II report was issued five days early.",
  },
  "q3:F3": { decision: "achieved", why: "The new price book is live." },
  "q3:S1": { decision: "achieved", why: "Both measures met." },
  "q3:M1": {
    decision: "achieved",
    why: "Three in five target-profile buyers saw the comparison page.",
  },
  "q3:P2": { decision: "achieved", why: "Thirteen weeks of cohort reports." },
  "q3:CS1": {
    decision: "achieved",
    why: "Renewals flagged 90 days out for 95% of accounts.",
  },
  "q3:C1": { decision: "keep", why: "Still the year's first priority." },
  "q3:C5": { decision: "keep", why: "Brightline is still in the segment." },
  "q3:C6": {
    decision: "keep",
    why: "The recovery continues: the KPI is still in watch.",
  },
  "q3:P4": { decision: "keep", why: "The first session is moving." },
  "q3:E2": { decision: "keep", why: "A commitment that runs every quarter." },
  "q3:S3": {
    decision: "keep",
    why: "Late-stage deals are the response's edge.",
  },
  "q3:G1": {
    decision: "keep",
    why: "The target is set and the work has started.",
  },
  "q3:C2": {
    decision: "modify",
    why: "Moves to Customer Success after the merger, where it becomes CS3.",
  },
  "q3:E1": {
    decision: "modify",
    why: "Renewal and billing questions next, for renewal season.",
  },
  "q3:SU1": {
    decision: "abandon",
    why: "Folded into the merged team's own objective in Customer Success",
  },
};

export const Q3_CLOSE_EVENTS: readonly YearEvent[] = [
  ...Q3_LATE_WEEKS,
  {
    on: "2027-07-12",
    step: "NW-Q3-06",
    label: "Product's holiday weeks, and Sara's leave with Amara standing in",
    async run(context) {
      await callAction(context.action, "spaces.setHolidays", {
        id: need(context.ids.spaces, "product", "Space"),
        holidays: [
          {
            startsOn: context.real("2027-08-09"),
            endsOn: context.real("2027-08-22"),
            label: "Summer",
          },
        ],
      });
      await callAction(context.action, "people.setMemberLeave", {
        memberId: need(context.ids.people, "sara", "Person"),
        leave: [
          {
            startsOn: context.real("2027-08-23"),
            endsOn: context.real("2027-08-27"),
            delegateId: need(context.ids.people, "amara", "Person"),
          },
        ],
      });
    },
  },
  {
    on: "2027-07-26",
    step: "NW-Q3-07",
    label: "Support merges into Customer Success, and SU1 moves with it",
    // Before the frame archives Support, last on the day.
    order: 10,
    async run(context) {
      const customerSuccess = need(
        context.ids.spaces,
        "customerSuccess",
        "Space",
      );
      const kofi = need(context.ids.people, "kofi", "Person");
      await callAction(context.action, "spaces.addMember", {
        spaceId: customerSuccess,
        memberId: kofi,
        role: "member",
      });
      await callAction(context.action, "people.updateMember", {
        memberId: kofi,
        managerId: need(context.ids.people, "tomas", "Person"),
      });
      await callAction(context.action, "goals.moveToSpace", {
        id: need(context.ids.goals, "q3:SU1", "Objective"),
        spaceId: customerSuccess,
      });
    },
  },
  {
    on: "2027-07-30",
    step: "NW-Q3-08",
    label:
      "Mei hands C3 and E1 to Leo, and goes on leave with Priya standing in",
    async run(context) {
      const leo = need(context.ids.people, "leo", "Person");
      for (const goal of ["q3:C3", "q3:E1"]) {
        await callAction(context.action, "goals.reassignRole", {
          id: need(context.ids.goals, goal, "Objective"),
          role: "champion",
          memberId: leo,
        });
      }
      await callAction(context.action, "goals.updateKeyResult", {
        id: need(context.ids.keyResults, "q3:C3.1", "Key result"),
        ownerId: leo,
      });
      await callAction(context.action, "people.setMemberLeave", {
        memberId: need(context.ids.people, "mei", "Person"),
        leave: [
          {
            startsOn: context.real("2027-08-02"),
            endsOn: context.real("2027-10-25"),
            delegateId: need(context.ids.people, "priya", "Person"),
          },
        ],
      });
    },
  },
  {
    on: "2027-08-09",
    step: "NW-Q3-09",
    label:
      "The Growth team starts G1 with a baseline, mid-cycle with its reason",
    // After the frame forms the Growth space.
    order: 10,
    async run(context) {
      const g1 = await writeYearObjective(context, "q3", G1);
      await markAddedOn(context, { goalId: g1 });
      await markAddedOn(context, {
        keyResultId: need(context.ids.keyResults, "q3:G1.1", "Key result"),
      });
    },
  },
  {
    on: "2027-08-23",
    step: "NW-Q3-11",
    label: "G1.1's baseline found, and G1.2 added from it",
    // After the day's check-ins, in which Amara records the baseline.
    order: 10,
    async run(context) {
      const keyResultId = await addYearKeyResult(
        context,
        need(context.ids.goals, "q3:G1", "Objective"),
        {
          key: G1_2.key,
          title: "Raise self-serve trial-to-paid conversion from 4.1% to 7%",
          direction: "increase",
          indicatorType: "lagging",
          baselineValue: 4.1,
          targetValue: 7,
          unit: "%",
          ownerKey: "yuki",
          reason: "Baseline established on 23 August",
        },
        await cycleEndsOn(context, "q3"),
      );
      await markAddedOn(context, { keyResultId });
    },
  },
  milestoneDone(
    "NW-Q3-12",
    "q3:F3",
    "q3:F3.1",
    "2027-08-27",
    "hugo",
    "The board approved the pricing review today.",
  ),
  milestoneDone(
    "NW-Q3-12",
    "q3:F3",
    "q3:F3.2",
    "2027-09-01",
    "hugo",
    "The new price book is live for every renewal from today.",
  ),
  {
    // Four weeks ahead, so Q3's close has somewhere to feed (NW-Q4-01).
    on: "2027-09-03",
    step: "NW-Q4-01",
    label: "Q4's planning opens, four weeks ahead",
    async run(context) {
      const q4 = await cycleHolding(
        context,
        context.real("2027-11-15"),
        "quarterly",
      );
      context.ids.cycles.set("q4", q4.id);
      await callAction(context.action, "cycles.update", {
        id: q4.id,
        sponsorId: need(context.ids.people, "elena", "Person"),
        facilitatorId: need(context.ids.people, "priya", "Person"),
      });
    },
  },
  milestoneDone(
    "NW-Q3-13",
    "q3:C3",
    "q3:C3.1",
    "2027-09-10",
    "leo",
    "The SOC 2 Type II report is issued, five days early. Sales adds it to the trust centre today.",
  ),
  {
    on: "2027-09-15",
    step: "NW-Q3-15",
    label: "Q3's review, held apart from its retrospective",
    async run(context) {
      const cycleId = need(context.ids.cycles, "q3", "Cycle");
      const spaceId = need(context.ids.spaces, "company", "Space");
      const facilitatorId = need(context.ids.people, "priya", "Person");
      const review = await callAction(context.action, "sessions.create", {
        spaceId,
        cycleId,
        kind: "quarterly",
        title: "Q3 review",
        scheduledFor: `${context.real("2027-09-15")}T09:00:00.000Z`,
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
          title: "Q3 retrospective",
          scheduledFor: `${context.real("2027-09-16")}T09:00:00.000Z`,
          facilitatorId,
          part: "retrospective",
        },
      );
      context.ids.sessions.set("q3:retrospective", retrospective.id);
      const sessionId = review.id;
      await callAction(context.action, "sessions.open", { id: sessionId });
      await callAction(context.action, "sessions.givePulse", {
        sessionId,
        pulse: 4,
        word: "relieved",
      });
      for (const objective of Q3_OBJECTIVES) {
        for (const keyResult of objective.keyResults) {
          const score = computed(keyResult);
          await callAction(context.action, "sessions.scoreKeyResult", {
            sessionId,
            keyResultId: need(
              context.ids.keyResults,
              keyResult.key,
              "Key result",
            ),
            score,
            reason:
              keyResult.reason ??
              (score >= 1 ? "Met." : "Graded from where it finished."),
          });
        }
      }
      await callAction(context.action, "sessions.scoreKeyResult", {
        sessionId,
        keyResultId: need(context.ids.keyResults, G1_2.key, "Key result"),
        score: computed(G1_2),
        reason: "5.2% against 7%, three weeks after the baseline was found.",
      });
      await callAction(context.action, "sessions.setNarrative", {
        sessionId,
        goalId: need(context.ids.goals, "q3:C3", "Objective"),
        body: richTextFromPlainText(
          "Leo presents C3, Mei's commitment, delivered while she was away: the SOC 2 Type II report was issued on 10 September, five days early.",
        ),
      });
      await callAction(context.action, "sessions.giveKudos", {
        sessionId,
        toMemberId: need(context.ids.people, "leo", "Person"),
        text: "Carried the SOC 2 report over the line while covering for Mei.",
      });
      await callAction(context.action, "sessions.close", { id: sessionId });
    },
  },
  {
    on: "2027-09-16",
    step: "NW-Q3-16",
    label: "Q3's retrospective, and the quarter closed",
    async run(context) {
      const sessionId = need(
        context.ids.sessions,
        "q3:retrospective",
        "Session",
      );
      await callAction(context.action, "sessions.open", { id: sessionId });
      for (const [columnKey, text] of [
        ["worked", "Holidays marked in advance kept the streaks honest."],
        ["didnt", "Goals went unread for weeks in August."],
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
        });
      }
      // Statement one lowest: "our OKRs stayed visible and were genuinely
      // used to make decisions".
      await callAction(context.action, "sessions.submitProcessHealth", {
        sessionId,
        scores: [3, 4, 4, 4, 4].map((score, index) => ({
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
        text: "We learned that goals go unread for weeks in summer unless a ritual reads them aloud.",
        carryForward: true,
      });
      await callAction(context.action, "sessions.addAction", {
        sessionId,
        what: "Improve: open the first ten minutes of every all-hands with the OKR diagram",
        ownerId: need(context.ids.people, "elena", "Person"),
        dueOn: context.real("2027-10-04"),
      });
      await callAction(context.action, "sessions.close", { id: sessionId });
      await callAction(context.action, "cycles.close", {
        cycleId: need(context.ids.cycles, "q3", "Cycle"),
      });
    },
  },
];
