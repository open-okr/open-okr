/**
 * What a verified webhook does to a workspace (docs/design/billing.md §5 and §6).
 *
 * **The subscription is read from the provider rather than from the event**, because
 * events can arrive out of order, and the older one arriving last must not undo the
 * newer. So every event means the same thing: go and look.
 *
 * **Nothing here removes a person.** A subscription that ends moves the workspace to
 * the default plan if its people fit, and otherwise makes it read-only until they
 * do or payment resumes. `applyPlanInTx` refuses a plan smaller than the headcount,
 * which is right for a choice and wrong for a subscription that has already ended,
 * so this checks first rather than calling it and failing.
 */
import {
  activeOnly,
  billingAccounts,
  billingEvents,
  tenants,
  withWorkspace,
  workspaces,
} from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { z } from "zod";
import { OperationError } from "../operations/errors.ts";
import { type OperationTx, runOperation } from "../operations/operation.ts";
import {
  addCreditPackInTx,
  applyPlanInTx,
  creditValueUsd,
  type Plan,
  readPlans,
  resolveDefaultPlan,
  seatsInUseInTx,
  setTenantStateInTx,
} from "../tenancy/index.ts";
import type {
  BillingGateway,
  SubscriptionSnapshot,
  VerifiedBillingEvent,
} from "./gateway.ts";
import { DEFAULT_CREDIT_PACK_MONTHS, readCreditPack } from "./settings.ts";

/** Paying, or about to be. */
export const LIVE_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "trialing",
]);
/** Over. Anything else, `past_due` for one, keeps what it has while Stripe retries. */
const ENDED_STATUSES: ReadonlySet<string> = new Set([
  "canceled",
  "unpaid",
  "incomplete_expired",
]);

export type BillingOutcome = "applied" | "duplicate" | "ignored";

/** Thrown to roll the transaction back when an event has been applied before. */
class AlreadyApplied extends Error {}

/** Which catalogue row a provider's price belongs to. */
export const planForPrice = (
  plans: readonly Plan[],
  priceId: string | null,
): Plan | undefined =>
  priceId === null
    ? undefined
    : plans.find(
        (plan) =>
          plan.prices?.month === priceId || plan.prices?.year === priceId,
      );

/** Puts a workspace on a plan, or read-only when its people do not fit. */
async function settleOntoPlanInTx(
  tx: OperationTx,
  input: {
    readonly workspaceId: string;
    readonly plan: Plan | null;
    readonly suspendedByBilling: boolean;
    readonly tenantState: string;
    /** The trial sweep's read-only mode, which a subscription lifts too (T8). */
    readonly suspendedByTrial?: boolean;
  },
): Promise<{ readonly suspendedByBilling: boolean; readonly moved: boolean }> {
  const seats = input.plan?.seats ?? null;
  const used = await seatsInUseInTx(tx, input.workspaceId);
  if (seats !== null && used > seats) {
    // A suspension an operator imposed stays theirs, whatever happens to the bill.
    if (input.tenantState !== "active") {
      return { suspendedByBilling: input.suspendedByBilling, moved: false };
    }
    await setTenantStateInTx(tx, {
      workspaceId: input.workspaceId,
      state: "suspended",
    });
    return { suspendedByBilling: true, moved: false };
  }
  await applyPlanInTx(tx, { workspaceId: input.workspaceId, plan: input.plan });
  if (
    (input.suspendedByBilling || input.suspendedByTrial) &&
    input.tenantState === "suspended"
  ) {
    await setTenantStateInTx(tx, {
      workspaceId: input.workspaceId,
      state: "active",
    });
  }
  return { suspendedByBilling: false, moved: true };
}

async function applySubscription(
  pool: Pool,
  input: {
    readonly provider: string;
    readonly eventRef: string;
    readonly workspaceId: string;
    readonly subscription: SubscriptionSnapshot;
  },
): Promise<void> {
  const { subscription } = input;
  // Instance settings, read here because a tenant's transaction cannot.
  const plans = await readPlans(pool);
  const defaultPlan = await resolveDefaultPlan(pool);
  const live = LIVE_STATUSES.has(subscription.status);
  const ended = ENDED_STATUSES.has(subscription.status);
  const target = live ? planForPrice(plans, subscription.priceId) : undefined;

  await runOperation(
    { pool },
    {
      action: "billing.subscription_changed",
      workspaceId: input.workspaceId,
      actor: { kind: "system" },
      // Nobody is acting: the provider told us, and the signature says it did.
      bootstrap: true,
      async execute({ tx, workspaceId }) {
        // openokr:allow-mutation: this operation's own transaction.
        const inserted = await tx
          .insert(billingEvents)
          .values({
            provider: input.provider,
            eventRef: input.eventRef,
            workspaceId,
          })
          .onConflictDoNothing()
          .returning({ eventRef: billingEvents.eventRef });
        if (inserted.length === 0) {
          throw new AlreadyApplied();
        }

        const [account] = await tx
          .select({ suspendedByBilling: billingAccounts.suspendedByBilling })
          .from(billingAccounts)
          .where(
            activeOnly(
              billingAccounts,
              eq(billingAccounts.workspaceId, workspaceId),
            ),
          )
          .limit(1);
        const [tenant] = await tx
          .select({
            state: tenants.state,
            suspendedByTrial: tenants.suspendedByTrial,
          })
          .from(tenants)
          .where(activeOnly(tenants, eq(tenants.workspaceId, workspaceId)))
          .limit(1);

        let suspendedByBilling = account?.suspendedByBilling ?? false;
        let planName: string | null = null;
        // No tenant record means nothing to move. The flag can be turned on
        // after a subscription starts, and the account below still records it.
        if (tenant && (target || ended)) {
          const plan = target ?? defaultPlan;
          const settled = await settleOntoPlanInTx(tx, {
            workspaceId,
            plan,
            suspendedByBilling,
            tenantState: tenant.state,
            suspendedByTrial: tenant.suspendedByTrial,
          });
          suspendedByBilling = settled.suspendedByBilling;
          planName = settled.moved ? (plan?.name ?? null) : null;
        }
        // Choosing a plan ends the trial (tenant-lifecycle.md §11 T3): a live
        // subscription is a choice, so the sweep has nothing left to settle.
        if (tenant && live) {
          // openokr:allow-mutation: this operation's own transaction.
          await tx
            .update(tenants)
            .set({ trialEndsAt: null, trialRemindedAt: null })
            .where(activeOnly(tenants, eq(tenants.workspaceId, workspaceId)));
        }

        const values = {
          provider: input.provider,
          customerRef: subscription.customerRef,
          subscriptionRef: subscription.ref,
          status: subscription.status,
          currentPeriodEnd: subscription.currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          suspendedByBilling,
          updatedAt: new Date(),
        };
        // openokr:allow-mutation: this operation's own transaction.
        await tx
          .insert(billingAccounts)
          .values({ workspaceId, ...values })
          .onConflictDoUpdate({
            target: billingAccounts.workspaceId,
            set: values,
          });

        return {
          result: undefined,
          activity: {
            kind: "billing.subscription_changed",
            subjectType: "workspace",
            subjectId: workspaceId,
            payload: { status: subscription.status },
          },
          audit: {
            action: "billing.subscription_changed",
            targetType: "workspace",
            targetId: workspaceId,
            payload: {
              provider: input.provider,
              eventRef: input.eventRef,
              status: subscription.status,
              plan: planName,
              suspendedByBilling,
            },
          },
        };
      },
    },
  );
}

const workspaceIdSchema = z.uuid();

/**
 * A paid credit pack (docs/design/ai-credits.md §6).
 *
 * In model cost at this instance's credit value, read now rather than at checkout: a
 * credit is what this instance says it is, and that is what the balance is kept in.
 */
async function applyCreditPack(
  pool: Pool,
  input: {
    readonly provider: string;
    readonly eventRef: string;
    readonly workspaceId: string;
    readonly sessionRef: string;
    readonly credits: number;
    readonly months: number | null;
  },
): Promise<void> {
  const value = await creditValueUsd(pool);
  // The length the checkout was sold with. One that named none is from before a
  // checkout carried it, and takes what the instance says now.
  const months =
    input.months ??
    (await readCreditPack(pool))?.months ??
    DEFAULT_CREDIT_PACK_MONTHS;
  await runOperation(
    { pool },
    {
      action: "billing.credits_purchased",
      workspaceId: input.workspaceId,
      actor: { kind: "system" },
      bootstrap: true,
      async execute({ tx, workspaceId }) {
        // openokr:allow-mutation: this operation's own transaction.
        const inserted = await tx
          .insert(billingEvents)
          .values({
            provider: input.provider,
            eventRef: input.eventRef,
            workspaceId,
          })
          .onConflictDoNothing()
          .returning({ eventRef: billingEvents.eventRef });
        if (inserted.length === 0) {
          throw new AlreadyApplied();
        }
        const added = await addCreditPackInTx(tx, {
          workspaceId,
          credits: input.credits,
          amountUsd: input.credits * value,
          purchaseRef: input.sessionRef,
          months,
        });
        if (!added) {
          // The same checkout under another event: one purchase is one pack.
          throw new AlreadyApplied();
        }
        return {
          result: undefined,
          activity: {
            kind: "billing.credits_purchased",
            subjectType: "workspace",
            subjectId: workspaceId,
            payload: { credits: input.credits },
          },
          audit: {
            action: "billing.credits_purchased",
            targetType: "workspace",
            targetId: workspaceId,
            payload: {
              provider: input.provider,
              eventRef: input.eventRef,
              credits: input.credits,
              months,
            },
          },
        };
      },
    },
  );
}

/**
 * Whether the workspace an event names is still here. One erased, or being erased,
 * is acknowledged with nothing written, because there is nothing left to write to
 * and refusing would have Stripe retry for days (workspace-erasure.md §2).
 */
async function workspaceIsHere(
  pool: Pool,
  workspaceId: string,
): Promise<boolean> {
  const [row] = await withWorkspace(drizzle(pool), workspaceId, (tx) =>
    tx
      .select({ id: workspaces.id })
      // openokr:allow-raw-read: the system asking whether the workspace an event
      // names still exists. Nobody reads on anybody's behalf, and only the id
      // comes back.
      .from(workspaces)
      .where(activeOnly(workspaces, eq(workspaces.id, workspaceId)))
      .limit(1),
  );
  return Boolean(row);
}

export async function applyBillingEvent(
  pool: Pool,
  gateway: Pick<BillingGateway, "provider" | "readSubscription">,
  event: VerifiedBillingEvent,
): Promise<BillingOutcome> {
  if (event.kind === "ignored") {
    return "ignored";
  }
  // A signed event with no workspace of ours on it: somebody else's product on the
  // same Stripe account, usually. Acknowledged, so Stripe stops retrying it.
  const workspaceId = workspaceIdSchema.safeParse(event.workspaceId);
  if (!workspaceId.success) {
    return "ignored";
  }
  try {
    if (event.kind === "credit_pack") {
      if (!(await workspaceIsHere(pool, workspaceId.data))) {
        return "ignored";
      }
      await applyCreditPack(pool, {
        provider: gateway.provider,
        eventRef: event.eventRef,
        workspaceId: workspaceId.data,
        sessionRef: event.sessionRef,
        credits: event.credits,
        months: event.months,
      });
      return "applied";
    }
    if (!(await workspaceIsHere(pool, workspaceId.data))) {
      return "ignored";
    }
    const subscription = await gateway.readSubscription(event.subscriptionRef);
    await applySubscription(pool, {
      provider: gateway.provider,
      eventRef: event.eventRef,
      workspaceId: workspaceId.data,
      subscription,
    });
    return "applied";
  } catch (error) {
    if (error instanceof AlreadyApplied) {
      return "duplicate";
    }
    // The workspace has been erased, or is being. Acknowledged with nothing
    // written, because there is nothing left to write to, and refusing would
    // have Stripe retry for days (docs/design/workspace-erasure.md §2).
    if (error instanceof OperationError && error.code === "not_found") {
      return "ignored";
    }
    throw error;
  }
}
