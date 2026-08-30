"use server";

import {
  countVariables,
  type MetaTemplate,
  templateBody,
  WhatsAppChannel,
} from "@openokr/adapters";
import { callAction, openConnection, parseWhatsAppSecret } from "@openokr/core";
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
      // The provider's own shape. Slack signs the body and Telegram echoes
      // a secret it was given, so the second field means something different
      // to each: one string, two claims, and each driver parses its own.
      credentials: JSON.stringify(
        provider === "telegram"
          ? { botToken, webhookSecret: signingSecret }
          : provider === "whatsapp"
            ? // Three credentials, and one form with two secret boxes. The
              // second holds the app secret and the verify token, in that
              // order, because they are set together and a third box for a
              // value only this provider has would be a box every other
              // provider's card had to explain away.
              (() => {
                const [appSecret = "", verifyToken = ""] =
                  signingSecret.split(/\s+/);
                return { accessToken: botToken, appSecret, verifyToken };
              })()
            : provider === "teams"
              ? // Teams calls them an application id and a client secret, and the
                // first is also the audience its inbound tokens are issued for.
                // The form's two boxes carry them; naming them here rather than
                // in the form keeps one form for every provider.
                { appId: botToken, appPassword: signingSecret }
              : { botToken, signingSecret },
      ),
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

/**
 * Asks Meta which templates this workspace has, and records the answer
 * (P5-T04b-a).
 *
 * **The one place that may hold both a driver and the domain.** `packages/core`
 * may not call a provider, so the fetch happens here and the write goes through
 * `channels.syncTemplates`, which is one Operation. The same division the relay
 * already uses.
 *
 * **The business account is learned, not configured.** Every inbound webhook
 * body names it, so the inbound door records it on the connection the way the
 * Teams service URL is recorded. A workspace whose number has never received a
 * message has no account id to ask about, and is told that rather than shown an
 * empty list that looks like an answer.
 */
export async function syncTemplates(
  _previous: FormResult | null,
  // Unused: the button carries nothing. Present because `ChannelForm` passes
  // one, and a form component per arity would be a component per arity.
  _form?: FormData,
): Promise<FormResult> {
  const acting = await context();

  const connection = await openConnection(getPool(), getKeyRing(), {
    workspaceId: acting.workspaceId,
    provider: "whatsapp",
  });
  const secret = connection ? parseWhatsAppSecret(connection.secret) : null;
  const phoneNumberId = connection?.config.teamId;
  const businessAccountId = connection?.config.businessAccountId;

  if (!secret || typeof phoneNumberId !== "string") {
    return { ok: false, message: "WhatsApp is not connected." };
  }
  if (typeof businessAccountId !== "string") {
    return {
      ok: false,
      message:
        "This number has not received a message yet, so the business account it belongs to is not known. Send anything to it and try again.",
    };
  }

  const driver = new WhatsAppChannel({
    phoneNumberId,
    accessToken: secret.accessToken,
    appSecret: secret.appSecret,
    numberFor: () => null,
  });

  let found: readonly MetaTemplate[];
  try {
    found = await driver.listTemplates(businessAccountId);
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? `Meta refused the template list: ${error.message}`
          : "Meta refused the template list.",
    };
  }

  const outcome = await callAction(acting, "channels.syncTemplates", {
    templates: found
      .filter((template) => template.id && template.name && template.language)
      .map((template) => {
        const body = templateBody(template);
        return {
          metaId: template.id as string,
          name: template.name as string,
          language: template.language as string,
          status: template.status ?? "UNKNOWN",
          category: template.category ?? null,
          bodyText: body,
          variables: countVariables(body),
        };
      }),
  });

  revalidatePath("/admin/channels");
  return {
    ok: true,
    message:
      outcome.withdrawn > 0
        ? `${outcome.recorded} templates, and ${outcome.withdrawn} Meta no longer lists.`
        : `${outcome.recorded} templates.`,
  };
}

/**
 * Points one reminder rule at one approved template (P5-T04b-b).
 *
 * The sources arrive as one form field per placeholder, named `binding0`,
 * `binding1` and so on, because a form is a flat list of strings and the order
 * of the placeholders is the whole meaning. Read until one is missing rather
 * than trusting a count field the browser also sent.
 */
export async function saveTemplateMapping(
  _previous: FormResult | null,
  form: FormData,
): Promise<FormResult> {
  const ruleKey = String(form.get("ruleKey") ?? "").trim();
  const templateId = String(form.get("templateId") ?? "").trim();
  if (ruleKey === "" || templateId === "") {
    return { ok: false, message: "Choose a reminder and a template." };
  }

  const bindings: string[] = [];
  for (let index = 0; ; index += 1) {
    const value = form.get(`binding${index}`);
    if (value === null) {
      break;
    }
    bindings.push(String(value));
  }

  try {
    await callAction(await context(), "channels.saveTemplateMapping", {
      ruleKey,
      templateId,
      bindings,
    });
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "That mapping could not be saved.",
    };
  }

  revalidatePath("/admin/channels");
  return { ok: true, message: "Saved." };
}

/** Forgets one mapping, so the rule has no template again. */
export async function removeTemplateMapping(
  _previous: FormResult | null,
  form: FormData,
): Promise<FormResult> {
  const ruleKey = String(form.get("ruleKey") ?? "").trim();
  if (ruleKey === "") {
    return { ok: false, message: "Nothing to remove." };
  }

  try {
    await callAction(await context(), "channels.removeTemplateMapping", {
      ruleKey,
    });
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "That could not be removed.",
    };
  }

  revalidatePath("/admin/channels");
  return { ok: true, message: "Removed." };
}
