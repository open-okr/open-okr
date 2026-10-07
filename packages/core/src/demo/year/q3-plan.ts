/**
 * Q3's plan and the margin recovery (P9-T22c-d-a, scenario chapter 3,
 * NW-Q3-01 to NW-Q3-04).
 *
 * Q2's close carried eleven objectives into Q3. Phase 2 ranks the issues
 * with the deferred expansion below the two that come first, leadership
 * redrafts its three and adds C3, and the company step publishes on 28 June.
 * June's readings make operating margin and expansion seats unhealthy for a
 * second month, and on 6 July C6 is launched from the margin KPI, inside the
 * publication window. The teams redraft theirs, add S3 and F3, and publish
 * on 14 July. Labels are the chapter's, under `q3:`.
 */
import { callAction } from "../../actions/registry.ts";
import {
  addYearKeyResult,
  writeYearObjective,
  type YearObjective,
} from "./okr.ts";
import type { YearSpaceKey } from "./people.ts";
import {
  type Carry,
  cycleEndsOn,
  nameCarried,
  type Redraft,
  redraft,
} from "./redraft.ts";
import { bookRhythm } from "./rhythm.ts";
import { need, type YearEvent } from "./timeline.ts";

/** Q2's close carried into Q3. */
const INTO_Q3: Carry = { from: "q2", to: "q3" };

const COMPANY_REDRAFTS: readonly Redraft[] = [
  {
    key: "C1",
    parentGoal: "a1",
    keyResults: {
      "q2:C1.1": {
        key: "q3:C1.1",
        title: "Cut median time to first value from 5.5 days to 4",
        targetValue: 4,
      },
      "q2:C1.2": {
        key: "q3:C1.2",
        title: "Raise 30-day activation from 59% to 64%",
        targetValue: 64,
      },
    },
  },
  {
    key: "C2",
    committed: true,
    parentGoal: "a2",
    keyResults: {
      // Support cost as June closes; the KPI records the same $109 on 5 July.
      "q2:C2.2": {
        key: "q3:C2.1",
        title: "Cut support cost per account from $109 to $100 a month",
        baselineValue: 109,
        targetValue: 100,
      },
      "q2:C2.1": {
        key: "q3:C2.2",
        title: "Cut support tickets per account from 2.32 to 2.2 a month",
        targetValue: 2.2,
      },
    },
  },
  {
    key: "C5",
    parentGoal: "a4",
    keyResults: {
      "q2:C5.4": {
        key: "q3:C5.1",
        title: "Raise win rate against Brightline from 38% to 45%",
        ownerKey: "daniel",
      },
      "q2:C5.2": {
        key: "q3:C5.2",
        title: "Cut late-stage deals lost to Brightline from 1 to 0 a month",
      },
      // The baseline C5.1 found and the battlecard's adoption did their job.
    },
  },
];

const C3: YearObjective = {
  key: "q3:C3",
  title: "Put the SOC 2 Type II report in customers' hands",
  level: "company",
  kind: "committed",
  championKey: "mei",
  reviewerKey: "elena",
  parentGoal: "a3",
  keyResults: [
    {
      key: "q3:C3.1",
      title: "SOC 2 Type II report issued by 15 September",
      kind: "milestone",
      indicatorType: "lagging",
      ownerKey: "mei",
      dueOn: "2027-09-15",
      capacity: "fits",
    },
    {
      key: "q3:C3.2",
      title: "Cut security questionnaire turnaround from 4 working days to 2",
      direction: "reduce",
      indicatorType: "leading",
      baselineValue: 4,
      targetValue: 2,
      unit: "days",
      ownerKey: "leo",
      capacity: "fits",
    },
  ],
};

const TEAM_REDRAFTS: readonly Redraft[] = [
  {
    // P1 becomes P4: guided setup measured in the first session.
    key: "P1",
    title: "The first session shows value without a call",
    parentGoal: "q3:C1",
    keyResults: {
      "q2:P1.2": {
        key: "q3:P4.2",
        title: "Cut manual setup calls per new account from 0.6 to 0.3",
        targetValue: 0.3,
      },
    },
    added: [
      {
        key: "q3:P4.1",
        title:
          "Raise new accounts completing setup in their first session from 40% to 60%",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 40,
        targetValue: 60,
        unit: "%",
        ownerKey: "sara",
      },
    ],
  },
  {
    key: "P2",
    parentGoal: "q3:C1",
    keyResults: {
      "q2:P2.1": {
        key: "q3:P2.1",
        title: "Publish the weekly cohort report in 13 of 13 weeks",
        baselineValue: 0,
        targetValue: 13,
      },
    },
  },
  {
    key: "E1",
    title: "Take the repeated questions out of the product",
    parentGoal: "q3:C2",
    keyResults: {
      "q2:E1.1": {
        key: "q3:E1.1",
        title: "Answer 20 of the top-20 questions in the product, from 11",
        baselineValue: 11,
        targetValue: 20,
      },
    },
  },
  {
    key: "E2",
    committed: true,
    parentGoal: "q3:C3",
    keyResults: {
      "q2:E2.1": {
        key: "q3:E2.1",
        title: "Hold uptime at or above 99.9% every month",
      },
      "q2:E2.2": {
        key: "q3:E2.2",
        title: "Cut mean time to restore from 45 minutes to 40",
        targetValue: 40,
      },
    },
  },
  {
    key: "S1",
    parentGoal: "q3:C1",
    keyResults: {
      "q2:S1.1": {
        key: "q3:S1.1",
        title: "Raise new deals inside the target profile from 79% to 84%",
        targetValue: 84,
      },
      "q2:S1.2": {
        key: "q3:S1.2",
        title: "Cut days from signature to kickoff from 4.5 to 4",
      },
    },
  },
  {
    key: "CS1",
    parentGoal: "a2",
    keyResults: {
      "q2:CS1.1": {
        key: "q3:CS1.1",
        title: "Flag renewals 90 days out for 95% of accounts, from 80%",
        targetValue: 95,
      },
    },
  },
  {
    key: "SU1",
    parentGoal: "q3:C2",
    keyResults: {
      "q2:SU1.1": {
        key: "q3:SU1.1",
        title: "Raise self-serve deflection from 27% to 33%",
        targetValue: 33,
      },
    },
  },
  {
    key: "M1",
    title: "Brightline's buyers hear our story first",
    parentGoal: "q3:C5",
    keyResults: {},
    added: [
      {
        key: "q3:M1.1",
        title:
          "Raise target-profile opportunities that saw the comparison page from 20% to 60%",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 20,
        targetValue: 60,
        unit: "%",
        ownerKey: "nadia",
      },
    ],
  },
];

const S3: YearObjective = {
  key: "q3:S3",
  title: "Win the late-stage deals against Brightline",
  level: "team",
  kind: "aspirational",
  spaceKey: "sales",
  championKey: "jonas",
  parentGoal: "q3:C5",
  keyResults: [
    {
      key: "q3:S3.1",
      title: "Raise late-stage win rate against Brightline from 41% to 50%",
      direction: "increase",
      indicatorType: "lagging",
      baselineValue: 41,
      targetValue: 50,
      unit: "%",
      ownerKey: "jonas",
    },
  ],
};

const F3: YearObjective = {
  key: "q3:F3",
  title: "Price for the margin we need",
  level: "department",
  kind: "committed",
  spaceKey: "finance",
  championKey: "hugo",
  reviewerKey: "elena",
  parentGoal: "q3:C6",
  keyResults: [
    {
      key: "q3:F3.1",
      title: "Pricing review approved by 31 August",
      kind: "milestone",
      indicatorType: "leading",
      ownerKey: "hugo",
      dueOn: "2027-08-31",
      capacity: "fits",
    },
    {
      key: "q3:F3.2",
      title: "New price book live for renewals from 1 September",
      kind: "milestone",
      indicatorType: "leading",
      ownerKey: "hugo",
      dueOn: "2027-09-01",
      capacity: "fits",
    },
  ],
};

/** The spaces that book Q3's rhythm: Support until it merges. */
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

/**
 * C6, launched from the margin KPI and then shaped by Hugo (NW-Q3-04).
 *
 * The launch drafts §6.5's recovery: committed, its objective without a
 * number, the KPI itself first and the leading drivers under it after. The
 * semantic review finds tickets per account and deflection already owned by
 * C2.2 and SU1.1, so Hugo removes both and adds the renewal discount; the
 * expansion seats driver is the second response, which Tomás records.
 */
const C6_ADDED = [
  {
    key: "q3:C6.2",
    title: "Raise expansion seats added from 125 to 170 a month",
    direction: "increase" as const,
    indicatorType: "leading" as const,
    baselineValue: 125,
    targetValue: 170,
    unit: "seats",
    ownerKey: "tomas" as const,
    kpiKey: "expansionSeats" as const,
    capacity: "fits" as const,
  },
  {
    key: "q3:C6.3",
    title: "Cut the average renewal discount from 14% to 6%",
    direction: "reduce" as const,
    indicatorType: "leading" as const,
    baselineValue: 14,
    targetValue: 6,
    unit: "%",
    ownerKey: "daniel" as const,
    capacity: "fits" as const,
  },
];

export const Q3_PLAN_EVENTS: readonly YearEvent[] = [
  {
    on: "2027-06-21",
    step: "NW-Q3-01",
    label:
      "Q2's kept and modified objectives arrive in Q3 as drafts, and Phase 2 ranks",
    // After the revalidation of the same day (NW-Q2-22).
    order: 10,
    async run(context) {
      await nameCarried(context, INTO_Q3, [
        "C1",
        "C2",
        "C5",
        "P1",
        "P2",
        "E1",
        "E2",
        "S1",
        "CS1",
        "SU1",
        "M1",
      ]);
      // Expansion is already on the list, deferred from Q2 at the
      // carry-forward impact; it stays below the two that come first.
      const cycleId = need(context.ids.cycles, "q3", "Cycle");
      for (const [text, impact] of [
        ["Brightline is taking mid-market deals on price", 5],
        ["Operating margin is below the lender's floor", 5],
        ["Activation is still short of the year's 70%", 4],
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
    on: "2027-06-24",
    step: "NW-Q3-01",
    label: "Q3's company objectives drafted, C2 committed again",
    async run(context) {
      for (const edit of COMPANY_REDRAFTS) {
        await redraft(context, INTO_Q3, edit);
      }
      // Committed again now the two agents are back in July (NW-Q2-21).
      await callAction(context.action, "goals.setKind", {
        id: need(context.ids.goals, "q3:C2", "Objective"),
        kind: "committed",
        reason:
          "The two support agents are back from the competitive response in July.",
      });
      await writeYearObjective(context, "q3", C3);
    },
  },
  {
    on: "2027-06-28",
    step: "NW-Q3-01",
    label: "Q3's company step publishes",
    async run(context) {
      await callAction(context.action, "workflow.publish", {
        cycleId: need(context.ids.cycles, "q3", "Cycle"),
        step: "company",
      });
    },
  },
  {
    on: "2027-06-29",
    label: "Q3's whole rhythm booked",
    async run(context) {
      await bookRhythm(context, "q3", RHYTHM_SPACES);
    },
  },
  {
    on: "2027-07-05",
    step: "NW-Q3-04",
    label: "The teams redraft what Q2 left them, and add S3",
    async run(context) {
      for (const edit of TEAM_REDRAFTS) {
        await redraft(context, INTO_Q3, edit);
      }
      // P1 is P4 from here on.
      context.ids.goals.set(
        "q3:P4",
        need(context.ids.goals, "q3:P1", "Objective"),
      );
      await writeYearObjective(context, "q3", S3);
    },
  },
  {
    on: "2027-07-06",
    step: "NW-Q3-04",
    label: "C6 launched from the margin KPI, and expansion answered by C6.2",
    async run(context) {
      const cycleId = need(context.ids.cycles, "q3", "Cycle");
      const launched = await callAction(context.action, "kpis.launchRecovery", {
        kpiId: need(context.ids.kpis, "operatingMargin", "KPI"),
        cycleId,
        objectiveTitle: "Margins we can run the business on again",
      });
      const c6 = launched.goalId;
      context.ids.goals.set("q3:C6", c6);
      await callAction(context.action, "goals.update", {
        id: c6,
        level: "company",
        parentGoalId: need(context.ids.goals, "a2", "Objective"),
      });
      await callAction(context.action, "goals.reassignRole", {
        id: c6,
        role: "champion",
        memberId: need(context.ids.people, "hugo", "Person"),
      });
      await callAction(context.action, "goals.reassignRole", {
        id: c6,
        role: "reviewer",
        memberId: need(context.ids.people, "elena", "Person"),
      });
      const endsOn = await cycleEndsOn(context, "q3");
      const marginKpi = need(context.ids.kpis, "operatingMargin", "KPI");
      const drafted = await callAction(context.action, "goals.read", {
        id: c6,
      });
      for (const keyResult of drafted.keyResults) {
        if (keyResult.kpiId === marginKpi) {
          // The KPI itself, from June's 7.6% to its healthy 13.5%.
          context.ids.keyResults.set("q3:C6.1", keyResult.id);
          await callAction(context.action, "goals.updateKeyResult", {
            id: keyResult.id,
            ownerId: need(context.ids.people, "hugo", "Person"),
            dueOn: endsOn,
            capacity: "fits",
          });
        } else {
          // "These two claim the same movement": C2.2 and SU1.1 own them.
          await callAction(context.action, "goals.removeKeyResult", {
            id: keyResult.id,
          });
        }
      }
      for (const keyResult of C6_ADDED) {
        await addYearKeyResult(context, c6, keyResult, endsOn);
      }
      // Expansion seats' response is the second one: a key result, C6.2.
      await callAction(context.action, "kpis.recordResponse", {
        kpiId: need(context.ids.kpis, "expansionSeats", "KPI"),
        kind: "key_result",
        keyResultId: need(context.ids.keyResults, "q3:C6.2", "Key result"),
      });
    },
  },
  {
    on: "2027-07-08",
    step: "NW-Q3-04",
    label: "Finance drafts F3 under C6",
    async run(context) {
      await writeYearObjective(context, "q3", F3);
    },
  },
  {
    on: "2027-07-14",
    label: "Q3's teams' step publishes",
    async run(context) {
      await callAction(context.action, "workflow.publish", {
        cycleId: need(context.ids.cycles, "q3", "Cycle"),
        step: "teams",
      });
    },
  },
];
