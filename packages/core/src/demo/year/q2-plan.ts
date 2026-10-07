/**
 * Q2's plan: the drafts Q1's close left, redrafted, and the set published in
 * two steps (P9-T22c-c-a, scenario chapter 2, NW-Q2-01 to NW-Q2-07).
 *
 * Q1's review kept eight objectives and modified three, and its close put all
 * eleven into Q2 as drafts with each key result starting from its last value
 * (§8.9). Leadership redrafts its two and adds C3 and C4, and publishes on
 * 29 March; the teams redraft theirs, add CS2 and F2, and publish on
 * 15 April. Labels are the chapter's, under `q2:` so they do not meet Q1's.
 */
import { callAction } from "../../actions/registry.ts";
import { writeYearObjective, type YearObjective } from "./okr.ts";
import type { YearSpaceKey } from "./people.ts";
import { type Carry, nameCarried, type Redraft, redraft } from "./redraft.ts";
import { bookRhythm } from "./rhythm.ts";
import { need, type YearEvent } from "./timeline.ts";

const COMPANY_REDRAFTS: readonly Redraft[] = [
  {
    key: "C1",
    parentGoal: "a1",
    keyResults: {
      "C1.1": {
        key: "q2:C1.1",
        title: "Cut median time to first value from 7 days to 5",
        targetValue: 5,
      },
      // The baseline is Sara's 56% of 22 March (NW-Q2-01), set below.
      "C1.2": {
        key: "q2:C1.2",
        title: "Raise 30-day activation from 56% to 62%",
        targetValue: 62,
      },
      // C1.3, guided setup, moves to Product as P1.1.
    },
  },
  {
    key: "C2",
    title: "Support cost per account falls while we grow",
    committed: true,
    parentGoal: "a2",
    keyResults: {
      "C2.1": {
        key: "q2:C2.1",
        title: "Cut support tickets per account from 2.55 to 2.3 a month",
        targetValue: 2.3,
      },
      "C2.2": {
        key: "q2:C2.2",
        title: "Cut support cost per account from $118 to $108 a month",
        targetValue: 108,
      },
      // C2.3 was the regression's, and the regression is behind us.
    },
  },
];

const COMPANY_NEW: readonly YearObjective[] = [
  {
    key: "q2:C3",
    title: "Pass the SOC 2 observation window clean",
    level: "company",
    kind: "committed",
    championKey: "mei",
    reviewerKey: "elena",
    parentGoal: "a3",
    keyResults: [
      {
        key: "q2:C3.1",
        title: "Hold open control exceptions at zero at every month-end",
        kind: "maintain",
        direction: "maintain",
        indicatorType: "lagging",
        baselineValue: 0,
        targetValue: 0,
        unit: "exceptions",
        ownerKey: "leo",
        capacity: "fits",
      },
      {
        key: "q2:C3.2",
        title:
          "Cut security questionnaire turnaround from 10 working days to 4",
        direction: "reduce",
        indicatorType: "leading",
        baselineValue: 10,
        targetValue: 4,
        unit: "days",
        ownerKey: "mei",
        capacity: "fits",
      },
    ],
  },
  {
    // Typed by hand: the copilot's draft is the same objective, and a seed
    // has no provider (NW-Q2-01).
    key: "q2:C4",
    title: "Expansion comes from accounts that reached value",
    level: "company",
    kind: "aspirational",
    championKey: "elena",
    reviewerKey: "priya",
    parentGoal: "a2",
    keyResults: [
      {
        key: "q2:C4.1",
        title: "Raise expansion seats added from 138 to 170 a month",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 138,
        targetValue: 170,
        unit: "seats",
        ownerKey: "tomas",
      },
      {
        key: "q2:C4.2",
        title: "Raise net revenue retention from 100% to 103%",
        direction: "increase",
        indicatorType: "lagging",
        baselineValue: 100,
        targetValue: 103,
        unit: "%",
        ownerKey: "hugo",
      },
    ],
  },
];

const TEAM_REDRAFTS: readonly Redraft[] = [
  {
    key: "P1",
    parentGoal: "q2:C1",
    keyResults: {
      "P1.1": {
        key: "q2:P1.2",
        title: "Cut manual setup calls per new account from 0.8 to 0.5",
        targetValue: 0.5,
      },
      // The NPS baseline was recorded in Q1, and its job is done.
    },
    added: [
      {
        key: "q2:P1.1",
        title: "Raise guided setup completed from 72% to 80% of new accounts",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 72,
        targetValue: 80,
        unit: "%",
        ownerKey: "sara",
      },
    ],
  },
  {
    key: "P2",
    parentGoal: "q2:C1",
    keyResults: {
      // A count of this quarter's weeks, so it starts again from nothing.
      "P2.1": {
        key: "q2:P2.1",
        title: "Publish the weekly cohort report in 13 of 13 weeks",
        baselineValue: 0,
        targetValue: 13,
      },
    },
  },
  {
    key: "E1",
    parentKeyResult: "q2:C2.1",
    keyResults: {
      "E1.1": {
        key: "q2:E1.1",
        title:
          "Ship in-product answers for 12 of the repeated questions, from 10",
      },
      "E1.2": {
        key: "q2:E1.2",
        title: "Cut p95 setup API latency from 450ms to 380ms",
        targetValue: 380,
      },
    },
  },
  {
    key: "E2",
    committed: true,
    parentGoal: "q2:C3",
    keyResults: {
      "E2.1": {
        key: "q2:E2.1",
        title: "Hold uptime at or above 99.9% every month",
      },
      "E2.2": {
        key: "q2:E2.2",
        title: "Cut mean time to restore from 50 minutes to 45",
      },
    },
  },
  {
    key: "S1",
    parentGoal: "q2:C1",
    keyResults: {
      "S1.1": {
        key: "q2:S1.1",
        title: "Raise new deals inside the target profile from 76% to 82%",
        targetValue: 82,
      },
      "S1.2": {
        key: "q2:S1.2",
        title: "Cut days from signature to kickoff from 5 to 4",
      },
    },
  },
  {
    key: "S2",
    parentGoal: "q2:S1",
    keyResults: {
      "S2.2": {
        key: "q2:S2.1",
        title: "Grow qualified mid-market pipeline from $2.6M to $3.4M",
        targetValue: 3.4,
      },
      "S2.1": {
        key: "q2:S2.2",
        title: "Raise call-to-meeting conversion from 10% to 12%",
      },
    },
  },
  {
    key: "CS1",
    parentGoal: "a2",
    keyResults: {
      "CS1.2": {
        key: "q2:CS1.1",
        title: "Flag renewals 90 days out for 90% of accounts, from 74%",
      },
      "CS1.1": {
        key: "q2:CS1.2",
        title:
          "Raise accounts over $10k with a health reading under 30 days old from 96% to 100%",
      },
    },
  },
  {
    key: "SU1",
    parentKeyResult: "q2:C2.1",
    keyResults: {
      "SU1.1": {
        key: "q2:SU1.1",
        title: "Raise self-serve deflection from 22% to 30%",
        targetValue: 30,
      },
      // The help-centre links did their job; Q2 measures deflection alone.
    },
  },
  {
    // Nadia's first draft is a deliverable (NW-Q2-06): renamed on the day it
    // is refused, below.
    key: "M1",
    title: "Run the target-profile webinar series",
    parentGoal: "q2:S1",
    keyResults: {},
    added: [
      {
        key: "q2:M1.1",
        title:
          "Raise target-profile lead to sales-qualified conversion from 18% to 25%",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 18,
        targetValue: 25,
        unit: "%",
        ownerKey: "nadia",
      },
    ],
  },
];

const TEAMS_NEW: readonly YearObjective[] = [
  {
    key: "q2:CS2",
    title: "Accounts that reached value grow with us",
    level: "department",
    kind: "aspirational",
    spaceKey: "customerSuccess",
    championKey: "tomas",
    reviewerKey: "elena",
    parentGoal: "q2:C4",
    keyResults: [
      {
        key: "q2:CS2.1",
        title:
          "Grow expansion pipeline from value-reached accounts from $0.4M to $0.8M",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 0.4,
        targetValue: 0.8,
        unit: "$M",
        ownerKey: "tomas",
      },
    ],
  },
  {
    key: "q2:F2",
    title: "Publish weekly spend views to budget owners",
    level: "department",
    kind: "committed",
    spaceKey: "finance",
    championKey: "hugo",
    reviewerKey: "elena",
    standaloneReason: "Finance operating cadence",
    keyResults: [
      {
        key: "q2:F2.1",
        title: "Give 12 of 12 budget owners a weekly spend view, from 0",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 0,
        targetValue: 12,
        unit: "owners",
        ownerKey: "hugo",
        capacity: "fits",
      },
    ],
  },
];

/** Engineering's third objective, drafted over the cap and moved (NW-Q2-04). */
const BUILD_TIME: YearObjective = {
  key: "q2:E3",
  title: "Halve the build time",
  level: "team",
  kind: "aspirational",
  spaceKey: "engineering",
  championKey: "leo",
  parentGoal: "q2:C2",
  keyResults: [
    {
      key: "q2:E3.1",
      title: "Cut the main build from 22 minutes to 11",
      direction: "reduce",
      indicatorType: "leading",
      baselineValue: 22,
      targetValue: 11,
      unit: "minutes",
      ownerKey: "leo",
    },
  ],
};

/** The spaces that book Q2's weekly rhythm, as Q1's did. */
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

/** Q1's close carried into Q2. */
const INTO_Q2: Carry = { from: "", to: "q2" };

export const Q2_PLAN_EVENTS: readonly YearEvent[] = [
  {
    on: "2027-03-19",
    step: "NW-Q2-01",
    label: "Q1's kept and modified objectives arrive in Q2 as drafts",
    async run(context) {
      await nameCarried(context, INTO_Q2, [
        "C1",
        "C2",
        "P1",
        "P2",
        "E1",
        "E2",
        "S1",
        "S2",
        "CS1",
        "SU1",
        "M1",
      ]);
    },
  },
  {
    on: "2027-03-22",
    step: "NW-Q2-01",
    label: "Sara's 56% becomes C1.2's starting point",
    async run(context) {
      // The three missing days of March's cohort landed, and with them
      // activation reads 56% (NW-Q1-26). Q1 had closed, so it is Q2's
      // starting point that moves.
      await callAction(context.action, "goals.updateKeyResult", {
        id: need(context.ids.keyResults, "q2-from:C1.2", "Key result"),
        baselineValue: 56,
      });
    },
  },
  {
    on: "2027-03-24",
    step: "NW-Q2-01",
    label: "Q2's company objectives drafted",
    async run(context) {
      for (const edit of COMPANY_REDRAFTS) {
        await redraft(context, INTO_Q2, edit);
      }
      for (const objective of COMPANY_NEW) {
        await writeYearObjective(context, "q2", objective);
      }
    },
  },
  {
    on: "2027-03-29",
    step: "NW-Q2-01",
    label: "Q2's company step publishes",
    async run(context) {
      await callAction(context.action, "workflow.publish", {
        cycleId: need(context.ids.cycles, "q2", "Cycle"),
        step: "company",
      });
    },
  },
  {
    on: "2027-03-30",
    label: "Q2's whole rhythm booked",
    async run(context) {
      await bookRhythm(context, "q2", RHYTHM_SPACES);
    },
  },
  {
    on: "2027-04-05",
    step: "NW-Q2-04",
    label: "The teams redraft what Q1 left them, and add two",
    async run(context) {
      for (const edit of TEAM_REDRAFTS) {
        await redraft(context, INTO_Q2, edit);
      }
      for (const objective of TEAMS_NEW) {
        await writeYearObjective(context, "q2", objective);
      }
    },
  },
  {
    on: "2027-04-07",
    step: "NW-Q2-04",
    label: "Engineering drafts a third objective, over the cap",
    async run(context) {
      await writeYearObjective(context, "q2", BUILD_TIME);
    },
  },
  {
    on: "2027-04-09",
    step: "NW-Q2-04",
    label: "The build time moves to an initiative under E1",
    async run(context) {
      await callAction(context.action, "goals.delete", {
        id: need(context.ids.goals, BUILD_TIME.key, "Objective"),
      });
      await callAction(context.action, "initiatives.create", {
        spaceId: need(context.ids.spaces, "engineering", "Space"),
        title: BUILD_TIME.title,
        ownerId: need(context.ids.people, "leo", "Person"),
        keyResultIds: [need(context.ids.keyResults, "q2:E1.2", "Key result")],
      });
    },
  },
  {
    on: "2027-04-12",
    step: "NW-Q2-05",
    label: "Yuki follows P1",
    async run(context) {
      await callAction(context.action, "subscriptions.importWatcher", {
        subjectType: "goal",
        subjectId: need(context.ids.goals, "q2:P1", "Objective"),
        memberId: need(context.ids.people, "yuki", "Person"),
        reason: "role",
      });
    },
  },
  {
    on: "2027-04-14",
    step: "NW-Q2-07",
    label: "CS2 depends on Product's in-app expansion prompts",
    async run(context) {
      const dependency = await callAction(
        context.action,
        "goals.addKeyResultDependency",
        {
          keyResultId: need(context.ids.keyResults, "q2:CS2.1", "Key result"),
          providerSpaceId: need(context.ids.spaces, "product", "Space"),
          note: "Expansion pipeline needs Product's in-app expansion prompts.",
        },
      );
      context.ids.dependencies.set("q2:CS2.1-product", dependency.id);
    },
  },
  {
    on: "2027-04-15",
    step: "NW-Q2-06",
    label: "The teams' step publishes, past OBJ-1 for F2 with Elena's reason",
    async run(context) {
      // Marketing's draft is refused by OBJ-1 at block, and Nadia rewrites
      // it the same morning; the refusal itself leaves nothing.
      await callAction(context.action, "goals.update", {
        id: need(context.ids.goals, "q2:M1", "Objective"),
        title: "Leads that turn into deals",
      });
      await callAction(context.action, "workflow.publish", {
        cycleId: need(context.ids.cycles, "q2", "Cycle"),
        step: "teams",
        override: {
          reason:
            "A reporting deliverable the board asked for; its outcome is in F2.1",
        },
      });
    },
  },
  {
    on: "2027-04-19",
    step: "NW-Q2-07",
    label: "The unconfirmed dependency escalated, and confirmed",
    async run(context) {
      const id = need(
        context.ids.dependencies,
        "q2:CS2.1-product",
        "Dependency",
      );
      await callAction(context.action, "goals.escalateDependency", { id });
      // Elena decides Product delivers the prompts by week 8, and Priya
      // confirms.
      await callAction(context.action, "goals.confirmDependency", { id });
    },
  },
];
