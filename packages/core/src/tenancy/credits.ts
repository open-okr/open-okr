/**
 * AI credits: an allowance on the provider's own key (docs/design/ai-credits.md).
 *
 * **A credit is a unit of AI model cost, at the model provider's price**, and it is
 * spent only on the provider's own key. AI on a workspace's own key or a person's
 * spends none, and with no credits left, nothing but AI stops.
 *
 * **Held apart from `ai_budgets`, on purpose.** An administrator can edit a budget, so
 * a plan's allowance written there was an allowance anybody could raise, on somebody
 * else's key. A budget now only ever lowers what is spent.
 *
 * Self-hosting is never limited: with an empty catalogue there is no credit check.
 */
import {
  activeOnly,
  aiCredentials,
  aiCreditBalances,
  aiUsageEvents,
  tenants,
  withWorkspace,
} from "@openokr/db";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { OperationTx } from "../operations/operation.ts";
import {
  environmentValue,
  getInstanceSetting,
} from "../secrets/instance-registry.ts";
import { readSetting } from "../secrets/instance-settings.ts";
import { readPlans } from "./plans.ts";

const monthStart = (now: Date): string =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);

const nextMonthStart = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

async function numberSetting(pool: Pool, key: string): Promise<number> {
  const definition = getInstanceSetting(key);
  const stored = await readSetting(pool, key);
  const fromVariable = definition
    ? environmentValue(definition, process.env)
    : undefined;
  const value = Number(stored ?? fromVariable ?? definition?.fallback);
  return Number.isFinite(value) ? value : 0;
}

/** What one credit is worth in model cost. A provider sets its own. */
export const creditValueUsd = (pool: Pool): Promise<number> =>
  numberSetting(pool, "cloud.creditValueUsd");

export type HostedAccess =
  /** A self-hosted instance or a group: the deployer's own key, with no check. */
  | { readonly kind: "unmetered" }
  /** No allowance on this plan. The workspace brings its own key. */
  | { readonly kind: "none" }
  | {
      readonly kind: "credits";
      readonly allowanceUsd: number;
      readonly usedUsd: number;
      readonly agentUsedUsd: number;
      readonly purchasedUsd: number;
      /** What is left, allowance and purchased together. Never below zero. */
      readonly availableUsd: number;
      /** What the agents may still spend, within their share of the allowance. */
      readonly agentAvailableUsd: number;
      readonly creditValueUsd: number;
      readonly resetsAt: Date;
      readonly topUps: boolean;
    };

/**
 * Whether this workspace may use the provider's own key, and how much of it.
 *
 * **With a catalogue, no plan means no allowance.** A provider's workspace with no
 * plan, one adopted from before the flag for instance, must not spend the provider's
 * key without limit. An empty catalogue is what says nobody is selling anything.
 */
export async function readHostedAccess(
  pool: Pool,
  workspaceId: string,
  now: Date = new Date(),
): Promise<HostedAccess> {
  const plans = await readPlans(pool);
  if (plans.length === 0) {
    return { kind: "unmetered" };
  }
  const db = drizzle(pool);
  const [row] = await withWorkspace(db, workspaceId, async (tx) => {
    const [tenant] = await tx
      .select({ planKey: tenants.planKey })
      .from(tenants)
      .where(activeOnly(tenants, eq(tenants.workspaceId, workspaceId)))
      .limit(1);
    const [balance] = await tx
      .select()
      .from(aiCreditBalances)
      .where(eq(aiCreditBalances.workspaceId, workspaceId))
      .limit(1);
    return [{ planKey: tenant?.planKey ?? null, balance }];
  });
  const plan = plans.find((entry) => entry.key === row?.planKey);
  if (!plan?.aiCredits) {
    return { kind: "none" };
  }

  const value = await creditValueUsd(pool);
  const share = await numberSetting(pool, "cloud.agentCreditShare");
  const allowanceUsd = plan.aiCredits * value;
  const balance = row?.balance;
  // A row from an earlier month has nothing used in this one.
  const current = balance?.periodStart === monthStart(now);
  const usedUsd = current ? Number(balance?.usedUsd ?? 0) : 0;
  const agentUsedUsd = current ? Number(balance?.agentUsedUsd ?? 0) : 0;
  const purchasedUsd = Number(balance?.purchasedUsd ?? 0);
  const availableUsd = Math.max(0, allowanceUsd - usedUsd) + purchasedUsd;
  return {
    kind: "credits",
    allowanceUsd,
    usedUsd,
    agentUsedUsd,
    purchasedUsd,
    availableUsd,
    agentAvailableUsd: Math.min(
      availableUsd,
      Math.max(0, allowanceUsd * share - agentUsedUsd),
    ),
    creditValueUsd: value,
    resetsAt: nextMonthStart(now),
    topUps: plan.aiTopUps === true,
  };
}

const PAUSED =
  "This workspace has used its AI credits for this month. AI is paused until the 1st, or until somebody buys more. Everything else keeps working.";

/**
 * Why AI is off here, when the reason is credits.
 *
 * A workspace with its own key answers no: its calls spend none, so it is not paused
 * whatever its balance says.
 */
export async function creditsPausedReason(
  pool: Pool,
  workspaceId: string,
): Promise<string | null> {
  const hosted = await readHostedAccess(pool, workspaceId);
  if (hosted.kind !== "credits" || hosted.availableUsd > 0) {
    return null;
  }
  const [own] = await withWorkspace(drizzle(pool), workspaceId, (tx) =>
    tx
      .select({ id: aiCredentials.id })
      .from(aiCredentials)
      .where(activeOnly(aiCredentials, isNull(aiCredentials.ownerMemberId)))
      .limit(1),
  );
  return own ? null : PAUSED;
}

export interface CreditSummary {
  readonly allowance: number;
  readonly used: number;
  readonly purchased: number;
  readonly resetsAt: string;
  readonly topUps: boolean;
  /** This month, by where it was spent: copilot, assist, agent. */
  readonly bySource: readonly {
    readonly source: string;
    readonly credits: number;
  }[];
}

/**
 * The credits on a workspace's own plan screen, or null when it has none.
 *
 * Rounded up rather than to nearest: a call that spent a fraction of a credit did
 * spend something, and a screen reading 0 of 100 after a week of use would be wrong.
 */
export async function readCreditSummary(
  pool: Pool,
  workspaceId: string,
  now: Date = new Date(),
): Promise<CreditSummary | null> {
  const hosted = await readHostedAccess(pool, workspaceId, now);
  if (hosted.kind !== "credits") {
    return null;
  }
  const credits = (usd: number) => Math.ceil(usd / hosted.creditValueUsd);
  const rows = await withWorkspace(drizzle(pool), workspaceId, (tx) =>
    tx
      .select({
        source: aiUsageEvents.source,
        usd: sql<number>`coalesce(sum(${aiUsageEvents.cost}), 0)::float8`,
      })
      .from(aiUsageEvents)
      .where(
        and(
          eq(aiUsageEvents.workspaceId, workspaceId),
          eq(aiUsageEvents.keySource, "deployment"),
          gte(aiUsageEvents.createdAt, new Date(monthStart(now))),
        ),
      )
      .groupBy(aiUsageEvents.source),
  );
  return {
    allowance: Math.round(hosted.allowanceUsd / hosted.creditValueUsd),
    used: credits(hosted.usedUsd),
    purchased: Math.floor(hosted.purchasedUsd / hosted.creditValueUsd),
    resetsAt: hosted.resetsAt.toISOString(),
    topUps: hosted.topUps,
    bySource: rows.map((row) => ({
      source: row.source,
      credits: credits(row.usd),
    })),
  };
}

async function lockedBalanceInTx(
  tx: OperationTx,
  workspaceId: string,
  period: string,
) {
  // openokr:allow-mutation: the caller's Operation transaction. A workspace's first
  // charge makes its row, and the lock is what keeps concurrent calls exact.
  await tx
    .insert(aiCreditBalances)
    .values({ workspaceId, periodStart: period })
    .onConflictDoNothing();
  const [row] = await tx
    .select()
    .from(aiCreditBalances)
    .where(eq(aiCreditBalances.workspaceId, workspaceId))
    .for("update")
    .limit(1);
  const current = row?.periodStart === period;
  return {
    usedUsd: current ? Number(row?.usedUsd ?? 0) : 0,
    agentUsedUsd: current ? Number(row?.agentUsedUsd ?? 0) : 0,
    purchasedUsd: Number(row?.purchasedUsd ?? 0),
  };
}

/**
 * Charges one call to the balance, in the transaction that records its usage.
 *
 * The month's allowance goes first and purchased credits after it, because those last
 * until they are used and an allowance does not.
 */
export async function chargeCreditsInTx(
  tx: OperationTx,
  input: {
    readonly workspaceId: string;
    readonly costUsd: number;
    readonly allowanceUsd: number;
    readonly agent: boolean;
    readonly now?: Date;
  },
): Promise<void> {
  const now = input.now ?? new Date();
  const period = monthStart(now);
  const balance = await lockedBalanceInTx(tx, input.workspaceId, period);
  const usedUsd = balance.usedUsd + input.costUsd;
  const overflow =
    Math.max(0, usedUsd - input.allowanceUsd) -
    Math.max(0, balance.usedUsd - input.allowanceUsd);
  // openokr:allow-mutation: the caller's Operation transaction.
  await tx
    .update(aiCreditBalances)
    .set({
      periodStart: period,
      usedUsd: String(usedUsd),
      agentUsedUsd: String(
        balance.agentUsedUsd + (input.agent ? input.costUsd : 0),
      ),
      purchasedUsd: String(Math.max(0, balance.purchasedUsd - overflow)),
      updatedAt: sql`now()`,
    })
    .where(eq(aiCreditBalances.workspaceId, input.workspaceId));
}

/** Adds purchased credits. They wait until the month's allowance is spent. */
export async function addPurchasedCreditsInTx(
  tx: OperationTx,
  input: {
    readonly workspaceId: string;
    readonly amountUsd: number;
    readonly now?: Date;
  },
): Promise<void> {
  const period = monthStart(input.now ?? new Date());
  const balance = await lockedBalanceInTx(tx, input.workspaceId, period);
  // openokr:allow-mutation: the caller's Operation transaction.
  await tx
    .update(aiCreditBalances)
    .set({
      purchasedUsd: String(balance.purchasedUsd + input.amountUsd),
      updatedAt: sql`now()`,
    })
    .where(eq(aiCreditBalances.workspaceId, input.workspaceId));
}
