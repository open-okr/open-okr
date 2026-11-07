"use server";

import { loadEnv } from "@openokr/config";
import { callAction } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getBilling } from "../../../lib/billing";
import { getPool } from "../../../lib/pool";
import { refusalOf } from "../../../lib/refusal";
import { requireWorkspace } from "../../../lib/workspace";

/**
 * Billing on S-49 (docs/design/billing.md §7).
 *
 * The actions hold every rule. An address comes back rather than being redirected to
 * here, because a form's redirect to another site is what `form-action` in the content
 * security policy refuses, so the page navigates itself. A refusal comes back as its
 * sentence, naming the two numbers when it is about seats.
 */
export interface BillingActionState {
  readonly error?: string;
  /** Somewhere to go: a hosted checkout or the portal. */
  readonly url?: string;
  /** A plan change was accepted, and when it takes effect. */
  readonly when?: "now" | "period_end";
  readonly settled?: boolean;
}

const context = async () => {
  const { session, workspace } = await requireWorkspace();
  const billing = await getBilling();
  return {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
    baseUrl: loadEnv().BETTER_AUTH_URL,
    ...(billing ? { billing } : {}),
  };
};

const refused = (error: unknown): BillingActionState => {
  const refusal = refusalOf(error);
  if (refusal === null) {
    throw error;
  }
  return { error: refusal };
};

const chosen = (formData: FormData) => ({
  planKey: String(formData.get("planKey") ?? ""),
  interval:
    formData.get("interval") === "year"
      ? ("year" as const)
      : ("month" as const),
});

export async function startCheckoutAction(
  formData: FormData,
): Promise<BillingActionState> {
  try {
    return await callAction(
      await context(),
      "billing.startCheckout",
      chosen(formData),
    );
  } catch (error) {
    return refused(error);
  }
}

export async function changePlanAction(
  formData: FormData,
): Promise<BillingActionState> {
  try {
    const { when } = await callAction(
      await context(),
      "billing.changePlan",
      chosen(formData),
    );
    revalidatePath("/admin/plan");
    return { when };
  } catch (error) {
    return refused(error);
  }
}

export async function openPortalAction(): Promise<BillingActionState> {
  try {
    return await callAction(await context(), "billing.openPortal", {});
  } catch (error) {
    return refused(error);
  }
}

export async function settleEndedAction(): Promise<BillingActionState> {
  try {
    await callAction(await context(), "billing.settleEnded", {});
    revalidatePath("/admin/plan");
    return { settled: true };
  } catch (error) {
    return refused(error);
  }
}
