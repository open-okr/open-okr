/**
 * The billing actions (docs/design/billing.md §8).
 *
 * **None is on the agent surface.** An agent does not spend somebody's money.
 *
 * The ones that talk to the provider are declared by hand rather than through the
 * write builder, because the write builder holds a transaction open across its work,
 * and the provider's network has no place in one. So each enforces its declared level
 * itself, as `requireDeclaredAccess` says a hand-declared action must, and then leaves
 * its audit row through the pipeline. The plan itself moves when the webhook arrives.
 */
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import {
  buyCreditPack,
  changeSubscriptionPlan,
  openBillingPortal,
  readBillingSummary,
  recordBillingRequest,
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
  runsThroughPipeline: true,
  async handler(context: ActionCallContext, rawInput: unknown) {
    await requireDeclaredAccess(
      context,
      ACCESS_LEVELS.full,
      "billing.startCheckout",
    );
    const input = choosePlan.parse(rawInput);
    const answer = await startSubscriptionCheckout(context.pool, {
      workspaceId: context.workspaceId,
      ...(context.actor.userId ? { userId: context.actor.userId } : {}),
      ...input,
      ...(context.billing ? { gateway: context.billing } : {}),
      ...(context.baseUrl ? { baseUrl: context.baseUrl } : {}),
    });
    await recordBillingRequest(context.pool, {
      workspaceId: context.workspaceId,
      actor: context.actor,
      action: "billing.startCheckout",
      payload: input,
    });
    return answer;
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
  runsThroughPipeline: true,
  async handler(context: ActionCallContext) {
    await requireDeclaredAccess(
      context,
      ACCESS_LEVELS.full,
      "billing.buyCredits",
    );
    const answer = await buyCreditPack(context.pool, {
      workspaceId: context.workspaceId,
      ...(context.actor.userId ? { userId: context.actor.userId } : {}),
      ...(context.billing ? { gateway: context.billing } : {}),
      ...(context.baseUrl ? { baseUrl: context.baseUrl } : {}),
    });
    await recordBillingRequest(context.pool, {
      workspaceId: context.workspaceId,
      actor: context.actor,
      action: "billing.buyCredits",
      payload: {},
    });
    return answer;
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
  runsThroughPipeline: true,
  async handler(context: ActionCallContext) {
    await requireDeclaredAccess(
      context,
      ACCESS_LEVELS.full,
      "billing.openPortal",
    );
    const answer = await openBillingPortal(context.pool, {
      workspaceId: context.workspaceId,
      ...(context.billing ? { gateway: context.billing } : {}),
      ...(context.baseUrl ? { baseUrl: context.baseUrl } : {}),
    });
    await recordBillingRequest(context.pool, {
      workspaceId: context.workspaceId,
      actor: context.actor,
      action: "billing.openPortal",
      payload: {},
    });
    return answer;
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
  runsThroughPipeline: true,
  async handler(context: ActionCallContext, rawInput: unknown) {
    await requireDeclaredAccess(
      context,
      ACCESS_LEVELS.full,
      "billing.changePlan",
    );
    const input = choosePlan.parse(rawInput);
    const answer = await changeSubscriptionPlan(context.pool, {
      workspaceId: context.workspaceId,
      ...input,
      ...(context.billing ? { gateway: context.billing } : {}),
    });
    await recordBillingRequest(context.pool, {
      workspaceId: context.workspaceId,
      actor: context.actor,
      action: "billing.changePlan",
      payload: { ...input, when: answer.when },
    });
    return answer;
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
