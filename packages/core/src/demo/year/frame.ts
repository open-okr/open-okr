/**
 * The frame of the Northwind year (P9-T22c-a): its people, its spaces, its
 * terminology, the year's practice settings changes, its KPIs and their
 * readings, and the annual frame with its four objectives.
 *
 * Each is an event on the scenario date it happens. The quarters (P9-T22c-b
 * to e) add their own events to the same timeline, which is what puts a
 * setting changed on 2 April after the quarter that closed on 18 March.
 */
import { newId, workspaceMembers } from "@openokr/db";
import { callAction } from "../../actions/registry.ts";
import { runOperation } from "../../operations/operation.ts";
import { richTextFromPlainText } from "../../rich-text/from-text.ts";
import { ANNUAL_CUTS, ANNUAL_OBJECTIVES, YEAR_FRAME } from "./annual.ts";
import { addDays, realMonthStart } from "./calendar.ts";
import { YEAR_KPI_TREES, YEAR_KPIS, type YearKpiKey } from "./kpis.ts";
import {
  YEAR_PEOPLE,
  YEAR_SPACES,
  type YearPerson,
  type YearSpace,
} from "./people.ts";
import {
  cycleHolding,
  need,
  type YearContext,
  type YearEvent,
} from "./timeline.ts";

// ── People ───────────────────────────────────────────────────────────────

/** Adds a person to every listed space that already exists. */
async function joinSpaces(context: YearContext, person: YearPerson) {
  const memberId = need(context.ids.people, person.key, "Person");
  for (const space of YEAR_SPACES) {
    const spaceId = context.ids.spaces.get(space.key);
    if (!spaceId || !space.memberKeys.includes(person.key)) {
      continue;
    }
    await callAction(context.action, "spaces.addMember", {
      spaceId,
      memberId,
      role: space.coordinatorKey === person.key ? "coordinator" : "member",
    });
  }
}

const arrival = (person: YearPerson): YearEvent => ({
  on: person.arrives,
  step:
    person.arrives === "2027-04-12"
      ? "NW-Q2-05"
      : person.arrives === "2026-11-25"
        ? "NW-P-05"
        : person.arrives === "2026-10-01"
          ? "NW-P-02"
          : "NW-P-01",
  label: `${person.name || "Elena"} arrives`,
  // Before any space formed the same day, so the space can take them.
  order: -10,
  async run(context) {
    if (person.key === "elena") {
      // The registrant plays Elena and keeps their own name (README §2).
      // The member behind the registrant's own account, where the command
      // knows it. The directory has no order, and lists the two agents, which
      // are workspace members too: its first row could be the Champion.
      const directory = await callAction(
        context.action,
        "people.directory",
        {},
      );
      const founder = context.seed.adminMemberId
        ? directory.find((entry) => entry.id === context.seed.adminMemberId)
        : directory.find((entry) => entry.kind === "human");
      if (!founder) {
        throw new Error("The workspace has no members. Run the wizard first.");
      }
      context.ids.people.set("elena", founder.id);
      await callAction(context.action, "people.updateMember", {
        memberId: founder.id,
        title: person.title,
      });
      return;
    }
    // There is no action that creates a member without an invitation to
    // accept, so the seed writes the row through the pipeline the way the
    // one-quarter demo does (`demo.createMember`).
    const memberId = await runOperation(
      { pool: context.seed.pool },
      {
        action: "demo.createMember",
        workspaceId: context.seed.workspaceId,
        actor: { kind: "human", userId: context.seed.adminUserId },
        async execute({ tx, workspaceId }) {
          const id = newId();
          // openokr:allow-mutation: the builder's own audited operation.
          await tx.insert(workspaceMembers).values({
            id,
            workspaceId,
            userId: null,
            name: person.name,
            title: person.title,
            timezone: person.timezone,
            kind: "human",
            status: "active",
          });
          return {
            result: id,
            activity: {
              kind: "member.updated" as const,
              subjectType: "member" as const,
              subjectId: id,
              payload: { name: person.name },
            },
            audit: {
              action: "demo.createMember",
              targetType: "member",
              targetId: id,
              payload: { name: person.name, title: person.title },
            },
          };
        },
      },
    );
    context.ids.people.set(person.key, memberId);
    if (person.managerKey) {
      await callAction(context.action, "people.updateMember", {
        memberId,
        managerId: need(context.ids.people, person.managerKey, "Manager"),
      });
    }
    await joinSpaces(context, person);
  },
});

const departure = (person: YearPerson, leaves: string): YearEvent => ({
  on: leaves,
  step: "NW-Q2-12",
  label: `${person.name} leaves`,
  // After the day's other events, which reassign what they owned first.
  order: 50,
  async run(context) {
    await callAction(context.action, "people.suspend", {
      memberId: need(context.ids.people, person.key, "Person"),
    });
  },
});

// ── Spaces ───────────────────────────────────────────────────────────────

const formation = (space: YearSpace): YearEvent => ({
  on: space.forms,
  step:
    space.forms === "2027-08-09"
      ? "NW-Q3-09"
      : space.forms === "2026-11-25"
        ? "NW-P-05"
        : space.forms === "2026-10-01"
          ? "NW-P-02"
          : "NW-P-01",
  label: `${space.name || "The company space"} forms`,
  async run(context) {
    const founderId = need(context.ids.people, "elena", "Person");
    if (space.key === "company") {
      // The workspace's own first space, which the product reads as the
      // company's: its coordinator hears about a company objective (P9-T19a).
      const spaces = await callAction(context.action, "spaces.list", {});
      const first = spaces[0];
      if (!first) {
        throw new Error("The workspace has no space. Provisioning makes one.");
      }
      context.ids.spaces.set("company", first.id);
      await callAction(context.action, "spaces.addMember", {
        spaceId: first.id,
        memberId: need(context.ids.people, "priya", "Person"),
        role: "coordinator",
      });
      return;
    }
    const managerId = need(context.ids.people, space.managerKey, "Manager");
    const created = await callAction(context.action, "spaces.create", {
      name: space.name,
      mission: space.mission,
      managerMemberId: managerId,
    });
    context.ids.spaces.set(space.key, created.id);
    if (space.coordinatorKey !== space.managerKey) {
      await callAction(context.action, "spaces.addMember", {
        spaceId: created.id,
        memberId: need(context.ids.people, space.coordinatorKey, "Coordinator"),
        role: "coordinator",
      });
    }
    for (const key of space.memberKeys) {
      const memberId = context.ids.people.get(key);
      if (
        !memberId ||
        key === space.coordinatorKey ||
        key === space.managerKey
      ) {
        continue;
      }
      await callAction(context.action, "spaces.addMember", {
        spaceId: created.id,
        memberId,
        role: "member",
      });
    }
    // Elena joins every space. Not decoration: a space's objectives bind its
    // own members at edit, and every write in the seed is made as her.
    if (founderId !== managerId) {
      await callAction(context.action, "spaces.addMember", {
        spaceId: created.id,
        memberId: founderId,
        role: "member",
      });
    }
  },
});

const merger = (space: YearSpace, merges: string): YearEvent => ({
  on: merges,
  step: "NW-Q3-07",
  label: `${space.name} merges and is archived`,
  // Last on the day: its objectives move out first (P9-T22c-d).
  order: 100,
  async run(context) {
    await callAction(context.action, "spaces.archive", {
      id: need(context.ids.spaces, space.key, "Space"),
    });
  },
});

// ── Terminology and practice settings ────────────────────────────────────

const practice = (
  on: string,
  step: string,
  label: string,
  overrides: Record<string, string>,
): YearEvent => ({
  on,
  step,
  label,
  async run(context) {
    await callAction(context.action, "practice.update", { overrides });
  },
});

const SETTINGS: readonly YearEvent[] = [
  {
    on: "2026-11-25",
    step: "NW-P-06",
    label: "Space is called Team",
    async run(context) {
      await callAction(context.action, "rhythm.update", {
        labels: { space: { singular: "Team", plural: "Teams" } },
      });
    },
  },
  {
    on: "2027-04-02",
    step: "NW-Q1-29",
    label: "Objectives per unit capped at two",
    async run(context) {
      await callAction(context.action, "rhythm.update", {
        overrides: { "quality.objectivesPerUnitCap": 2 },
      });
    },
  },
  practice("2027-04-02", "NW-Q2-02", "Critical escalation on", {
    "escalation.criticalConfidence": "on",
  }),
  practice("2027-04-02", "NW-Q2-03", "OBJ-1 raised to block", {
    "checks.OBJ-1": "block",
  }),
  practice("2027-05-14", "NW-Q2-13", "Reasons for additions required", {
    "reasons.midCycleAddition": "required",
  }),
  practice("2027-06-07", "NW-Q2-18", "The review held in two sessions", {
    "review.format": "split",
  }),
  // "Late June, for Q3" (README §4): after Q2's retrospective on 18 June and
  // before Q3's company step on 28 June.
  practice("2027-06-25", "NW-Q3-01", "OBJ-1 back to warn", {
    "checks.OBJ-1": "warn",
  }),
  {
    on: "2027-07-01",
    step: "NW-Q3-02",
    label: "Sales checks in every two weeks",
    async run(context) {
      await callAction(context.action, "spaces.updateSettings", {
        id: need(context.ids.spaces, "sales", "Space"),
        defaultCheckInFrequency: "biweekly",
      });
    },
  },
  practice("2027-12-17", "NW-Q4-13", "The department level off for 2028", {
    "levels.department": "off",
  }),
];

// ── KPIs ─────────────────────────────────────────────────────────────────

/** The day a month's reading is recorded: a few days after it ends. */
function recordedOn(month: string): string {
  const next = addDays(`${month}-01`, 32).slice(0, 7);
  // The scenario names two of them: January's tickets on 1 February
  // (NW-Q1-17), and November's margin on 6 December (NW-Q4-05).
  if (next.endsWith("-02") && month.endsWith("-01")) {
    return `${next}-01`;
  }
  if (month.endsWith("-11")) {
    return `${next}-06`;
  }
  return `${next}-05`;
}

/** The scenario months of the year's readings: December 2026 onwards. */
const YEAR_MONTHS = [
  "2026-12",
  "2027-01",
  "2027-02",
  "2027-03",
  "2027-04",
  "2027-05",
  "2027-06",
  "2027-07",
  "2027-08",
  "2027-09",
  "2027-10",
  "2027-11",
];
const BEFORE_MONTHS = [
  "2026-06",
  "2026-07",
  "2026-08",
  "2026-09",
  "2026-10",
  "2026-11",
];

const KPI_SETUP: YearEvent = {
  on: "2026-12-07",
  step: "NW-P-12",
  label: "The KPIs, their thresholds and six months of history",
  async run(context) {
    const categories = new Map<string, string>();
    for (const name of ["Finance", "Customer", "Product", "Platform"]) {
      const created = await callAction(context.action, "kpis.createCategory", {
        name,
      });
      categories.set(name, created.id);
    }
    for (const kpi of YEAR_KPIS) {
      const parentKpiId = kpi.parentKey
        ? context.ids.kpis.get(kpi.parentKey)
        : undefined;
      const created = await callAction(context.action, "kpis.create", {
        title: kpi.title,
        frequency: "monthly",
        indicatorType: kpi.indicatorType,
        aggregate: "avg",
        ownerKind: "workspace",
        ownerMemberId: need(context.ids.people, kpi.ownerKey, "Owner"),
        categoryId: need(categories, kpi.category, "Category"),
        ...(parentKpiId ? { parentKpiId } : {}),
        unit: kpi.unit,
        targetDefault: kpi.target,
        targetType: kpi.targetType,
        ...(kpi.greenLow === undefined ? {} : { greenLow: kpi.greenLow }),
        ...(kpi.greenHigh === undefined ? {} : { greenHigh: kpi.greenHigh }),
        ...(kpi.redLow === undefined ? {} : { redLow: kpi.redLow }),
        ...(kpi.redHigh === undefined ? {} : { redHigh: kpi.redHigh }),
      });
      context.ids.kpis.set(kpi.key, created.id);
      for (const [index, value] of kpi.before.entries()) {
        const month = BEFORE_MONTHS[index];
        if (month) {
          await callAction(context.action, "kpis.record", {
            kpiId: created.id,
            on: realMonthStart(month, context.realYear),
            actualValue: value,
            targetValue: kpi.target,
          });
        }
      }
    }
    const treeOf = new Map<YearKpiKey, string>();
    for (const tree of YEAR_KPI_TREES) {
      const created = await callAction(context.action, "kpis.createTree", {
        name: tree.name,
        rootKpiId: need(context.ids.kpis, tree.rootKey, "KPI"),
      });
      treeOf.set(tree.rootKey, created.id);
    }
    const parentOf = new Map(YEAR_KPIS.map((kpi) => [kpi.key, kpi.parentKey]));
    for (const kpi of YEAR_KPIS) {
      if (!kpi.parentKey) {
        continue;
      }
      let root: YearKpiKey = kpi.key;
      for (let step = 0; step < YEAR_KPIS.length; step++) {
        const parent = parentOf.get(root);
        if (!parent) {
          break;
        }
        root = parent;
      }
      const treeId = treeOf.get(root);
      if (treeId) {
        await callAction(context.action, "kpis.update", {
          kpiId: need(context.ids.kpis, kpi.key, "KPI"),
          treeId,
        });
      }
    }
  },
};

/** Each month's readings, on the day they are recorded. */
const MONTHLY_READINGS: readonly YearEvent[] = YEAR_MONTHS.map(
  (month, index) => ({
    on: recordedOn(month),
    label: `The ${month} readings`,
    async run(context) {
      for (const kpi of YEAR_KPIS) {
        const value = kpi.year[index];
        if (value === undefined) {
          continue;
        }
        await callAction(context.action, "kpis.record", {
          kpiId: need(context.ids.kpis, kpi.key, "KPI"),
          on: realMonthStart(month, context.realYear),
          actualValue: value,
          targetValue: kpi.target,
        });
      }
    },
  }),
);

// ── The annual frame and objectives ──────────────────────────────────────

const ANNUAL_FRAME: YearEvent = {
  on: "2026-12-01",
  step: "NW-P-08",
  label: "The annual frame, its priorities and its not-doing list",
  async run(context) {
    const annual = await cycleHolding(
      context,
      `${context.realYear}-06-30`,
      "annual",
    );
    context.ids.cycles.set("annual", annual.id);
    await callAction(context.action, "cycles.update", {
      id: annual.id,
      sponsorId: need(context.ids.people, "elena", "Person"),
      facilitatorId: need(context.ids.people, "priya", "Person"),
    });
    const frame = await callAction(context.action, "frame.set", {
      yearLabel: String(context.realYear),
      horizonLabel: YEAR_FRAME.horizonLabel,
      agreed: true,
      mission: richTextFromPlainText(YEAR_FRAME.mission),
      vision: richTextFromPlainText(YEAR_FRAME.vision),
      notDoing: richTextFromPlainText(YEAR_FRAME.notDoing),
      strategies: YEAR_FRAME.strategies.map((text) => ({ text })),
    });
    context.ids.strategies = frame.strategies.map((strategy) => strategy.id);
    for (const priority of YEAR_FRAME.priorities) {
      await callAction(context.action, "workflow.addPriority", {
        cycleId: annual.id,
        text: priority.text,
        successStatement: priority.successStatement,
      });
    }
  },
};

const ANNUAL_DRAFTS: YearEvent = {
  on: "2026-12-11",
  step: "NW-P-10",
  label: "The four annual objectives drafted",
  async run(context) {
    const cycleId = need(context.ids.cycles, "annual", "Cycle");
    const cycles = await callAction(context.action, "cycles.list", {});
    const endsOn =
      cycles.find((cycle) => cycle.id === cycleId)?.endsOn ??
      `${context.realYear}-12-31`;
    const elena = need(context.ids.people, "elena", "Person");
    for (const objective of ANNUAL_OBJECTIVES) {
      const championId = need(
        context.ids.people,
        objective.championKey,
        "Champion",
      );
      const strategyId = context.ids.strategies[objective.strategy];
      const goal = await callAction(context.action, "goals.create", {
        title: objective.title,
        cycleId,
        level: "company",
        kind: objective.kind,
        ownerKind: "workspace",
        championId,
        // Elena reviews the company objectives (NW-P-09), and somebody else
        // reviews the one she champions.
        reviewerId:
          championId === elena
            ? need(context.ids.people, "priya", "Person")
            : elena,
        ...(strategyId ? { strategyId } : {}),
        weight: 1,
      });
      context.ids.goals.set(objective.key, goal.id);
      for (const keyResult of objective.keyResults) {
        const kpiId = keyResult.kpiKey
          ? need(context.ids.kpis, keyResult.kpiKey, "KPI")
          : undefined;
        const added = await callAction(context.action, "goals.addKeyResult", {
          goalId: goal.id,
          title: keyResult.title,
          ...(keyResult.kind ? { kind: keyResult.kind } : {}),
          ...(keyResult.direction ? { direction: keyResult.direction } : {}),
          indicatorType: keyResult.indicatorType,
          ...(keyResult.baselineValue === undefined
            ? {}
            : { baselineValue: keyResult.baselineValue }),
          ...(keyResult.targetValue === undefined
            ? {}
            : { targetValue: keyResult.targetValue }),
          ...(keyResult.unit ? { unit: keyResult.unit } : {}),
          dueOn: keyResult.dueOn ? context.real(keyResult.dueOn) : endsOn,
          ownerId: need(context.ids.people, keyResult.ownerKey, "Owner"),
          ...(keyResult.capacity ? { capacity: keyResult.capacity } : {}),
          ...(kpiId ? { kpiId } : {}),
          weight: 1,
        });
        context.ids.keyResults.set(keyResult.key, added.id);
      }
    }
  },
};

const ANNUAL_PUBLISH: YearEvent = {
  on: "2026-12-18",
  step: "NW-P-14",
  label: "The annual set publishes",
  async run(context) {
    const cycleId = need(context.ids.cycles, "annual", "Cycle");
    await callAction(context.action, "workflow.setCapacityNotes", {
      cycleId,
      cuts: richTextFromPlainText(ANNUAL_CUTS),
    });
    await callAction(context.action, "workflow.publish", { cycleId });
  },
};

/** Every event of the year's frame. */
export const FRAME_EVENTS: readonly YearEvent[] = [
  ...YEAR_PEOPLE.map(arrival),
  ...YEAR_PEOPLE.flatMap((person) =>
    person.leaves ? [departure(person, person.leaves)] : [],
  ),
  ...YEAR_SPACES.map(formation),
  ...YEAR_SPACES.flatMap((space) =>
    space.merges ? [merger(space, space.merges)] : [],
  ),
  ...SETTINGS,
  KPI_SETUP,
  ...MONTHLY_READINGS,
  ANNUAL_FRAME,
  ANNUAL_DRAFTS,
  ANNUAL_PUBLISH,
];
