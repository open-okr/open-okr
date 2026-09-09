"use server";

/**
 * The four steps of S-34, each one a write the product already had (P6-G26).
 *
 * **Nothing new is stored to make onboarding work.** The timezone and language
 * are the §4.14 general settings, the rhythm is `rhythm.update`, the invitation
 * is `invitations.createLink`, and the demo is the builder P3-T17 wrote. What
 * the wizard adds is the order and the offer, which is why skipping a step
 * costs nothing: the default was already resolved at provisioning.
 *
 * **The demo is called as a function, not through the registry, and the plan's
 * own description of P3-T17 is what is wrong here.** That row says it built
 * "an in-product, flag-gated action"; it built `buildDemoWorkspace` and a seed
 * command, and no action. Adding one now would be a second door onto the same
 * builder with nobody asking for it: this server action holds the pool, the
 * builder makes every write through `callAction` so the Operation pipeline is
 * still what writes, and the CLI already has its own way in.
 */

import { buildDemoWorkspace, callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../lib/auth";
import { requireWorkspace } from "../../lib/workspace";

export interface StepResult {
  readonly error: string | null;
}

async function context() {
  const { session, workspace } = await requireWorkspace();
  return {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
    userId: session.user.id,
  };
}

const refusal = (error: unknown): StepResult => {
  if (error instanceof OperationError) {
    return { error: error.message };
  }
  throw error;
};

/** Step one: what this workspace is called and what clock it keeps. */
export async function saveBasics(input: {
  name?: string;
  timezone?: string;
}): Promise<StepResult> {
  const { userId, ...ctx } = await context();
  try {
    if (input.name && input.name.trim() !== "") {
      await callAction(ctx, "workspace.rename", { name: input.name.trim() });
    }
    if (input.timezone && input.timezone.trim() !== "") {
      await callAction(ctx, "settings.updateWorkspaceGeneral", {
        timezone: input.timezone.trim(),
      });
    }
  } catch (error) {
    return refusal(error);
  }
  revalidatePath("/", "layout");
  return { error: null };
}

/** Step two: how often the practice asks for a check-in. */
export async function saveRhythm(input: {
  defaultCheckInFrequency?: "weekly" | "biweekly" | "monthly";
  checkInAnchorDay?: number;
}): Promise<StepResult> {
  const { userId, ...ctx } = await context();
  try {
    await callAction(ctx, "rhythm.update", {
      ...(input.defaultCheckInFrequency
        ? { defaultCheckInFrequency: input.defaultCheckInFrequency }
        : {}),
      ...(input.checkInAnchorDay
        ? { checkInAnchorDay: input.checkInAnchorDay }
        : {}),
    });
  } catch (error) {
    return refusal(error);
  }
  return { error: null };
}

/** Step three: one invitation, because the first one is the hard one. */
export async function inviteSomebody(input: {
  email?: string;
}): Promise<StepResult> {
  const { userId, ...ctx } = await context();
  const email = (input.email ?? "").trim();
  if (email === "") {
    return { error: null };
  }
  try {
    await callAction(ctx, "invitations.createPersonalLink", { email });
  } catch (error) {
    return refusal(error);
  }
  return { error: null };
}

/**
 * Step four: a workspace with something in it, or an empty one.
 *
 * **Idempotent by the builder's own check**, which asks whether any company
 * objective exists rather than keeping a flag: it is the thing the builder
 * always writes and nothing else creates on a fresh workspace. Pressing this
 * twice costs one read.
 */
export async function buildDemo(): Promise<StepResult> {
  const { userId, ...ctx } = await context();
  try {
    // **`demoEnabled` is deliberately left alone.** It gates the seed
    // *command*, which an operator runs deliberately; the wizard building the
    // demo once is not a standing instruction to seed again on the next run,
    // and setting the flag here would claim it was.
    await buildDemoWorkspace({
      pool: ctx.pool,
      workspaceId: ctx.workspaceId,
      adminUserId: userId,
    });
  } catch (error) {
    return refusal(error);
  }
  revalidatePath("/", "layout");
  return { error: null };
}

/** The end, whether or not anything was answered. */
export async function finishOnboarding(): Promise<StepResult> {
  const { userId, ...ctx } = await context();
  try {
    await callAction(ctx, "workspace.finishOnboarding", {});
  } catch (error) {
    return refusal(error);
  }
  revalidatePath("/", "layout");
  return { error: null };
}
