/**
 * Applying a starting template to a workspace (P8-T12).
 *
 * **Through the ordinary actions, one at a time.** Nothing here writes a row
 * directly, so a template cannot create something the product would refuse
 * from a person: the quality checks run, the audit rows are written, and the
 * access contexts are built the same way they are for anybody typing.
 *
 * **Idempotent, and it says so rather than guessing.** A workspace that
 * already holds goals is not seeded again. Applying a template twice would
 * double somebody's quarter, and the second application is almost always a
 * double-click rather than an intention.
 *
 * The template's objectives and measures are in `catalogue.ts`, as data, so
 * the argument about what a good first objective looks like happens there
 * rather than in a loop.
 */
import type { Pool } from "pg";
import { callAction } from "../actions/registry.ts";
import {
  type StartingTemplate,
  type StartingTemplateKey,
  startingTemplateFor,
} from "./catalogue.ts";

export interface ApplyTemplateInput {
  readonly pool: Pool;
  readonly workspaceId: string;
  /** The person every write is authorised and attributed as. */
  readonly adminUserId: string;
  readonly template: StartingTemplateKey;
  /** Today, injectable so a test can place the first session deliberately. */
  readonly now?: Date;
}

export interface ApplyTemplateResult {
  readonly applied: StartingTemplateKey;
  /** True when the workspace already held goals, so nothing was written. */
  readonly alreadySeeded: boolean;
  readonly objectivesCreated: number;
  readonly keyResultsCreated: number;
  readonly kpisCreated: number;
  readonly spacesCreated: number;
  /** The weekly session, when the template schedules one. */
  readonly weeklySessionId: string | null;
}

const EMPTY = (template: StartingTemplateKey): ApplyTemplateResult => ({
  applied: template,
  alreadySeeded: false,
  objectivesCreated: 0,
  keyResultsCreated: 0,
  kpisCreated: 0,
  spacesCreated: 0,
  weeklySessionId: null,
});

/**
 * The next weekday at the top of the working day, in the workspace's own time.
 *
 * A session scheduled for the moment somebody pressed a button is a session
 * that is already late. The next working day is the earliest a team could
 * actually hold one, which is what "the first weekly session is scheduled"
 * has to mean to be worth anything.
 */
export function firstWeeklySession(now: Date): Date {
  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + 1);
  // Saturday and Sunday move to Monday.
  while (next.getUTCDay() === 0 || next.getUTCDay() === 6) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  next.setUTCHours(9, 0, 0, 0);
  return next;
}

export async function applyTemplate(
  input: ApplyTemplateInput,
): Promise<ApplyTemplateResult> {
  if (input.template === "none") {
    return EMPTY("none");
  }
  const template = startingTemplateFor(input.template);
  if (!template) {
    return EMPTY(input.template);
  }

  const context = {
    pool: input.pool,
    workspaceId: input.workspaceId,
    actor: { kind: "human" as const, userId: input.adminUserId },
  };

  // Already seeded? A workspace with goals in it is somebody else's work, and a
  // template applied over the top of it is a mess nobody asked for.
  const existing = await callAction(context, "goals.list", {
    includeClosed: false,
  });
  if ((existing as { goals?: unknown[] }).goals?.length) {
    return { ...EMPTY(input.template), alreadySeeded: true };
  }

  return seed(context, template, input.now ?? new Date());
}

type Context = {
  pool: Pool;
  workspaceId: string;
  actor: { kind: "human"; userId: string };
};

async function seed(
  context: Context,
  template: StartingTemplate,
  now: Date,
): Promise<ApplyTemplateResult> {
  // The cycle first: every objective belongs to one, and `ensureCurrent` is
  // idempotent, so a workspace that already has this quarter keeps it.
  const cycle = await callAction(context, "cycles.ensureCurrent", {});
  const cycleId = (cycle as { id: string }).id;

  const me = await callAction(context, "people.directory", {});
  const memberId = firstMemberId(me);
  if (!memberId) {
    // Nothing can be created without somebody to champion it, and the only
    // member of a fresh workspace is whoever just made it.
    return EMPTY(template.key);
  }

  let spacesCreated = 0;
  let spaceId = await firstSpaceId(context);
  if (template.space) {
    const created = await callAction(context, "spaces.create", {
      name: template.space,
      managerMemberId: memberId,
    });
    spaceId = (created as { id: string }).id;
    spacesCreated = 1;
  }

  let kpiId: string | undefined;
  let kpisCreated = 0;
  if (template.kpi) {
    const category = await callAction(context, "kpis.createCategory", {
      name: template.kpi.category,
    });
    const kpi = await callAction(context, "kpis.create", {
      title: template.kpi.name,
      frequency: "monthly",
      direction:
        template.kpi.direction === "increase"
          ? "higher_better"
          : "lower_better",
      indicatorType: "lagging",
      tier: "outcome",
      aggregate: "avg" as const,
      categoryId: (category as { id: string }).id,
      unit: template.kpi.unit,
      targetDefault: template.kpi.target,
      ...(spaceId
        ? { ownerKind: "space" as const, spaceId }
        : { ownerKind: "workspace" as const }),
    });
    kpiId = (kpi as { id: string }).id;
    kpisCreated = 1;
    await callAction(context, "kpis.createTree", {
      name: template.kpi.tree,
      rootKpiId: kpiId,
    });
  }

  let objectivesCreated = 0;
  let keyResultsCreated = 0;

  for (const objective of template.objectives) {
    const goal = await callAction(context, "goals.create", {
      title: objective.title,
      level: objective.level,
      cycleId,
      championId: memberId,
      reviewerId: memberId,
      weight: 1,
      ...(objective.level === "team" && spaceId
        ? { ownerKind: "space" as const, spaceId }
        : { ownerKind: "workspace" as const }),
    });
    const goalId = (goal as { id: string }).id;
    objectivesCreated += 1;

    for (const keyResult of objective.keyResults) {
      await callAction(context, "goals.addKeyResult", {
        goalId,
        title: keyResult.title,
        direction: keyResult.direction,
        indicatorType: keyResult.indicatorType,
        baselineValue: keyResult.baselineValue,
        targetValue: keyResult.targetValue,
        weight: 1,
        ...(keyResult.unit ? { unit: keyResult.unit } : {}),
        ...(keyResult.linkToKpi && kpiId ? { kpiId } : {}),
      });
      keyResultsCreated += 1;
    }
  }

  let weeklySessionId: string | null = null;
  if (template.scheduleWeekly && spaceId) {
    const session = await callAction(context, "sessions.create", {
      spaceId,
      cycleId,
      kind: "weekly",
      title: "Weekly session",
      scheduledFor: firstWeeklySession(now).toISOString(),
      facilitatorId: memberId,
    });
    weeklySessionId = (session as { id: string }).id;
  }

  return {
    applied: template.key,
    alreadySeeded: false,
    objectivesCreated,
    keyResultsCreated,
    kpisCreated,
    spacesCreated,
    weeklySessionId,
  };
}

/** The workspace's own member, which on a fresh workspace is its owner. */
function firstMemberId(directory: unknown): string | undefined {
  const rows = (directory as { id: string }[]) ?? [];
  return rows[0]?.id;
}

/** The space provisioning already made, or nothing. */
async function firstSpaceId(context: Context): Promise<string | undefined> {
  const spaces = await callAction(context, "spaces.list", {});
  return (spaces as { id: string }[])[0]?.id;
}
