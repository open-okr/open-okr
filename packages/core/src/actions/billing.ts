/**
 * The billing actions (docs/design/billing.md §8).
 *
 * **None is on the agent surface.** An agent does not spend somebody's money.
 *
 * The three that talk to the provider are declared by hand rather than through the
 * write builder, because they write nothing here: Stripe is told, and the plan moves
 * when its webhook arrives. So each enforces its declared level itself, as
 * `requireDeclaredAccess` says a hand-declared action must.
 */
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import {
  buyCreditPack,
  changeSubscriptionPlan,
  openBillingPortal,
  readBillingSummary,
  settleEndedInTx,
  startSubscriptionCheckout,
} from "../billing/service.ts";
import { OperationError } from "../operations/operation.ts";
import { resolveDefaultPlan } from "../tenancy/index.ts";
import {
  type ActionCallContext,
  defineReadAction,
  defineWriteAction,
  requireDeclaredAccess,
} from "./define.ts";

const planPrice = z
  .object({ amountMinor: z.number().nullable(), currency: z.string() })
  .nullable();

const intervalSchema = z.enum(["month", "year"]);

const choosePlan = z.object({
  planKey: z.string().trim().min(1).max(50),
  interval: intervalSchema,
});

const addressOnly = z.object({ url: z.string() });

export const readBilling = defineReadAction({
  name: "billing.summary",
  summary:
    "The plan, its status, and every plan's price as the payment provider states it.",
  input: z.object({}),
  output: z.object({
    currentPlanKey: z.string().nullable(),
    status: z.string().nullable(),
    hasAccount: z.boolean(),
    hasLiveSubscription: z.boolean(),
    currentPeriodEnd: z.string().nullable(),
    cancelAtPeriodEnd: z.boolean(),
    suspendedByBilling: z.boolean(),
    scheduledPlanKey: z.string().nullable(),
    pricesAvailable: z.boolean(),
    defaultPlanKey: z.string().nullable(),
    creditPack: z
      .object({
        credits: z.number(),
        amountMinor: z.number().nullable(),
        currency: z.string(),
      })
      .nullable(),
    plans: z.array(
      z.object({
        key: z.string(),
        name: z.string(),
        seats: z.number().nullable(),
        month: planPrice,
        year: planPrice,
      }),
    ),
  }),
  access: ACCESS_LEVELS.full,
  agentSurface: false,
  async handler(context) {
    if (!context.billing) {
      throw new OperationError(
        "forbidden",
        "Billing is not set up on this instance.",
      );
    }
    return readBillingSummary(
      context.pool,
      context.workspaceId,
      context.billing,
    );
  },
});

export const startCheckout = {
  name: "billing.startCheckout" as const,
  agentSurface: false as const,
  summary: "An address to pay at, to start a subscription on this plan.",
  input: choosePlan,
  output: addressOnly,
  access: ACCESS_LEVELS.full,
  safety: "write" as const,
  // It writes nothing: the plan moves when the provider's webhook arrives.
  runsThroughPipeline: false,
  async handler(context: ActionCallContext, rawInput: unknown) {
    await requireDeclaredAccess(
      context,
      ACCESS_LEVELS.full,
      "billing.startCheckout",
    );
    const input = choosePlan.parse(rawInput);
    return startSubscriptionCheckout(context.pool, {
      workspaceId: context.workspaceId,
      ...(context.actor.userId ? { userId: context.actor.userId } : {}),
      ...input,
      ...(context.billing ? { gateway: context.billing } : {}),
      ...(context.baseUrl ? { baseUrl: context.baseUrl } : {}),
    });
  },
};

export const buyCredits = {
  name: "billing.buyCredits" as const,
  agentSurface: false as const,
  summary: "An address to pay at, for the provider's pack of AI credits.",
  input: z.object({}),
  output: addressOnly,
  access: ACCESS_LEVELS.full,
  safety: "write" as const,
  // It writes nothing: the credits arrive with the provider's webhook.
  runsThroughPipeline: false,
  async handler(context: ActionCallContext) {
    await requireDeclaredAccess(
      context,
      ACCESS_LEVELS.full,
      "billing.buyCredits",
    );
    return buyCreditPack(context.pool, {
      workspaceId: context.workspaceId,
      ...(context.actor.userId ? { userId: context.actor.userId } : {}),
      ...(context.billing ? { gateway: context.billing } : {}),
      ...(context.baseUrl ? { baseUrl: context.baseUrl } : {}),
    });
  },
};

export const openPortal = {
  name: "billing.openPortal" as const,
  agentSurface: false as const,
  summary: "An address to manage cards and invoices, and to cancel.",
  input: z.object({}),
  output: addressOnly,
  access: ACCESS_LEVELS.full,
  safety: "write" as const,
  runsThroughPipeline: false,
  async handler(context: ActionCallContext) {
    await requireDeclaredAccess(
      context,
      ACCESS_LEVELS.full,
      "billing.openPortal",
    );
    return openBillingPortal(context.pool, {
      workspaceId: context.workspaceId,
      ...(context.billing ? { gateway: context.billing } : {}),
      ...(context.baseUrl ? { baseUrl: context.baseUrl } : {}),
    });
  },
};

export const changeBillingPlan = {
  name: "billing.changePlan" as const,
  agentSurface: false as const,
  summary:
    "Moves a subscription to another plan: now for more seats, at the period's end for fewer. Refused below the headcount.",
  input: choosePlan,
  output: z.object({ when: z.enum(["now", "period_end"]) }),
  access: ACCESS_LEVELS.full,
  safety: "write" as const,
  runsThroughPipeline: false,
  async handler(context: ActionCallContext, rawInput: unknown) {
    await requireDeclaredAccess(
      context,
      ACCESS_LEVELS.full,
      "billing.changePlan",
    );
    const input = choosePlan.parse(rawInput);
    return changeSubscriptionPlan(context.pool, {
      workspaceId: context.workspaceId,
      ...input,
      ...(context.billing ? { gateway: context.billing } : {}),
    });
  },
};

export const settleEnded = defineWriteAction({
  name: "billing.settleEnded",
  summary:
    "Moves a workspace billing made read-only to the default plan, once its people fit.",
  input: z.object({}),
  output: z.object({ planKey: z.string().nullable() }),
  access: ACCESS_LEVELS.full,
  agentSurface: false,
  operation: (context) => ({
    // Read before the change, outside the workspace's transaction, because the
    // catalogue belongs to the instance rather than to any tenant.
    async load(): Promise<{
      plan: Awaited<ReturnType<typeof resolveDefaultPlan>>;
    }> {
      return { plan: await resolveDefaultPlan(context.pool) };
    },
    async execute({ tx, workspaceId, loaded: { plan } }) {
      await settleEndedInTx(tx, { workspaceId, plan });
      return {
        result: { planKey: plan?.key ?? null },
        activity: {
          kind: "workspace.plan_changed",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { plan: plan?.name ?? "Free", seats: plan?.seats ?? null },
        },
        audit: {
          action: "billing.settleEnded",
          targetType: "workspace",
          targetId: workspaceId,
          payload: { planKey: plan?.key ?? null },
        },
      };
    },
  }),
});
