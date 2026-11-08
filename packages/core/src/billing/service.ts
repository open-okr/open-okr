/**
 * What a workspace's administrator does with billing (docs/design/billing.md §7).
 *
 * **Stripe is told first, and the plan only moves when the webhook arrives.** So the
 * functions that talk to the provider write nothing, and there is one place a plan
 * changes, however it was asked for.
 */
import { activeOnly, billingAccounts, users, withWorkspace } from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import {
  type ActorInput,
  OperationError,
  type OperationTx,
  runOperation,
} from "../operations/operation.ts";
import {
  applyPlanInTx,
  countSeats,
  type Plan,
  readHostedAccess,
  readOwnPlan,
  readPlans,
  resolveDefaultPlan,
  seatsInUseInTx,
  setTenantStateInTx,
} from "../tenancy/index.ts";
import type { BillingGateway } from "./gateway.ts";
import { readCreditPack } from "./settings.ts";
import { LIVE_STATUSES, planForPrice } from "./webhook.ts";

export type BillingInterval = "month" | "year";

/**
 * Records that somebody asked the provider to do something, in the customer's own
 * audit log.
 *
 * **The provider call itself has no place in a transaction**, because holding a
 * connection open across somebody else's network is how one slow answer stalls a
 * pool. So the call goes first and this follows it. Money moved by an action nobody
 * can trace is what the pipeline exists to prevent, and what the webhook records is
 * what happened, never who asked.
 */
export async function recordBillingRequest(
  pool: Pool,
  input: {
    readonly workspaceId: string;
    readonly actor: ActorInput;
    readonly action: string;
    readonly payload: Record<string, unknown>;
  },
): Promise<void> {
  await runOperation(
    { pool },
    {
      action: input.action,
      workspaceId: input.workspaceId,
      actor: input.actor,
      async execute({ workspaceId }) {
        return {
          result: undefined,
          activity: {
            kind: "billing.requested",
            subjectType: "workspace",
            subjectId: workspaceId,
            payload: { action: input.action },
          },
          audit: {
            action: input.action,
            targetType: "workspace",
            targetId: workspaceId,
            payload: input.payload,
          },
        };
      },
    },
  );
}

const NOT_SET_UP = "Billing is not set up on this instance.";

const refuseBelowHeadcount = (
  name: string,
  seats: number,
  used: number,
): never => {
  throw new OperationError(
    "forbidden",
    `The ${name} plan has ${seats} seat(s) and ${used} are in use. Free ${used - seats} first: the product never chooses who loses access.`,
  );
};

async function readBillingAccount(pool: Pool, workspaceId: string) {
  const [row] = await withWorkspace(drizzle(pool), workspaceId, (tx) =>
    tx
      .select()
      .from(billingAccounts)
      .where(
        activeOnly(
          billingAccounts,
          eq(billingAccounts.workspaceId, workspaceId),
        ),
      )
      .limit(1),
  );
  return row;
}

interface PlanPrice {
  readonly amountMinor: number | null;
  readonly currency: string;
}

export interface BillingSummary {
  readonly currentPlanKey: string | null;
  readonly status: string | null;
  readonly hasAccount: boolean;
  readonly hasLiveSubscription: boolean;
  readonly currentPeriodEnd: string | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly suspendedByBilling: boolean;
  readonly scheduledPlanKey: string | null;
  /** False when the provider did not answer. The plan and seats still show. */
  readonly pricesAvailable: boolean;
  readonly defaultPlanKey: string | null;
  /** On sale to this workspace, at the provider's price. Null when it is not. */
  readonly creditPack: {
    readonly credits: number;
    readonly amountMinor: number | null;
    readonly currency: string;
  } | null;
  readonly plans: readonly {
    readonly key: string;
    readonly name: string;
    readonly seats: number | null;
    readonly month: PlanPrice | null;
    readonly year: PlanPrice | null;
  }[];
}

export async function readBillingSummary(
  pool: Pool,
  workspaceId: string,
  gateway: BillingGateway,
): Promise<BillingSummary> {
  const [plans, account, own, defaultPlan, pack, hosted] = await Promise.all([
    readPlans(pool),
    readBillingAccount(pool, workspaceId),
    readOwnPlan(pool, workspaceId),
    resolveDefaultPlan(pool),
    readCreditPack(pool),
    readHostedAccess(pool, workspaceId),
  ]);
  const onSale =
    pack && hosted.kind === "credits" && hosted.topUps ? pack : null;

  const priceIds = plans.flatMap((plan) =>
    [plan.prices?.month, plan.prices?.year].filter(
      (id): id is string => typeof id === "string",
    ),
  );
  let prices: Awaited<ReturnType<BillingGateway["listPrices"]>> = [];
  let pricesAvailable = true;
  try {
    prices = await gateway.listPrices(
      onSale ? [...priceIds, onSale.priceId] : priceIds,
    );
  } catch {
    pricesAvailable = false;
  }
  const priceOf = (id: string | undefined): PlanPrice | null => {
    const found = prices.find((price) => price.id === id);
    return found
      ? { amountMinor: found.amountMinor, currency: found.currency }
      : null;
  };

  let scheduledPlanKey: string | null = null;
  if (account?.subscriptionRef) {
    try {
      const subscription = await gateway.readSubscription(
        account.subscriptionRef,
      );
      scheduledPlanKey =
        planForPrice(plans, subscription.scheduledPriceId)?.key ?? null;
    } catch {
      // The screen says everything else it knows. A scheduled move is the one
      // sentence that goes missing while the provider is not answering.
    }
  }

  return {
    currentPlanKey: own?.planKey ?? null,
    status: account?.status ?? null,
    hasAccount: Boolean(account),
    hasLiveSubscription: Boolean(
      account?.status && LIVE_STATUSES.has(account.status),
    ),
    currentPeriodEnd: account?.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: account?.cancelAtPeriodEnd ?? false,
    suspendedByBilling: account?.suspendedByBilling ?? false,
    scheduledPlanKey,
    pricesAvailable,
    defaultPlanKey: defaultPlan?.key ?? null,
    creditPack: (() => {
      const price = onSale ? priceOf(onSale.priceId) : null;
      return onSale && price ? { credits: onSale.credits, ...price } : null;
    })(),
    plans: plans.map((plan) => ({
      key: plan.key,
      name: plan.name,
      seats: plan.seats,
      month: priceOf(plan.prices?.month),
      year: priceOf(plan.prices?.year),
    })),
  };
}

const planWithPrice = async (
  pool: Pool,
  planKey: string,
  interval: BillingInterval,
): Promise<{ readonly plan: Plan; readonly priceId: string }> => {
  const plan = (await readPlans(pool)).find((entry) => entry.key === planKey);
  const priceId = plan?.prices?.[interval];
  if (!plan || !priceId) {
    throw new OperationError(
      "not_found",
      `That plan cannot be bought ${interval === "year" ? "yearly" : "monthly"} here.`,
    );
  }
  return { plan, priceId };
};

const requireGateway = (gateway?: BillingGateway): BillingGateway => {
  if (!gateway) {
    throw new OperationError("forbidden", NOT_SET_UP);
  }
  return gateway;
};

const requireBaseUrl = (baseUrl?: string): string => {
  if (!baseUrl) {
    throw new OperationError("forbidden", NOT_SET_UP);
  }
  return baseUrl;
};

export async function startSubscriptionCheckout(
  pool: Pool,
  input: {
    readonly workspaceId: string;
    readonly userId?: string;
    readonly planKey: string;
    readonly interval: BillingInterval;
    readonly gateway?: BillingGateway;
    readonly baseUrl?: string;
  },
): Promise<{ readonly url: string }> {
  const gateway = requireGateway(input.gateway);
  const baseUrl = requireBaseUrl(input.baseUrl);
  const { plan, priceId } = await planWithPrice(
    pool,
    input.planKey,
    input.interval,
  );
  const account = await readBillingAccount(pool, input.workspaceId);
  if (account?.status && LIVE_STATUSES.has(account.status)) {
    throw new OperationError(
      "forbidden",
      "This workspace already has a subscription. Change its plan instead.",
    );
  }
  // Checked before the money rather than after: the webhook would otherwise have to
  // make a workspace read-only the moment somebody paid.
  const used = await countSeats(pool, input.workspaceId);
  if (plan.seats !== null && used > plan.seats) {
    refuseBelowHeadcount(plan.name, plan.seats, used);
  }

  const [user] = input.userId
    ? await drizzle(pool)
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1)
    : [];
  return gateway.startCheckout({
    mode: "subscription",
    priceId,
    workspaceId: input.workspaceId,
    successUrl: `${baseUrl}/admin/plan?checkout=done`,
    cancelUrl: `${baseUrl}/admin/plan`,
    ...(account?.customerRef
      ? { customerRef: account.customerRef }
      : user?.email
        ? { customerEmail: user.email }
        : {}),
  });
}

/** A one-off checkout for the credit pack, on a plan that can buy one. */
export async function buyCreditPack(
  pool: Pool,
  input: {
    readonly workspaceId: string;
    readonly userId?: string;
    readonly gateway?: BillingGateway;
    readonly baseUrl?: string;
  },
): Promise<{ readonly url: string }> {
  const gateway = requireGateway(input.gateway);
  const baseUrl = requireBaseUrl(input.baseUrl);
  const [pack, hosted, account] = await Promise.all([
    readCreditPack(pool),
    readHostedAccess(pool, input.workspaceId),
    readBillingAccount(pool, input.workspaceId),
  ]);
  if (!pack || hosted.kind !== "credits" || !hosted.topUps) {
    throw new OperationError(
      "forbidden",
      "This workspace's plan cannot buy more credits.",
    );
  }
  const [user] = input.userId
    ? await drizzle(pool)
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1)
    : [];
  return gateway.startCheckout({
    mode: "payment",
    priceId: pack.priceId,
    workspaceId: input.workspaceId,
    credits: pack.credits,
    months: pack.months,
    successUrl: `${baseUrl}/admin/plan?checkout=done`,
    cancelUrl: `${baseUrl}/admin/plan`,
    ...(account?.customerRef
      ? { customerRef: account.customerRef }
      : user?.email
        ? { customerEmail: user.email }
        : {}),
  });
}

export async function openBillingPortal(
  pool: Pool,
  input: {
    readonly workspaceId: string;
    readonly gateway?: BillingGateway;
    readonly baseUrl?: string;
  },
): Promise<{ readonly url: string }> {
  const gateway = requireGateway(input.gateway);
  const baseUrl = requireBaseUrl(input.baseUrl);
  const account = await readBillingAccount(pool, input.workspaceId);
  if (!account) {
    throw new OperationError(
      "forbidden",
      "This workspace has no billing account yet.",
    );
  }
  return gateway.openPortal({
    customerRef: account.customerRef,
    returnUrl: `${baseUrl}/admin/plan`,
  });
}

/**
 * Moves a live subscription to another plan.
 *
 * Fewer seats waits for the period's end and charges nothing today, because they
 * have paid for the seats they have. So does yearly to monthly on the same plan.
 * Anything else happens now, and Stripe charges the difference.
 */
export async function changeSubscriptionPlan(
  pool: Pool,
  input: {
    readonly workspaceId: string;
    readonly planKey: string;
    readonly interval: BillingInterval;
    readonly gateway?: BillingGateway;
  },
): Promise<{ readonly when: "now" | "period_end" }> {
  const gateway = requireGateway(input.gateway);
  const { plan, priceId } = await planWithPrice(
    pool,
    input.planKey,
    input.interval,
  );
  const account = await readBillingAccount(pool, input.workspaceId);
  if (
    !account?.subscriptionRef ||
    !account.status ||
    !LIVE_STATUSES.has(account.status)
  ) {
    throw new OperationError(
      "forbidden",
      "This workspace has no subscription to change. Subscribe first.",
    );
  }
  // Before Stripe is called, so a refused move has cost nothing.
  const used = await countSeats(pool, input.workspaceId);
  if (plan.seats !== null && used > plan.seats) {
    refuseBelowHeadcount(plan.name, plan.seats, used);
  }

  const plans = await readPlans(pool);
  const subscription = await gateway.readSubscription(account.subscriptionRef);
  const current = planForPrice(plans, subscription.priceId);
  const seatsOf = (entry?: Plan) => entry?.seats ?? Number.POSITIVE_INFINITY;
  const fewerSeats = seatsOf(plan) < seatsOf(current);
  const yearlyToMonthly =
    plan.key === current?.key &&
    input.interval === "month" &&
    subscription.priceId === current.prices?.year;

  const when = fewerSeats || yearlyToMonthly ? "period_end" : "now";
  await gateway.changeSubscription({
    subscriptionRef: account.subscriptionRef,
    priceId,
    when,
  });
  return { when };
}

/**
 * Takes a workspace billing made read-only back to the default plan, once its people
 * fit. The webhook cannot do this: nothing happens at the provider when an
 * administrator suspends a member.
 */
export async function settleEndedInTx(
  tx: OperationTx,
  input: { readonly workspaceId: string; readonly plan: Plan | null },
): Promise<void> {
  const [account] = await tx
    .select({ suspendedByBilling: billingAccounts.suspendedByBilling })
    .from(billingAccounts)
    .where(
      activeOnly(
        billingAccounts,
        eq(billingAccounts.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  if (!account?.suspendedByBilling) {
    throw new OperationError(
      "forbidden",
      "Billing did not make this workspace read-only.",
    );
  }
  const seats = input.plan?.seats ?? null;
  const used = await seatsInUseInTx(tx, input.workspaceId);
  if (seats !== null && used > seats) {
    refuseBelowHeadcount(input.plan?.name ?? "free", seats, used);
  }
  await applyPlanInTx(tx, input);
  await setTenantStateInTx(tx, {
    workspaceId: input.workspaceId,
    state: "active",
  });
  // openokr:allow-mutation: the caller's Operation transaction.
  await tx
    .update(billingAccounts)
    .set({ suspendedByBilling: false, updatedAt: new Date() })
    .where(
      activeOnly(
        billingAccounts,
        eq(billingAccounts.workspaceId, input.workspaceId),
      ),
    );
}
