/**
 * Q4's plan and its first ten weeks' events (P9-T22c-e-a, scenario chapter 4,
 * NW-Q4-01 to NW-Q4-05).
 *
 * Q3's close carried nine objectives into Q4. Expansion returns first on the
 * issue list and becomes C8; CS1, achieved, is raised to company level as C7
 * for renewal season; C2 becomes the merged team's CS3 in Customer Success.
 * The company step publishes on 27 September at the cap of five, and the
 * teams' on 14 October. Mei returns on 25 October and takes E1 back. On
 * 3 December a failover fails, uptime turns unhealthy, and Leo answers it
 * with "fix it now".
 */
import { callAction } from "../../actions/registry.ts";
import { writeYearObjective, type YearObjective } from "./okr.ts";
import type { YearSpaceKey } from "./people.ts";
import { type Carry, nameCarried, type Redraft, redraft } from "./redraft.ts";
import { bookRhythm } from "./rhythm.ts";
import { need, type YearEvent } from "./timeline.ts";

/** Q3's close carried into Q4. */
const INTO_Q4: Carry = { from: "q3", to: "q4" };

const COMPANY_REDRAFTS: readonly Redraft[] = [
  {
    key: "C1",
    parentGoal: "a1",
    keyResults: {
      "q3:C1.1": {
        key: "q4:C1.1",
        title: "Cut median time to first value from 4.4 days to 3.5",
        targetValue: 3.5,
      },
      "q3:C1.2": {
        key: "q4:C1.2",
        title: "Raise 30-day activation from 63% to 68%",
        targetValue: 68,
      },
    },
  },
  {
    key: "C5",
    parentGoal: "a4",
    keyResults: {
      "q3:C5.1": {
        key: "q4:C5.1",
        title: "Raise win rate against Brightline from 43% to 50%",
        targetValue: 50,
      },
    },
  },
  {
    key: "C6",
    committed: true,
    parentGoal: "a2",
    keyResults: {
      // September's reading, which the KPI records on 5 October.
      "q3:C6.1": {
        key: "q4:C6.1",
        title: "Raise operating margin from 10.4% to 13.5%",
        baselineValue: 10.4,
      },
      "q3:C6.3": {
        key: "q4:C6.2",
        title: "Cut the average renewal discount from 7% to 6%",
      },
      // Expansion seats is C8's now.
    },
  },
];

const COMPANY_NEW: readonly YearObjective[] = [
  {
    key: "q4:C7",
    title: "No customer is surprised by their own renewal",
    description:
      "Raised from CS1, achieved in Q3, to company level for renewal season.",
    level: "company",
    kind: "committed",
    championKey: "tomas",
    reviewerKey: "elena",
    parentGoal: "a2",
    keyResults: [
      {
        key: "q4:C7.1",
        title: "Flag renewals 90 days out for 100% of accounts, from 95%",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 95,
        targetValue: 100,
        unit: "%",
        ownerKey: "tomas",
        capacity: "fits",
      },
      {
        key: "q4:C7.2",
        title: "Hold gross revenue retention at or above 92% every month",
        kind: "maintain",
        direction: "maintain",
        indicatorType: "lagging",
        baselineValue: 92,
        targetValue: 100,
        unit: "%",
        ownerKey: "tomas",
        capacity: "fits",
      },
    ],
  },
  {
    key: "q4:C8",
    title: "Expansion comes from accounts that reached value",
    description: "Returned from CS2, deferred in Q2.",
    level: "company",
    kind: "aspirational",
    championKey: "tomas",
    reviewerKey: "priya",
    parentGoal: "a2",
    keyResults: [
      {
        key: "q4:C8.1",
        title: "Raise expansion seats added from 158 to 200 a month",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 158,
        targetValue: 200,
        unit: "seats",
        ownerKey: "tomas",
        kpiKey: "expansionSeats",
      },
      {
        key: "q4:C8.2",
        title: "Raise net revenue retention from 101% to 104%",
        direction: "increase",
        indicatorType: "lagging",
        baselineValue: 101,
        targetValue: 104,
        unit: "%",
        ownerKey: "hugo",
        kpiKey: "nrr",
      },
    ],
  },
];

const TEAM_REDRAFTS: readonly Redraft[] = [
  {
    key: "P4",
    parentGoal: "q4:C1",
    keyResults: {
      "q3:P4.1": {
        key: "q4:P4.1",
        title: "Raise setup completed in the first session from 55% to 65%",
        targetValue: 65,
      },
    },
  },
  {
    key: "G1",
    parentGoal: "q4:C1",
    keyResults: {
      "q3:G1.2": {
        key: "q4:G1.2",
        title: "Raise self-serve trial-to-paid conversion from 5.2% to 7%",
      },
      // G1.1 found its number in Q3.
    },
  },
  {
    // Modified: renewal and billing questions, for renewal season.
    key: "E1",
    parentGoal: "q4:C7",
    keyResults: {},
    added: [
      {
        key: "q4:E1.1",
        title: "Answer 8 renewal and billing questions in the product, from 2",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 2,
        targetValue: 8,
        unit: "answers",
        ownerKey: "leo",
      },
    ],
  },
  {
    key: "E2",
    committed: true,
    parentGoal: "a3",
    keyResults: {
      "q3:E2.1": {
        key: "q4:E2.1",
        title: "Hold uptime at or above 99.9% every month",
      },
      "q3:E2.2": {
        key: "q4:E2.2",
        title: "Cut mean time to restore from 38 minutes to 35",
        targetValue: 35,
      },
    },
  },
  {
    key: "S3",
    parentGoal: "q4:C5",
    keyResults: {
      "q3:S3.1": {
        key: "q4:S3.1",
        title: "Raise late-stage win rate against Brightline from 46% to 55%",
        targetValue: 55,
      },
    },
  },
];

/** C2 becomes the merged team's committed objective (NW-Q4-01). */
const CS3: Redraft = {
  // C2 becomes the merged team's committed objective (NW-Q4-01).
  key: "C2",
  title: "Support costs less per account, run from Customer Success",
  committed: true,
  parentGoal: "a2",
  keyResults: {
    "q3:C2.1": {
      key: "q4:CS3.1",
      title: "Cut support cost per account from $101 to $95 a month",
      baselineValue: 101,
      targetValue: 95,
    },
    // Tickets per account met its target; deflection measures the merged team.
  },
  added: [
    {
      key: "q4:CS3.2",
      title: "Raise self-serve deflection from 31% to 35%",
      direction: "increase",
      indicatorType: "leading",
      baselineValue: 31,
      targetValue: 35,
      unit: "%",
      ownerKey: "kofi",
      kpiKey: "deflection",
      capacity: "fits",
    },
  ],
};

const F4: YearObjective = {
  key: "q4:F4",
  title: "Plan 2028 on numbers the board trusts",
  level: "department",
  kind: "committed",
  spaceKey: "finance",
  championKey: "hugo",
  reviewerKey: "elena",
  standaloneReason: "Annual planning cadence",
  keyResults: [
    {
      key: "q4:F4.1",
      title: "Board-approved 2028 plan by 9 December",
      kind: "milestone",
      indicatorType: "lagging",
      ownerKey: "hugo",
      dueOn: "2027-12-09",
      capacity: "fits",
    },
  ],
};

/** The spaces that book Q4's rhythm: Support has merged, Growth has formed. */
const RHYTHM_SPACES: readonly YearSpaceKey[] = [
  "company",
  "product",
  "customerSuccess",
  "engineering",
  "sales",
  "marketing",
  "finance",
  "growth",
];

export const Q4_PLAN_EVENTS: readonly YearEvent[] = [
  {
    on: "2027-09-17",
    step: "NW-Q4-01",
    label:
      "Q3's kept and modified objectives arrive in Q4, and expansion comes first",
    async run(context) {
      await nameCarried(context, INTO_Q4, [
        "C1",
        "C5",
        "C6",
        "P4",
        "G1",
        "E1",
        "E2",
        "S3",
        "C2",
      ]);
      // CS2's expansion, deferred in Q2, ranked first now the new price
      // book changed its economics (NW-Q3-16).
      await callAction(context.action, "workflow.addIssue", {
        cycleId: need(context.ids.cycles, "q4", "Cycle"),
        text: "Expansion from the accounts that reached value",
        impact: 5,
        source: "manual",
      });
    },
  },
  {
    on: "2027-09-22",
    step: "NW-Q4-01",
    label:
      "Q4's company objectives drafted, five at the cap, and C2 to Customer Success",
    async run(context) {
      for (const edit of COMPANY_REDRAFTS) {
        await redraft(context, INTO_Q4, edit);
      }
      for (const objective of COMPANY_NEW) {
        await writeYearObjective(context, "q4", objective);
      }
      // C2 leaves the company set for Customer Success before the company
      // step publishes, so the step reads the five that stay.
      const cs3 = need(context.ids.goals, "q4:C2", "Objective");
      await callAction(context.action, "goals.moveToSpace", {
        id: cs3,
        spaceId: need(context.ids.spaces, "customerSuccess", "Space"),
      });
      await callAction(context.action, "goals.update", {
        id: cs3,
        level: "team",
      });
      context.ids.goals.set("q4:CS3", cs3);
      await redraft(context, INTO_Q4, CS3);
    },
  },
  {
    on: "2027-09-27",
    step: "NW-Q4-01",
    label: "Q4's company step publishes",
    async run(context) {
      await callAction(context.action, "workflow.publish", {
        cycleId: need(context.ids.cycles, "q4", "Cycle"),
        step: "company",
      });
    },
  },
  {
    on: "2027-09-28",
    label: "Q4's whole rhythm booked",
    async run(context) {
      await bookRhythm(context, "q4", RHYTHM_SPACES);
    },
  },
  {
    on: "2027-10-04",
    step: "NW-Q4-01",
    label: "The teams redraft what Q3 left them, and Finance adds F4",
    async run(context) {
      for (const edit of TEAM_REDRAFTS) {
        await redraft(context, INTO_Q4, edit);
      }
      await writeYearObjective(context, "q4", F4);
    },
  },
  {
    on: "2027-10-14",
    label: "Q4's teams' step publishes",
    async run(context) {
      await callAction(context.action, "workflow.publish", {
        cycleId: need(context.ids.cycles, "q4", "Cycle"),
        step: "teams",
      });
    },
  },
  {
    on: "2027-10-25",
    step: "NW-Q4-02",
    label: "Mei returns, and Leo hands E1 back",
    async run(context) {
      const mei = need(context.ids.people, "mei", "Person");
      await callAction(context.action, "goals.reassignRole", {
        id: need(context.ids.goals, "q4:E1", "Objective"),
        role: "champion",
        memberId: mei,
      });
      await callAction(context.action, "goals.updateKeyResult", {
        id: need(context.ids.keyResults, "q4:E1.1", "Key result"),
        ownerId: mei,
      });
    },
  },
  {
    on: "2027-12-03",
    step: "NW-Q4-04",
    label: "The failover fails: uptime unhealthy, and Leo fixes it now",
    async run(context) {
      const uptime = need(context.ids.kpis, "uptime", "KPI");
      await callAction(context.action, "kpis.record", {
        kpiId: uptime,
        on: context.real("2027-12-03"),
        actualValue: 99.4,
        remark: "A database failover failed: four hours down.",
      });
      // A defect, not a strategy: a task with an owner and a date, and no
      // recovery objective.
      const task = await callAction(context.action, "tasks.create", {
        spaceId: need(context.ids.spaces, "engineering", "Space"),
        title: "Failover runbook and a tested replica",
        keyResultId: need(context.ids.keyResults, "q4:E2.1", "Key result"),
        dueOn: context.real("2027-12-17"),
        assigneeIds: [need(context.ids.people, "leo", "Person")],
      });
      await callAction(context.action, "kpis.recordResponse", {
        kpiId: uptime,
        kind: "fix_now",
        taskId: task.id,
      });
    },
  },
];
