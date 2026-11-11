/**
 * Putting every workspace with no plan on the default plan
 * (docs/design/workspaces-without-a-plan.md, plan 0.8.0 O2).
 *
 * On an instance with a catalogue, a workspace with no plan may not use the
 * provider's AI key (ai-credits.md §3). OKRGoal's catalogue went in after its
 * first workspaces existed, so all of them lost AI and nobody was told. Q6
 * decided that nothing happens by itself: the console says what having no plan
 * costs, and the operator reviews this list and confirms it.
 *
 * **One Operation per workspace, the one S-46 runs.** `setPlanAsOperator` with
 * `bulk`, so the seat check, the activity row and the audit row are the ones a
 * single change writes, and a workspace given a plan since the review is
 * skipped rather than moved.
 */
import { withWorkspace } from "@openokr/db";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { recordInstanceAuditEvent } from "../audit/instance-chain.ts";
import { OperationError } from "../operations/operation.ts";
import {
  type Plan,
  readPlans,
  resolveDefaultPlan,
  seatsInUseInTx,
} from "../tenancy/index.ts";
import { setPlanAsOperator } from "./plans.ts";
import { isLiveOperator, listTenantsAsOperator } from "./store.ts";

interface NoPlanWorkspace {
  readonly workspaceId: string;
  readonly name: string;
  readonly slug: string;
  /** People in use, as the seat limit counts them. */
  readonly people: number;
}

export interface DefaultPlanReview {
  /** Whether the instance has a plan catalogue at all. */
  readonly catalogue: boolean;
  /** The plan `cloud.defaultPlan` names, when the catalogue holds it. */
  readonly defaultPlan: Pick<
    Plan,
    "key" | "name" | "seats" | "aiCredits"
  > | null;
  readonly willMove: readonly NoPlanWorkspace[];
  /** More people than the default plan's seats. */
  readonly willRefuse: readonly NoPlanWorkspace[];
}

/** Every live workspace with no plan, as the console's tenant list reads it. */
async function workspacesWithoutAPlan(
  pool: Pool,
  operatorUserId: string,
): Promise<readonly NoPlanWorkspace[]> {
  const tenants = await listTenantsAsOperator(pool, operatorUserId);
  const db = drizzle(pool);
  const found: NoPlanWorkspace[] = [];
  for (const tenant of tenants) {
    if (
      tenant.planKey !== null ||
      tenant.tenantState === "closed" ||
      tenant.erasingAt !== null
    ) {
      continue;
    }
    // Counted inside the workspace's own tenant setting, as the usage
    // snapshot counts, so no policy is loosened to read it.
    const people = await withWorkspace(db, tenant.workspaceId, (tx) =>
      seatsInUseInTx(tx, tenant.workspaceId),
    );
    found.push({
      workspaceId: tenant.workspaceId,
      name: tenant.name,
      slug: tenant.slug,
      people,
    });
  }
  return found;
}

/** What confirming would do, without doing it. */
export async function reviewDefaultPlanFill(
  pool: Pool,
  operatorUserId: string,
): Promise<DefaultPlanReview> {
  if (!(await isLiveOperator(pool, operatorUserId))) {
    throw new OperationError("not_found", "No such page.");
  }
  const [plans, defaultPlan, candidates] = await Promise.all([
    readPlans(pool),
    resolveDefaultPlan(pool),
    workspacesWithoutAPlan(pool, operatorUserId),
  ]);
  const seats = defaultPlan?.seats ?? null;
  const fits = (one: NoPlanWorkspace) => seats === null || one.people <= seats;
  return {
    catalogue: plans.length > 0,
    defaultPlan: defaultPlan
      ? {
          key: defaultPlan.key,
          name: defaultPlan.name,
          seats: defaultPlan.seats,
          aiCredits: defaultPlan.aiCredits,
        }
      : null,
    willMove: candidates.filter(fits),
    willRefuse: candidates.filter((one) => !fits(one)),
  };
}

export interface DefaultPlanFillResult {
  readonly planKey: string;
  readonly moved: readonly string[];
  readonly refused: readonly {
    readonly workspaceId: string;
    readonly reason: string;
  }[];
  readonly skipped: readonly {
    readonly workspaceId: string;
    readonly reason: string;
  }[];
}

/**
 * Moves exactly the workspaces the review listed under "Will move". Each is
 * checked again in its own transaction, so one that changed since the review
 * is refused or skipped with its reason, and the others still move.
 */
export async function fillDefaultPlanAsOperator(
  pool: Pool,
  input: {
    readonly operatorUserId: string;
    readonly reason: string;
    readonly workspaceIds: readonly string[];
  },
): Promise<DefaultPlanFillResult> {
  if (!(await isLiveOperator(pool, input.operatorUserId))) {
    throw new OperationError("not_found", "No such page.");
  }
  const defaultPlan = await resolveDefaultPlan(pool);
  if (!defaultPlan) {
    throw new OperationError(
      "conflict",
      "No default plan is set. Set cloud.defaultPlan to a plan in the catalogue first.",
    );
  }
  const tenants = new Map(
    (await listTenantsAsOperator(pool, input.operatorUserId)).map((tenant) => [
      tenant.workspaceId,
      tenant,
    ]),
  );

  const moved: string[] = [];
  const refused: { workspaceId: string; reason: string }[] = [];
  const skipped: { workspaceId: string; reason: string }[] = [];
  for (const workspaceId of new Set(input.workspaceIds)) {
    const tenant = tenants.get(workspaceId);
    if (!tenant || tenant.tenantState === "closed" || tenant.erasingAt) {
      skipped.push({ workspaceId, reason: "Closed, or no longer here." });
      continue;
    }
    try {
      await setPlanAsOperator(pool, {
        workspaceId,
        operatorUserId: input.operatorUserId,
        planKey: defaultPlan.key,
        reason: input.reason,
        bulk: true,
      });
      moved.push(workspaceId);
    } catch (error) {
      if (!(error instanceof OperationError)) {
        throw error;
      }
      if (error.code === "conflict") {
        skipped.push({ workspaceId, reason: error.message });
      } else {
        refused.push({ workspaceId, reason: error.message });
      }
    }
  }

  await recordInstanceAuditEvent(pool, {
    action: "operator.default_plan_filled",
    payload: {
      operatorUserId: input.operatorUserId,
      planKey: defaultPlan.key,
      reason: input.reason,
      moved: moved.length,
      refused: refused.length,
      skipped: skipped.length,
    },
  });

  return { planKey: defaultPlan.key, moved, refused, skipped };
}
