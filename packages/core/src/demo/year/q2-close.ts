/**
 * Q2's competitor and its close (P9-T22c-c-b, scenario chapter 2,
 * NW-Q2-09 to NW-Q2-23).
 *
 * Brightline launches on 10 May. Two days later an emergency session starts
 * C5, stops C4, moves CS2 and M1, makes C2 aspirational and eases S2.1, each
 * with its reason. Ben leaves, the questionnaires pile up and a decision
 * meets them, C5.1 finds its number and C5.4 its target. The review and the
 * retrospective are held apart on 16 and 18 June, and Q3's revalidation
 * revises the annual frame on 21 June.
 *
 * A stop, a kind change and an eased target are stamped by the product with
 * the day they are written, which for a quarter long over is today. Each is
 * dated here to the story's day, by the builder's own audited operation,
 * because the close reads those dates back: "committed until 12 May".
 */
import {
  activeOnly,
  activities,
  goals,
  keyResultTargetChanges,
} from "@openokr/db";
import { and, desc, eq } from "drizzle-orm";
import { callAction } from "../../actions/registry.ts";
import { runOperation } from "../../operations/operation.ts";
import { richTextFromPlainText } from "../../rich-text/from-text.ts";
import { YEAR_FRAME } from "./annual.ts";
import { addYearKeyResult, writeYearObjective } from "./okr.ts";
import { C5_4, Q2_LATE_WEEKS, Q2_OBJECTIVES } from "./q2-run.ts";
import { computed, markAddedOn, monthlyReview, sessionOn } from "./rhythm.ts";
import {
  cycleHolding,
  need,
  type YearContext,
  type YearEvent,
} from "./timeline.ts";

/** What the builder dates to the story's day. */
type Restamp =
  | { readonly closed: string }
  | { readonly kindChanged: string }
  | { readonly targetChanged: string };

/** Dates a row the product stamped with today to the day the story made it. */
async function restamp(context: YearContext, subject: Restamp): Promise<void> {
  const at = new Date(`${context.on}T12:00:00.000Z`);
  await runOperation(
    { pool: context.seed.pool },
    {
      action: "demo.year.restamp",
      workspaceId: context.seed.workspaceId,
      actor: { kind: "human", userId: context.seed.adminUserId },
      async execute({ tx, workspaceId }) {
        let goalId: string;
        if ("closed" in subject) {
          goalId = subject.closed;
          // openokr:allow-mutation: the builder's own audited operation.
          await tx
            .update(goals)
            .set({ closedAt: at })
            .where(activeOnly(goals, eq(goals.id, goalId)));
        } else if ("kindChanged" in subject) {
          goalId = subject.kindChanged;
          // The kind change's one record is its activity, which the close
          // reads for "committed until" (P9-T11b-a).
          // openokr:allow-mutation: the builder's own audited operation.
          await tx
            .update(activities)
            .set({ at })
            .where(
              and(
                eq(activities.workspaceId, workspaceId),
                eq(activities.kind, "goal.kind_changed"),
                eq(activities.subjectId, goalId),
              ),
            );
        } else {
          const [latest] = await tx
            .select({ id: keyResultTargetChanges.id })
            .from(keyResultTargetChanges)
            .where(
              activeOnly(
                keyResultTargetChanges,
                eq(keyResultTargetChanges.keyResultId, subject.targetChanged),
              ),
            )
            .orderBy(desc(keyResultTargetChanges.createdAt))
            .limit(1);
          if (!latest) {
            throw new Error("No target change to date.");
          }
          // openokr:allow-mutation: the builder's own audited operation.
          await tx
            .update(keyResultTargetChanges)
            .set({ changedAt: at })
            .where(
              activeOnly(
                keyResultTargetChanges,
                eq(keyResultTargetChanges.id, latest.id),
              ),
            );
          return {
            result: latest.id,
            activity: {
              kind: "key_result.updated" as const,
              subjectType: "key_result" as const,
              subjectId: subject.targetChanged,
              payload: {},
            },
            audit: {
              action: "demo.year.restamp",
              targetType: "key_result",
              targetId: subject.targetChanged,
              payload: { on: context.on, what: "target change" },
            },
          };
        }
        const [goal] = await tx
          .select({ title: goals.title })
          .from(goals)
          .where(activeOnly(goals, eq(goals.id, goalId)))
          .limit(1);
        return {
          result: goalId,
          activity: {
            kind: "goal.updated" as const,
            subjectType: "goal" as const,
            subjectId: goalId,
            payload: { title: goal?.title ?? "" },
          },
          audit: {
            action: "demo.year.restamp",
            targetType: "goal",
            targetId: goalId,
            payload: {
              on: context.on,
              what: "closed" in subject ? "stop" : "kind change",
            },
          },
        };
      },
    },
  );
}

/** C5, started at the emergency session (NW-Q2-10). */
const C5 = {
  key: "q2:C5",
  title: "Mid-market buyers choose us over Brightline",
  level: "company" as const,
  kind: "aspirational" as const,
  championKey: "daniel" as const,
  reviewerKey: "elena" as const,
  parentGoal: "a4",
  reason:
    "Brightline launched into our segment on 10 May, 30% below our price; winning against it is now this quarter's question.",
  keyResults: [
    {
      key: "q2:C5.1",
      title: "Establish our win rate against Brightline",
      kind: "baseline" as const,
      indicatorType: "lagging" as const,
      ownerKey: "amara" as const,
    },
    {
      key: "q2:C5.2",
      title: "Cut late-stage deals lost to Brightline from 3 to 0 a month",
      direction: "reduce" as const,
      indicatorType: "lagging" as const,
      baselineValue: 3,
      targetValue: 0,
      unit: "deals",
      ownerKey: "daniel" as const,
    },
    {
      key: "q2:C5.3",
      title:
        "Use the competitive battlecard in 80% of mid-market opportunities, from 0%",
      direction: "increase" as const,
      indicatorType: "leading" as const,
      baselineValue: 0,
      targetValue: 80,
      unit: "%",
      ownerKey: "nadia" as const,
    },
  ],
};

/** What the review graded, beside its reason where the story gives one. */
const GRADE_REASONS: Readonly<Record<string, string>> = {
  "q2:C2.1":
    "Aspirational since 12 May, when two support agents moved to the competitive response.",
  "q2:C2.2":
    "Aspirational since 12 May; the two agents' time is where the gap is.",
  "q2:S2.1":
    "Graded against the $2.9M it was eased to on 12 May; the original $3.4M is beside it.",
};

/** §8.4's causes, by their place in the list: 4 capacity, 5 priority, 6 market. */
const ROOT_CAUSES: readonly {
  readonly keyResult: string;
  readonly cause: 4 | 5 | 6;
}[] = [
  { keyResult: "q2:C1.2", cause: 5 },
  { keyResult: "q2:C5.3", cause: 5 },
  { keyResult: "q2:C5.4", cause: 5 },
  { keyResult: "q2:P1.1", cause: 5 },
  { keyResult: "q2:S2.2", cause: 5 },
  { keyResult: "q2:M1.1", cause: 5 },
  { keyResult: "q2:C5.2", cause: 6 },
  { keyResult: "q2:S1.1", cause: 6 },
  { keyResult: "q2:S2.1", cause: 6 },
  { keyResult: "q2:C2.2", cause: 4 },
  { keyResult: "q2:CS2.1", cause: 4 },
];

const DECISIONS: Readonly<
  Record<
    string,
    {
      readonly decision: "achieved" | "keep" | "modify" | "abandon" | "defer";
      readonly why: string;
    }
  >
> = {
  "q2:C3": {
    decision: "achieved",
    why: "The observation window is clean and questionnaires are back to four days.",
  },
  "q2:F2": {
    decision: "achieved",
    why: "Every budget owner has a weekly spend view.",
  },
  "q2:C1": { decision: "keep", why: "Still the year's first priority." },
  "q2:C5": {
    decision: "keep",
    why: "Brightline is still in the segment, and the win rate is only starting to move.",
  },
  "q2:P2": { decision: "keep", why: "The cohort evidence is what C1 runs on." },
  "q2:E1": { decision: "keep", why: "Finish the twelve answers." },
  "q2:E2": { decision: "keep", why: "A commitment that runs every quarter." },
  "q2:S1": {
    decision: "keep",
    why: "Deal fit matters more against a cheaper rival.",
  },
  "q2:CS1": { decision: "keep", why: "Renewal season starts in the autumn." },
  "q2:SU1": { decision: "keep", why: "Deflection is still moving." },
  "q2:C2": {
    decision: "modify",
    why: "Committed again for Q3, once the two agents are back in July.",
  },
  "q2:P1": {
    decision: "modify",
    why: "Becomes P4: guided setup measured on the accounts Brightline is courting.",
  },
  "q2:M1": {
    decision: "modify",
    why: "Rewritten for the competitive response.",
  },
  "q2:S2": { decision: "abandon", why: "Its pipeline target now lives in C5." },
  "q2:CS2": {
    decision: "defer",
    why: "Expansion competes on its merits on Q3's issue list.",
  },
};

/** The review half, 16 June: stages 1 to 4. */
const Q2_REVIEW: YearEvent = {
  on: "2027-06-16",
  step: "NW-Q2-20",
  label: "Q2's review, held apart from its retrospective",
  async run(context) {
    const cycleId = need(context.ids.cycles, "q2", "Cycle");
    const spaceId = need(context.ids.spaces, "company", "Space");
    const facilitatorId = need(context.ids.people, "priya", "Person");
    const review = await callAction(context.action, "sessions.create", {
      spaceId,
      cycleId,
      kind: "quarterly",
      title: "Q2 review",
      scheduledFor: `${context.real("2027-06-16")}T09:00:00.000Z`,
      facilitatorId,
      part: "review",
    });
    context.ids.sessions.set("q2:review", review.id);
    // The retrospective is scheduled with it, as booking would have.
    const retrospective = await callAction(context.action, "sessions.create", {
      spaceId,
      cycleId,
      kind: "quarterly",
      title: "Q2 retrospective",
      scheduledFor: `${context.real("2027-06-18")}T09:00:00.000Z`,
      facilitatorId,
      part: "retrospective",
    });
    context.ids.sessions.set("q2:retrospective", retrospective.id);

    const sessionId = review.id;
    await callAction(context.action, "sessions.open", { id: sessionId });
    await callAction(context.action, "sessions.givePulse", {
      sessionId,
      pulse: 3,
      word: "stretched",
    });
    // Every key result graded at what §2.10 computes from where it finished
    // (NW-Q2-19). C4's are not: it stopped on 12 May.
    for (const objective of Q2_OBJECTIVES) {
      if (objective.key === "q2:C4") {
        continue;
      }
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
            GRADE_REASONS[keyResult.key] ??
            (score >= 1 ? "Met." : "Graded from where it finished."),
        });
      }
    }
    await callAction(context.action, "sessions.scoreKeyResult", {
      sessionId,
      keyResultId: need(context.ids.keyResults, C5_4.key, "Key result"),
      score: computed(C5_4),
      reason: "38% against 45%, from the 31% C5.1 found on 31 May.",
    });
    for (const [goalKey, text] of [
      [
        "q2:C2",
        "C2 was committed until 12 May, when two support agents moved to the competitive response until July. The commitment could not be met with the people left, so it became aspirational, visibly, the same day.",
      ],
      [
        "q2:S2",
        "S2.1 was eased from $3.4M to $2.9M on 12 May: Brightline's launch took $0.5M of late-stage deals. The original target is beside the grade.",
      ],
    ] as const) {
      await callAction(context.action, "sessions.setNarrative", {
        sessionId,
        goalId: need(context.ids.goals, goalKey, "Objective"),
        body: richTextFromPlainText(text),
      });
    }
    await callAction(context.action, "sessions.giveKudos", {
      sessionId,
      toMemberId: need(context.ids.people, "amara", "Person"),
      text: "Found our win rate against Brightline in three weeks.",
    });
    await callAction(context.action, "sessions.close", { id: sessionId });
  },
};

/** The retrospective half, 18 June: stages 5 to 11, and the close. */
const Q2_RETROSPECTIVE: YearEvent = {
  on: "2027-06-18",
  step: "NW-Q2-21",
  label: "Q2's retrospective, and the quarter closed",
  async run(context) {
    const sessionId = need(context.ids.sessions, "q2:retrospective", "Session");
    await callAction(context.action, "sessions.open", { id: sessionId });
    for (const [columnKey, text] of [
      ["worked", "A leadership session within two days of the launch."],
      ["didnt", "Marketing heard about Brightline from a customer."],
      ["didnt", "Four key results added in one week, three without a reason."],
    ] as const) {
      await callAction(context.action, "sessions.addRetroNote", {
        sessionId,
        columnKey,
        text,
        anonymous: false,
      });
    }
    for (const [questionKey, body] of [
      [1, "Yes until 10 May, and then the right priority was the competitor."],
      [2, "C5 did: it put the response in the same set as everything else."],
      [
        3,
        "We changed: a session within two days, not a wait for the next cycle.",
      ],
      [
        4,
        "Marketing learned of the Brightline launch from a customer, not from Sales.",
      ],
    ] as const) {
      await callAction(context.action, "sessions.setManagementAnswer", {
        sessionId,
        questionKey,
        body,
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
    // Statement three lowest: "our key results measured outcomes, not
    // activity".
    await callAction(context.action, "sessions.submitProcessHealth", {
      sessionId,
      scores: [4, 4, 3, 4, 4].map((score, index) => ({
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
      text: "We learned that a competitor's launch reaches our pipeline within a week, so Sales tells Marketing the same day.",
      carryForward: true,
    });
    await callAction(context.action, "sessions.addAction", {
      sessionId,
      what: "Improve: Sales and Marketing pair their key results on outcomes in Q3",
      ownerId: need(context.ids.people, "daniel", "Person"),
      dueOn: context.real("2027-07-05"),
    });
    await callAction(context.action, "sessions.close", { id: sessionId });
    await callAction(context.action, "cycles.close", {
      cycleId: need(context.ids.cycles, "q2", "Cycle"),
    });
  },
};

export const Q2_CLOSE_EVENTS: readonly YearEvent[] = [
  ...Q2_LATE_WEEKS,
  {
    on: "2027-05-12",
    step: "NW-Q2-10",
    label: "The emergency session's five moves, and S2.1 eased",
    async run(context) {
      const sessionId = await sessionOn(
        context,
        "q2",
        "monthly",
        context.real("2027-05-12"),
        "Leadership session: Brightline",
      );
      // Start: C5, marked added mid-cycle that day.
      const c5 = await writeYearObjective(context, "q2", C5);
      await markAddedOn(context, { goalId: c5 });
      for (const keyResult of C5.keyResults) {
        await markAddedOn(context, {
          keyResultId: need(
            context.ids.keyResults,
            keyResult.key,
            "Key result",
          ),
        });
      }
      // Stop: C4, with the reason the close shows.
      const c4 = need(context.ids.goals, "q2:C4", "Objective");
      await callAction(context.action, "goals.stop", {
        id: c4,
        reason:
          "Capacity moves to the competitive response; expansion returns as a strategic issue for Q3",
      });
      await restamp(context, { closed: c4 });
      // Update: CS2 onto the annual A2, M1 onto C5.
      await callAction(context.action, "goals.update", {
        id: need(context.ids.goals, "q2:CS2", "Objective"),
        parentGoalId: need(context.ids.goals, "a2", "Objective"),
      });
      await callAction(context.action, "goals.update", {
        id: need(context.ids.goals, "q2:M1", "Objective"),
        parentGoalId: c5,
      });
      // Update: C2's kind, visibly and with its reason.
      const c2 = need(context.ids.goals, "q2:C2", "Objective");
      await callAction(context.action, "goals.setKind", {
        id: c2,
        kind: "aspirational",
        reason:
          "Two support agents move to the competitive response until July; the commitment cannot be met with the people left",
      });
      await restamp(context, { kindChanged: c2 });
      // Ben eases S2.1 with a reason from the outside world (NW-Q2-11).
      const s21 = need(context.ids.keyResults, "q2:S2.1", "Key result");
      await callAction(context.action, "goals.changeTarget", {
        id: s21,
        targetValue: 2.9,
        reason:
          "Brightline's launch on 10 May removed $0.5M of late-stage deals; the market price point moved.",
      });
      await restamp(context, { targetChanged: s21 });
      for (const [keyResult, text] of [
        ["q2:C5.2", "C5 started: mid-market buyers choose us over Brightline."],
        [
          "q2:C4.1",
          "C4 stopped; expansion returns as a strategic issue for Q3.",
        ],
        [
          "q2:C2.1",
          "C2 becomes aspirational: two support agents move to the response until July.",
        ],
        [
          "q2:S2.1",
          "S2.1 eased from $3.4M to $2.9M after Brightline's launch.",
        ],
      ] as const) {
        await callAction(context.action, "sessions.recordDecision", {
          sessionId,
          keyResultId: need(context.ids.keyResults, keyResult, "Key result"),
          text,
        });
      }
      await callAction(context.action, "sessions.close", { id: sessionId });
    },
  },
  {
    on: "2027-05-13",
    step: "NW-Q2-12",
    label: "Ben resigns, and S2.1 moves to Jonas",
    async run(context) {
      await callAction(context.action, "goals.updateKeyResult", {
        id: need(context.ids.keyResults, "q2:S2.1", "Key result"),
        ownerId: need(context.ids.people, "jonas", "Person"),
      });
    },
  },
  {
    on: "2027-05-17",
    step: "NW-Q2-14",
    label: "Elena's decision on the questionnaires, and the trust-centre page",
    // After the day's check-ins, which report the drop.
    order: 10,
    async run(context) {
      // A decision belongs to a monthly review (§7.5), so Elena's is taken in
      // a short leadership session of that kind, as 12 May's was.
      const sessionId = await sessionOn(
        context,
        "q2",
        "monthly",
        context.real("2027-05-17"),
        "Leadership session: questionnaires",
      );
      const c32 = need(context.ids.keyResults, "q2:C3.2", "Key result");
      await callAction(context.action, "sessions.recordDecision", {
        sessionId,
        keyResultId: c32,
        text: "One sales engineer moves to questionnaires for six weeks, and a trust-centre page goes up. C3 stays committed.",
      });
      await callAction(context.action, "sessions.close", { id: sessionId });
      await callAction(context.action, "initiatives.create", {
        spaceId: need(context.ids.spaces, "company", "Space"),
        title: "Publish a trust-centre page",
        ownerId: need(context.ids.people, "mei", "Person"),
        keyResultIds: [c32],
      });
    },
  },
  {
    on: "2027-05-31",
    step: "NW-Q2-16",
    label: "C5.1's baseline found, and C5.4 added with its reason",
    order: 10,
    async run(context) {
      const q2 = (await callAction(context.action, "cycles.list", {})).find(
        (cycle) => cycle.id === need(context.ids.cycles, "q2", "Cycle"),
      );
      if (!q2) {
        throw new Error("Q2 is not there to add C5.4 to.");
      }
      const keyResultId = await addYearKeyResult(
        context,
        need(context.ids.goals, "q2:C5", "Objective"),
        {
          key: C5_4.key,
          title: "Raise win rate against Brightline from 31% to 45%",
          direction: "increase",
          indicatorType: "lagging",
          baselineValue: 31,
          targetValue: 45,
          unit: "%",
          ownerKey: "amara",
          reason:
            "Baseline established on 31 May; this is the target C5.1 was for.",
        },
        q2.endsOn,
      );
      await markAddedOn(context, { keyResultId });
    },
  },
  {
    // Four weeks ahead, so it exists when Q2 closes: a close feeds the next
    // quarter that is there.
    on: "2027-06-03",
    label: "Q3's planning opens, four weeks ahead",
    async run(context) {
      const q3 = await cycleHolding(
        context,
        context.real("2027-08-15"),
        "quarterly",
      );
      context.ids.cycles.set("q3", q3.id);
      await callAction(context.action, "cycles.update", {
        id: q3.id,
        sponsorId: need(context.ids.people, "elena", "Person"),
        facilitatorId: need(context.ids.people, "priya", "Person"),
      });
    },
  },
  monthlyReview("NW-Q2-17", "2027-06-07", "q2", {
    "q2:C1": "improving",
    "q2:C2": "improving",
    "q2:C3": "improving",
    "q2:C5": "improving",
  }),
  Q2_REVIEW,
  Q2_RETROSPECTIVE,
  {
    on: "2027-06-21",
    step: "NW-Q2-22",
    label: "Q3's revalidation: the frame holds, with two documented changes",
    async run(context) {
      await callAction(context.action, "workflow.setRevalidation", {
        cycleId: need(context.ids.cycles, "q3", "Cycle"),
        holds: true,
        changed: true,
        changeNote:
          "A4's win-rate target eases from 35% to 32% for Brightline's entry on 10 May, with a key result against Brightline added; \"No pricing rebuild before July\" comes off the not-doing list.",
        focusNote:
          "The mid-year revalidation: A4's win rate eased for Brightline, and the pricing review starts.",
      });
      const winRate = need(context.ids.keyResults, "a4.winRate", "Key result");
      await callAction(context.action, "goals.changeTarget", {
        id: winRate,
        targetValue: 32,
        reason: "Brightline's entry into the segment on 10 May",
      });
      await restamp(context, { targetChanged: winRate });
      const annual = (await callAction(context.action, "cycles.list", {})).find(
        (cycle) => cycle.id === need(context.ids.cycles, "annual", "Cycle"),
      );
      if (!annual) {
        throw new Error("The annual cycle is not there to revise.");
      }
      const added = await addYearKeyResult(
        context,
        need(context.ids.goals, "a4", "Objective"),
        {
          key: "a4.brightline",
          title:
            "Raise win rate against Brightline from 31% to 50% by year-end",
          direction: "increase",
          indicatorType: "lagging",
          baselineValue: 31,
          targetValue: 50,
          unit: "%",
          ownerKey: "daniel",
          reason: "Brightline's entry into the segment on 10 May",
        },
        annual.endsOn,
      );
      await markAddedOn(context, { keyResultId: added });
      await reviseNotDoing(context);
    },
  },
];

/** Takes "No pricing rebuild before July" off the not-doing list (NW-Q2-22). */
async function reviseNotDoing(context: YearContext): Promise<void> {
  const frame = await callAction(context.action, "frame.read", {});
  if (!frame) {
    throw new Error("There is no annual frame to revise.");
  }
  await callAction(context.action, "frame.set", {
    yearLabel: frame.yearLabel,
    horizonLabel: frame.horizonLabel,
    agreed: true,
    notDoing: richTextFromPlainText(
      YEAR_FRAME.notDoing.replace("No pricing rebuild before July. ", ""),
    ),
    strategies: frame.strategies.map((strategy) => ({
      text: strategy.text,
      note: strategy.note,
    })),
    reason: "Competitive price point; the pricing review starts in Q3",
  });
}
