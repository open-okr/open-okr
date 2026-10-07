/**
 * Q1's plan: planning it, and publishing it in two steps (P9-T22c-b-a,
 * scenario chapter 1, NW-P-04, NW-P-15, NW-Q1-01 to NW-Q1-14).
 *
 * The company set is drafted after the pilot's review and publishes on
 * 23 December; the departments and teams draft from 4 January, read each
 * other's drafts on 12 January and publish on 15 January. The tables are the
 * chapter's, in its own labels.
 */
import { callAction } from "../../actions/registry.ts";
import { richTextFromPlainText } from "../../rich-text/from-text.ts";
import {
  addYearKeyResult,
  writeYearObjective,
  type YearKeyResult,
  type YearObjective,
} from "./okr.ts";
import type { YearSpaceKey } from "./people.ts";
import { bookRhythm } from "./rhythm.ts";
import { cycleHolding, need, type YearEvent } from "./timeline.ts";

const Q1_COMPANY: readonly YearObjective[] = [
  {
    key: "C1",
    title: "New accounts reach value in their first week",
    level: "company",
    kind: "aspirational",
    championKey: "priya",
    reviewerKey: "elena",
    parentGoal: "a1",
    keyResults: [
      {
        key: "C1.1",
        title: "Cut median time to first value from 9 days to 6",
        direction: "reduce",
        indicatorType: "lagging",
        baselineValue: 9,
        targetValue: 6,
        unit: "days",
        ownerKey: "sara",
      },
      {
        key: "C1.2",
        title: "Raise 30-day activation from 51% to 58%",
        direction: "increase",
        indicatorType: "lagging",
        baselineValue: 51,
        targetValue: 58,
        unit: "%",
        ownerKey: "sara",
      },
      {
        key: "C1.3",
        title: "Raise guided setup completed from 63% to 75% of new accounts",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 63,
        targetValue: 75,
        unit: "%",
        ownerKey: "sara",
      },
    ],
  },
  {
    key: "C2",
    title: "Support stops growing with the customer count",
    level: "company",
    kind: "committed",
    championKey: "tomas",
    reviewerKey: "elena",
    parentGoal: "a2",
    keyResults: [
      {
        key: "C2.1",
        title: "Cut support tickets per account from 2.9 to 2.4 a month",
        direction: "reduce",
        indicatorType: "leading",
        baselineValue: 2.9,
        targetValue: 2.4,
        unit: "tickets",
        ownerKey: "kofi",
        capacity: "fits",
      },
      {
        key: "C2.2",
        title: "Cut support cost per account from $128 to $115 a month",
        direction: "reduce",
        indicatorType: "lagging",
        baselineValue: 128,
        targetValue: 115,
        unit: "$",
        ownerKey: "hugo",
        capacity: "fits",
      },
    ],
  },
  {
    key: "C3",
    title: "Be ready for the SOC 2 audit",
    level: "company",
    kind: "committed",
    championKey: "mei",
    reviewerKey: "elena",
    parentGoal: "a3",
    keyResults: [
      {
        key: "C3.1",
        title: "Implement 100% of the SOC 2 controls, from 60%",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 60,
        targetValue: 100,
        unit: "%",
        ownerKey: "leo",
        capacity: "fits",
      },
      {
        key: "C3.2",
        title: "Audit observation window started by 1 March",
        kind: "milestone",
        indicatorType: "leading",
        ownerKey: "mei",
        dueOn: "2027-03-01",
        capacity: "fits",
      },
      {
        key: "C3.3",
        title: "Hold uptime at or above 99.9% every month",
        kind: "maintain",
        direction: "maintain",
        indicatorType: "lagging",
        baselineValue: 99.9,
        targetValue: 100,
        unit: "%",
        ownerKey: "leo",
        capacity: "fits",
      },
    ],
  },
];

/** Drafted on the first day of the teams' drafting (4 January). */
const Q1_TEAMS_FIRST: readonly YearObjective[] = [
  {
    key: "P1",
    title: "Onboarding runs without us in the room",
    level: "team",
    kind: "aspirational",
    spaceKey: "product",
    championKey: "sara",
    parentGoal: "C1",
    keyResults: [
      {
        key: "P1.1",
        title: "Cut manual setup calls per new account from 1.2 to 0.6",
        direction: "reduce",
        indicatorType: "lagging",
        baselineValue: 1.2,
        targetValue: 0.6,
        unit: "calls",
        ownerKey: "sara",
      },
      {
        // The duplicate of Engineering's E3.1 the peer review finds
        // (NW-Q1-12), deleted on 12 January.
        key: "P1.3",
        title: "Bulk import available to every new account",
        kind: "milestone",
        indicatorType: "leading",
        ownerKey: "sara",
      },
    ],
  },
  {
    key: "P2",
    title: "Prove the onboarding change with cohort evidence",
    level: "team",
    kind: "aspirational",
    spaceKey: "product",
    championKey: "amara",
    parentGoal: "C1",
    keyResults: [
      {
        key: "P2.1",
        title: "Publish the weekly cohort report in 12 of 13 weeks",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 0,
        targetValue: 12,
        unit: "weeks",
        ownerKey: "amara",
      },
    ],
  },
  {
    key: "S1",
    title: "Sell to accounts that can onboard themselves",
    level: "department",
    kind: "aspirational",
    spaceKey: "sales",
    championKey: "daniel",
    reviewerKey: "elena",
    parentGoal: "C1",
    keyResults: [
      {
        key: "S1.1",
        title: "Raise new deals inside the target profile from 68% to 80%",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 68,
        targetValue: 80,
        unit: "%",
        ownerKey: "jonas",
      },
      {
        key: "S1.2",
        title: "Cut days from signature to kickoff from 7 to 4",
        direction: "reduce",
        indicatorType: "lagging",
        baselineValue: 7,
        targetValue: 4,
        unit: "days",
        ownerKey: "jonas",
      },
    ],
  },
  {
    key: "CS1",
    title: "No customer is surprised by their own renewal",
    level: "department",
    kind: "aspirational",
    spaceKey: "customerSuccess",
    championKey: "tomas",
    reviewerKey: "elena",
    // Straight to the annual objective (§5.1 allows any level above).
    parentGoal: "a2",
    keyResults: [
      {
        key: "CS1.1",
        title:
          "Raise accounts over $10k with a health reading under 30 days old from 81% to 100%",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 81,
        targetValue: 100,
        unit: "%",
        ownerKey: "tomas",
      },
      {
        key: "CS1.2",
        title: "Flag renewals 90 days out for 90% of accounts, from 55%",
        direction: "increase",
        indicatorType: "lagging",
        baselineValue: 55,
        targetValue: 90,
        unit: "%",
        ownerKey: "tomas",
      },
    ],
  },
  {
    key: "SU1",
    title: "Answer once, in the product",
    level: "team",
    kind: "aspirational",
    spaceKey: "support",
    championKey: "kofi",
    parentKeyResult: "C2.1",
    keyResults: [
      {
        key: "SU1.1",
        title: "Raise self-serve deflection from 17% to 25%",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 17,
        targetValue: 25,
        unit: "%",
        ownerKey: "kofi",
      },
      {
        key: "SU1.2",
        title: "Raise tickets answered with a help-centre link from 30% to 50%",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 30,
        targetValue: 50,
        unit: "%",
        ownerKey: "kofi",
      },
    ],
  },
];

/** Jonas's first draft, task-shaped (NW-Q1-08); rewritten on 12 January. */
const S2_FIRST_DRAFT: YearObjective = {
  key: "S2",
  title: "Fill the pipeline with accounts that fit",
  level: "team",
  kind: "aspirational",
  spaceKey: "sales",
  championKey: "jonas",
  parentGoal: "S1",
  keyResults: [
    {
      key: "S2.1",
      title: "Make 300 cold calls",
      direction: "increase",
      indicatorType: "leading",
      baselineValue: 0,
      targetValue: 300,
      unit: "calls",
      ownerKey: "jonas",
    },
    {
      key: "S2.2",
      title: "Hold 40 demos",
      direction: "increase",
      indicatorType: "leading",
      baselineValue: 0,
      targetValue: 40,
      unit: "demos",
      ownerKey: "ben",
    },
  ],
};

/** S2 after the peer review: conversion, leading; pipeline, lagging. */
const S2_REWRITTEN: readonly YearKeyResult[] = [
  {
    key: "S2.1",
    title: "Raise call-to-meeting conversion from 8% to 12%",
    direction: "increase",
    indicatorType: "leading",
    baselineValue: 8,
    targetValue: 12,
    unit: "%",
    ownerKey: "jonas",
  },
  {
    key: "S2.2",
    title: "Grow qualified mid-market pipeline from $2.1M to $3.0M",
    direction: "increase",
    indicatorType: "lagging",
    baselineValue: 2.1,
    targetValue: 3,
    unit: "$M",
    ownerKey: "ben",
  },
];

/** Engineering's five (NW-Q1-09); the last two become initiatives. */
const Q1_ENGINEERING: readonly YearObjective[] = [
  {
    key: "E1",
    title: "Take the twelve repeated questions out of the product",
    level: "department",
    kind: "aspirational",
    spaceKey: "engineering",
    championKey: "mei",
    reviewerKey: "priya",
    parentKeyResult: "C2.1",
    keyResults: [
      {
        key: "E1.1",
        title:
          "Ship in-product answers for 12 of the repeated questions, from 5",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 5,
        targetValue: 12,
        unit: "answers",
        ownerKey: "mei",
        // Aspirational, so it may exceed and gate 5 raises nothing (NW-Q1-14).
        capacity: "exceeds",
      },
      {
        key: "E1.2",
        title: "Cut p95 setup API latency from 610ms to 400ms",
        direction: "reduce",
        indicatorType: "leading",
        baselineValue: 610,
        targetValue: 400,
        unit: "ms",
        ownerKey: "leo",
      },
    ],
  },
  {
    key: "E2",
    title: "Keep the platform standing",
    level: "team",
    kind: "committed",
    spaceKey: "engineering",
    championKey: "leo",
    parentGoal: "C3",
    keyResults: [
      {
        key: "E2.1",
        title: "Hold uptime at or above 99.9% every month",
        kind: "maintain",
        direction: "maintain",
        indicatorType: "lagging",
        baselineValue: 99.9,
        targetValue: 100,
        unit: "%",
        ownerKey: "leo",
        capacity: "fits",
      },
      {
        key: "E2.2",
        title: "Cut mean time to restore from 90 minutes to 45",
        direction: "reduce",
        indicatorType: "lagging",
        baselineValue: 90,
        targetValue: 45,
        unit: "minutes",
        ownerKey: "leo",
        capacity: "fits",
      },
    ],
  },
  {
    key: "E3",
    title: "New accounts bring their data in one step",
    level: "team",
    kind: "committed",
    spaceKey: "engineering",
    championKey: "mei",
    // Aligned at its own level, to Product's P1 (§5.1).
    parentGoal: "P1",
    keyResults: [
      {
        key: "E3.1",
        title: "Bulk import generally available by 15 February",
        kind: "milestone",
        indicatorType: "leading",
        ownerKey: "mei",
        dueOn: "2027-02-15",
        capacity: "fits",
      },
    ],
  },
  {
    key: "E4",
    title: "Retire the legacy job runner",
    level: "team",
    kind: "aspirational",
    spaceKey: "engineering",
    championKey: "leo",
    parentGoal: "C3",
    keyResults: [
      {
        key: "E4.1",
        title: "Move 14 scheduled jobs off the legacy runner, from 0",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 0,
        targetValue: 14,
        unit: "jobs",
        ownerKey: "leo",
      },
    ],
  },
  {
    key: "E5",
    title: "Write a runbook for every alert",
    level: "team",
    kind: "aspirational",
    spaceKey: "engineering",
    championKey: "leo",
    parentGoal: "C3",
    keyResults: [
      {
        key: "E5.1",
        title: "Cover 40 alerts with a runbook, from 12",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 12,
        targetValue: 40,
        unit: "alerts",
        ownerKey: "leo",
      },
    ],
  },
];

/** Drafted on 7 January (NW-Q1-10, NW-Q1-11). */
const Q1_TEAMS_LAST: readonly YearObjective[] = [
  {
    key: "M1",
    title: "Bring in accounts that fit",
    level: "department",
    kind: "aspirational",
    spaceKey: "marketing",
    championKey: "nadia",
    reviewerKey: "elena",
    // Dragged onto Sales' S1 in the diagram the same day: a diagonal
    // alignment across departments (NW-Q1-10).
    parentGoal: "S1",
    keyResults: [
      {
        key: "M1.1",
        title:
          "Raise marketing-qualified leads inside the target profile from 40% to 60%",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 40,
        targetValue: 60,
        unit: "%",
        ownerKey: "nadia",
      },
      {
        key: "M1.2",
        title: "Raise target-profile trials started from 120 to 180 a month",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 120,
        targetValue: 180,
        unit: "trials",
        ownerKey: "nadia",
      },
    ],
  },
  {
    key: "F1",
    title: "Close the books in five days",
    level: "department",
    kind: "committed",
    spaceKey: "finance",
    championKey: "hugo",
    reviewerKey: "elena",
    standaloneReason: "Finance operating cadence the board relies on",
    keyResults: [
      {
        key: "F1.1",
        title: "Cut the month-end close from 9 working days to 5",
        direction: "reduce",
        indicatorType: "lagging",
        baselineValue: 9,
        targetValue: 5,
        unit: "days",
        ownerKey: "hugo",
        capacity: "fits",
      },
    ],
  },
];

/** The spaces that book Q1's weekly rhythm (NW-P-15). */
const RHYTHM_SPACES: readonly YearSpaceKey[] = [
  "company",
  "product",
  "customerSuccess",
  "engineering",
  "sales",
  "support",
  "marketing",
  "finance",
];

export const Q1_PLAN_EVENTS: readonly YearEvent[] = [
  {
    on: "2026-11-20",
    step: "NW-P-04",
    label: "Annual planning opens, and its input pack is gathered",
    async run(context) {
      const annual = await cycleHolding(
        context,
        `${context.realYear}-06-30`,
        "annual",
      );
      context.ids.cycles.set("annual", annual.id);
      for (let itemKey = 1; itemKey <= 7; itemKey += 1) {
        await callAction(context.action, "workflow.setPackItem", {
          cycleId: annual.id,
          itemKey,
          gathered: true,
        });
      }
    },
  },
  {
    on: "2026-11-26",
    step: "NW-P-04",
    label: "The annual pack distributed",
    async run(context) {
      await callAction(context.action, "workflow.distributePack", {
        cycleId: need(context.ids.cycles, "annual", "Cycle"),
      });
    },
  },
  {
    on: "2026-12-04",
    step: "NW-Q1-01",
    label: "Q1's planning opens, four weeks ahead",
    async run(context) {
      const q1 = await cycleHolding(
        context,
        context.real("2027-01-15"),
        "quarterly",
      );
      context.ids.cycles.set("q1", q1.id);
      await callAction(context.action, "cycles.update", {
        id: q1.id,
        sponsorId: need(context.ids.people, "elena", "Person"),
        facilitatorId: need(context.ids.people, "priya", "Person"),
      });
      // A light refresh of the annual pack.
      for (let itemKey = 1; itemKey <= 7; itemKey += 1) {
        await callAction(context.action, "workflow.setPackItem", {
          cycleId: q1.id,
          itemKey,
          gathered: true,
        });
      }
      await callAction(context.action, "workflow.distributePack", {
        cycleId: q1.id,
      });
    },
  },
  {
    on: "2026-12-15",
    step: "NW-Q1-02",
    label: "Q1's diagnosis: baseline health and four issues ranked",
    async run(context) {
      const cycleId = need(context.ids.cycles, "q1", "Cycle");
      await callAction(context.action, "workflow.setBaselineHealth", {
        cycleId,
        stable: richTextFromPlainText(
          "Uptime and logo retention are steady. Net revenue retention holds at 100%.",
        ),
        declining: richTextFromPlainText(
          "Support cost per account has grown faster than revenue per account for three quarters. Operating margin is 9.1% against 15%.",
        ),
        businessAsUsual: richTextFromPlainText(
          "Renewals, the SOC 2 preparation already under way, and the month-end close.",
        ),
      });
      for (const [text, impact] of [
        ["Onboarding speed: new accounts take nine days to reach value", 5],
        ["Support cost grows with the customer count", 5],
        ["Audit readiness for SOC 2 Type II", 4],
        ["Deal fit: accounts sold outside the profile do not onboard", 3],
      ] as const) {
        await callAction(context.action, "workflow.addIssue", {
          cycleId,
          text,
          impact,
          source: "manual",
        });
      }
    },
  },
  {
    on: "2026-12-16",
    step: "NW-Q1-03",
    label: "Q1's revalidation: the frame holds",
    async run(context) {
      await callAction(context.action, "workflow.setRevalidation", {
        cycleId: need(context.ids.cycles, "q1", "Cycle"),
        holds: true,
        changed: false,
        focusNote:
          "The first week, support load and audit readiness. Revalidated in forty minutes.",
      });
    },
  },
  {
    on: "2026-12-21",
    step: "NW-P-15",
    label: "Q1's whole rhythm booked",
    async run(context) {
      await bookRhythm(context, "q1", RHYTHM_SPACES);
    },
  },
  {
    on: "2026-12-22",
    step: "NW-Q1-04",
    label: "Q1's company objectives drafted",
    async run(context) {
      for (const objective of Q1_COMPANY) {
        await writeYearObjective(context, "q1", objective);
      }
    },
  },
  {
    on: "2026-12-23",
    step: "NW-Q1-05",
    label: "Q1's company step publishes",
    async run(context) {
      await callAction(context.action, "workflow.publish", {
        cycleId: need(context.ids.cycles, "q1", "Cycle"),
        step: "company",
      });
    },
  },
  {
    on: "2027-01-04",
    step: "NW-Q1-06",
    label: "The teams start drafting",
    async run(context) {
      for (const objective of Q1_TEAMS_FIRST) {
        await writeYearObjective(context, "q1", objective);
      }
    },
  },
  {
    on: "2027-01-05",
    step: "NW-Q1-07",
    label: "Amara's baseline key result, and Jonas's first draft",
    async run(context) {
      const endsOn = (await callAction(context.action, "cycles.list", {})).find(
        (cycle) => cycle.id === need(context.ids.cycles, "q1", "Cycle"),
      )?.endsOn;
      const added = await callAction(context.action, "goals.addKeyResult", {
        goalId: need(context.ids.goals, "P1", "Objective"),
        title: "Establish an onboarding NPS baseline",
        kind: "baseline",
        indicatorType: "lagging",
        ...(endsOn ? { dueOn: endsOn } : {}),
        ownerId: need(context.ids.people, "amara", "Person"),
        weight: 1,
      });
      context.ids.keyResults.set("P1.2", added.id);
      await writeYearObjective(context, "q1", S2_FIRST_DRAFT);
    },
  },
  {
    on: "2027-01-06",
    step: "NW-Q1-09",
    label: "Engineering drafts five objectives",
    async run(context) {
      for (const objective of Q1_ENGINEERING) {
        await writeYearObjective(context, "q1", objective);
      }
    },
  },
  {
    on: "2027-01-07",
    step: "NW-Q1-10",
    label: "Marketing aligns across, and Finance stands alone",
    async run(context) {
      for (const objective of Q1_TEAMS_LAST) {
        await writeYearObjective(context, "q1", objective);
      }
    },
  },
  {
    on: "2027-01-12",
    step: "NW-Q1-12",
    label: "The peer review: rewrites, two objectives cut, a duplicate deleted",
    async run(context) {
      // Jonas rewrites S2 as conversion and pipeline. A different measure
      // rather than an eased target, so the activity key results go and the
      // outcomes take their place.
      const q1EndsOn = (
        await callAction(context.action, "cycles.list", {})
      ).find(
        (cycle) => cycle.id === need(context.ids.cycles, "q1", "Cycle"),
      )?.endsOn;
      if (!q1EndsOn) {
        throw new Error("Q1 is not there to rewrite S2 in.");
      }
      const s2 = need(context.ids.goals, "S2", "Objective");
      for (const key of ["S2.1", "S2.2"]) {
        await callAction(context.action, "goals.removeKeyResult", {
          id: need(context.ids.keyResults, key, "Key result"),
        });
      }
      for (const keyResult of S2_REWRITTEN) {
        await addYearKeyResult(context, s2, keyResult, q1EndsOn);
      }
      // Engineering cuts five to three: the other two become initiatives.
      const engineering = need(context.ids.spaces, "engineering", "Space");
      for (const key of ["E4", "E5"]) {
        const objective = Q1_ENGINEERING.find((one) => one.key === key);
        await callAction(context.action, "goals.delete", {
          id: need(context.ids.goals, key, "Objective"),
        });
        if (objective) {
          await callAction(context.action, "initiatives.create", {
            spaceId: engineering,
            title: objective.title,
            ownerId: need(context.ids.people, "leo", "Person"),
            keyResultIds: [need(context.ids.keyResults, "E1.1", "Key result")],
          });
        }
      }
      // The duplicate of E3.1, deleted; P1 depends on E3 instead.
      await callAction(context.action, "goals.removeKeyResult", {
        id: need(context.ids.keyResults, "P1.3", "Key result"),
      });
      await callAction(context.action, "goals.addDependency", {
        fromGoalId: need(context.ids.goals, "P1", "Objective"),
        toGoalId: need(context.ids.goals, "E3", "Objective"),
        note: "Onboarding without us needs bulk import in one step.",
      });
    },
  },
  {
    on: "2027-01-13",
    step: "NW-Q1-13",
    label: "Dependencies declared and confirmed",
    async run(context) {
      // A link between two objectives has nothing to confirm; what Mei
      // confirms is the dependency of P1's key result on Engineering.
      const onboarding = await callAction(
        context.action,
        "goals.addKeyResultDependency",
        {
          keyResultId: need(context.ids.keyResults, "P1.1", "Key result"),
          providerSpaceId: need(context.ids.spaces, "engineering", "Space"),
          note: "Fewer setup calls depend on E3's bulk import.",
        },
      );
      context.ids.dependencies.set("P1.1-engineering", onboarding.id);
      await callAction(context.action, "goals.confirmDependency", {
        id: onboarding.id,
      });
      const deflection = await callAction(
        context.action,
        "goals.addKeyResultDependency",
        {
          keyResultId: need(context.ids.keyResults, "SU1.1", "Key result"),
          providerSpaceId: need(context.ids.spaces, "engineering", "Space"),
          note: "Deflection depends on E1's in-product answers.",
        },
      );
      context.ids.dependencies.set("SU1.1-engineering", deflection.id);
      await callAction(context.action, "goals.confirmDependency", {
        id: deflection.id,
      });
    },
  },
  {
    on: "2027-01-15",
    step: "NW-Q1-14",
    label: "The teams' step publishes, with its capacity cut",
    async run(context) {
      const cycleId = need(context.ids.cycles, "q1", "Cycle");
      await callAction(context.action, "workflow.setCapacityNotes", {
        cycleId,
        cuts: richTextFromPlainText(
          "The knowledge-base rewrite, cut so E1's in-product answers have the time they need.",
        ),
      });
      await callAction(context.action, "workflow.publish", {
        cycleId,
        step: "teams",
      });
    },
  },
];
