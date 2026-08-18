/**
 * The demo workspace builder (IMPLEMENTATION-PLAN P3-T17, screen S-34).
 *
 * Builds a believable organisation in a workspace. Runs through the action
 * system so every write gets its access bindings, activity row, audit row
 * and outbox row. Uses a system actor so no notifications are dispatched.
 *
 * Idempotent: checks whether demo goals already exist before writing.
 */
import type { Pool } from "pg";
import { callAction } from "../actions/registry.ts";

interface DemoContext {
  readonly pool: Pool;
  readonly workspaceId: string;
  /** The userId of the admin who owns this workspace. Reads need a real
   *  member, and the admin is the one member guaranteed to exist. */
  readonly adminUserId: string;
}

function ctx(demo: DemoContext) {
  return {
    pool: demo.pool,
    workspaceId: demo.workspaceId,
    actor: { kind: "human" as const, userId: demo.adminUserId },
  };
}

export interface BuildDemoResult {
  readonly spacesCreated: number;
  readonly goalsCreated: number;
  readonly kpisCreated: number;
  readonly alreadySeeded: boolean;
}

export async function buildDemoWorkspace(
  demo: DemoContext,
): Promise<BuildDemoResult> {
  const c = ctx(demo);

  // Idempotency: if company goals exist, the demo was already built
  const existing = await callAction(c, "goals.list", {
    includeClosed: false,
    level: "company",
  });
  if (existing.goals.length > 0) {
    return {
      spacesCreated: 0,
      goalsCreated: 0,
      kpisCreated: 0,
      alreadySeeded: true,
    };
  }

  // 1. Spaces
  await callAction(c, "spaces.create", {
    name: "Product",
    mission: "Build the product customers love",
  });
  await callAction(c, "spaces.create", {
    name: "Sales",
    mission: "Grow revenue sustainably",
  });

  // 2. Active cycle (provisioning already created one)
  const currentCycle = await callAction(c, "cycles.current", {
    mode: "quarterly",
  });
  if (!currentCycle) {
    throw new Error("No active cycle. Provisioning should have created one.");
  }
  const cycleId = currentCycle.id;

  // 3. Members (get the first one, who is the admin)
  const members = await callAction(c, "people.directory", {});
  const first = members[0];
  if (!first) {
    throw new Error("No members found.");
  }
  const championId = first.id;
  const reviewerId = first.id;

  // 4. Company goals with key results
  const goal1 = await callAction(c, "goals.create", {
    title: "Become the go-to platform for mid-market teams",
    level: "company" as const,
    ownerKind: "workspace" as const,
    championId,
    reviewerId,
    weight: 100,
    cycleId,
  });

  await callAction(c, "goals.addKeyResult", {
    goalId: goal1.id,
    title: "Increase NPS from 32 to 50",
    direction: "increase" as const,
    baselineValue: 32,
    targetValue: 50,
    weight: 100,
    indicatorType: "lagging" as const,
  });
  await callAction(c, "goals.addKeyResult", {
    goalId: goal1.id,
    title: "Cut onboarding time from 14 days to 3 days",
    direction: "reduce" as const,
    baselineValue: 14,
    targetValue: 3,
    weight: 100,
    indicatorType: "leading" as const,
  });
  await callAction(c, "goals.addKeyResult", {
    goalId: goal1.id,
    title: "Grow active mid-market accounts from 120 to 300",
    direction: "increase" as const,
    baselineValue: 120,
    targetValue: 300,
    weight: 100,
    indicatorType: "lagging" as const,
  });

  const goal2 = await callAction(c, "goals.create", {
    title: "Make our revenue engine predictable",
    level: "company" as const,
    ownerKind: "workspace" as const,
    championId,
    reviewerId,
    weight: 100,
    cycleId,
  });

  await callAction(c, "goals.addKeyResult", {
    goalId: goal2.id,
    title: "Grow qualified pipeline from $1.2M to $3.0M",
    direction: "increase" as const,
    baselineValue: 1200000,
    targetValue: 3000000,
    weight: 100,
    indicatorType: "lagging" as const,
  });
  await callAction(c, "goals.addKeyResult", {
    goalId: goal2.id,
    title: "Lift call-to-meeting conversion from 8% to 15%",
    direction: "increase" as const,
    baselineValue: 8,
    targetValue: 15,
    weight: 100,
    indicatorType: "leading" as const,
  });

  // 5. KPI
  const category = await callAction(c, "kpis.createCategory", {
    name: "Business Health",
  });

  const kpiInput = {
    title: "Operating margin",
    categoryId: category.id,
    direction: "higher_better",
    frequency: "monthly",
    ownerKind: "workspace",
    indicatorType: "lagging",
    tier: "impact",
    targetDefault: 100,
    healthyPct: 90,
    watchPct: 70,
  } as Parameters<typeof callAction<"kpis.create">>[2];
  const kpi1 = await callAction(c, "kpis.create", kpiInput);

  // Record an unhealthy value
  const today = new Date().toISOString().slice(0, 10);
  await callAction(c, "kpis.record", {
    kpiId: kpi1.id,
    on: today,
    actualValue: 55,
  });

  // 6. KPI tree
  await callAction(c, "kpis.createTree", {
    name: "Revenue Health",
    rootKpiId: kpi1.id,
  });

  // 7. Comment on the first goal
  await callAction(c, "comments.create", {
    subjectType: "goal" as const,
    subjectId: goal1.id,
    body: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "This quarter we are focusing on mid-market expansion. The onboarding improvements should be the priority.",
            },
          ],
        },
      ],
    },
  });

  return {
    spacesCreated: 2,
    goalsCreated: 2,
    kpisCreated: 1,
    alreadySeeded: false,
  };
}
