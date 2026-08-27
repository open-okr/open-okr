"use server";

import { callAction } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/pool";
import { getKeyRing } from "../../../lib/secrets";
import { requireWorkspace } from "../../../lib/workspace";
import type { FormResult } from "./form-state.ts";

/**
 * The channel settings writes (P5-T02c).
 *
 * Every one goes through the action registry, which is where the access level
 * and the input schema live. Nothing here decides who may do what.
 *
 * The key ring is on the context because connecting seals a credential, and
 * `channels.connect` refuses a host that did not supply one rather than
 * storing a secret in the clear.
 */
async function context() {
  const { session, workspace } = await requireWorkspace();
  return {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
    ring: getKeyRing(),
  };
}

/**
 * Connects a provider.
 *
 * The credential arrives once and is never sent back. A form that pre-filled
 * the current token so an administrator could "check it" would be a screen that
 * displays a bot token, which is the one thing this whole shape exists to
 * prevent.
 */
export async function connectProvider(
  _previous: FormResult | null,
  form: FormData,
): Promise<FormResult> {
  const provider = String(form.get("provider") ?? "");
  const botToken = String(form.get("botToken") ?? "").trim();
  const signingSecret = String(form.get("signingSecret") ?? "").trim();
  const teamId = String(form.get("teamId") ?? "").trim();

  if (!botToken || !signingSecret || !teamId) {
    return {
      ok: false,
      message:
        "All three are needed: the bot token to send with, the signing secret to verify what arrives, and the workspace id to route it to.",
    };
  }

  try {
    await callAction(await context(), "channels.connect", {
      provider: provider as "slack" | "teams" | "whatsapp" | "telegram",
      // One string, the provider's own shape. The table stays the same for
      // every provider and the driver decides what its secret looks like.
      credentials: JSON.stringify({ botToken, signingSecret }),
      config: { teamId },
    });
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "That did not work.",
    };
  }

  revalidatePath("/admin/channels");
  // The member's own page offers a provider to link only while the workspace
  // has it connected, so installing or removing one changes that page too.
  revalidatePath("/account/channels");
  // No message: the revalidation replaces the tree this form is in, so nothing
  // said here could be read. The card itself says the connection is stored and
  // unverified, which is a fact about the connection rather than about the
  // request and therefore survives the reload.
  return { ok: true, message: "" };
}

export async function disconnectProvider(
  _previous: FormResult | null,
  form: FormData,
): Promise<FormResult> {
  const provider = String(form.get("provider") ?? "");
  try {
    await callAction(await context(), "channels.disconnect", {
      provider: provider as "slack" | "teams" | "whatsapp" | "telegram",
    });
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "That did not work.",
    };
  }
  revalidatePath("/admin/channels");
  // The member's own page offers a provider to link only while the workspace
  // has it connected, so installing or removing one changes that page too.
  revalidatePath("/account/channels");
  return { ok: true, message: `${provider} is disconnected.` };
}

/**
 * Sends a test to the administrator pressing the button.
 *
 * `attempt` is passed rather than read from a clock inside the action, because
 * the engine never reads a clock: the caller decides that this press is a
 * different press from the last one.
 */
export async function sendTest(
  _previous: FormResult | null,
  form: FormData,
): Promise<FormResult> {
  const attempt = String(form.get("attempt") ?? "").trim();
  try {
    await callAction(await context(), "channels.testSend", {
      attempt: attempt || "manual",
    });
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "That did not work.",
    };
  }
  revalidatePath("/admin/channels");
  // The member's own page offers a provider to link only while the workspace
  // has it connected, so installing or removing one changes that page too.
  revalidatePath("/account/channels");
  return {
    ok: true,
    message:
      "Queued. The relay delivers it within the minute; the log below says what happened.",
  };
}
