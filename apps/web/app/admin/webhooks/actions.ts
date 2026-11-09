"use server";

import { callAction } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { checkOutboundUrl } from "../../../lib/outbound";
import { getPool } from "../../../lib/pool";
import { refusedByField } from "../../../lib/refusal";
import { getKeyRing } from "../../../lib/secrets";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import type { WebhookResult } from "./form-state.ts";

/**
 * The webhook writes behind Admin, Webhooks (docs/design/outbound-webhooks.md
 * §3). Every one goes through the registry, which holds the level and the
 * schema; nothing here decides who may do what.
 *
 * The context carries the key ring, because a create and a rotation seal a
 * secret, and the outbound guard's check, because a create or a new address
 * is refused before it is stored when the guard would refuse to send to it.
 */
async function context() {
  const { session, workspace } = await requireWorkspace();
  return {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
    ring: getKeyRing(),
    checkOutboundUrl,
  };
}

/** A refusal under its field, or the sentence; anything else is thrown on. */
async function refused(error: unknown): Promise<WebhookResult> {
  const { t } = await getTranslations();
  const state = refusedByField(error, t);
  if (state === null) {
    throw error;
  }
  return {
    ok: false,
    message: state.error ?? "",
    ...(state.fields ? { fields: state.fields } : {}),
  };
}

const text = (form: FormData, name: string): string =>
  String(form.get(name) ?? "").trim();

/** The chosen events, as the registry's own names. */
const eventsOf = (form: FormData) =>
  form.getAll("events").map((value) => String(value)) as never;

/** One space, or the whole workspace when none is chosen. */
const spaceOf = (form: FormData): string | null =>
  text(form, "spaceId") || null;

export async function createWebhookAction(
  _previous: WebhookResult | null,
  form: FormData,
): Promise<WebhookResult> {
  try {
    const created = await callAction(await context(), "webhooks.create", {
      name: text(form, "name"),
      url: text(form, "url"),
      events: eventsOf(form),
      spaceId: spaceOf(form),
    });
    revalidatePath("/admin/webhooks");
    // The secret is in this answer and nowhere else, ever (W5).
    return { ok: true, message: "", secret: created.secret };
  } catch (error) {
    return refused(error);
  }
}

export async function updateWebhookAction(
  _previous: WebhookResult | null,
  form: FormData,
): Promise<WebhookResult> {
  const { t } = await getTranslations();
  try {
    await callAction(await context(), "webhooks.update", {
      id: text(form, "id"),
      name: text(form, "name"),
      url: text(form, "url"),
      events: eventsOf(form),
      spaceId: spaceOf(form),
    });
    revalidatePath("/admin/webhooks");
    return { ok: true, message: t("admin.webhooks.saved") };
  } catch (error) {
    return refused(error);
  }
}

export async function rotateSecretAction(
  _previous: WebhookResult | null,
  form: FormData,
): Promise<WebhookResult> {
  const { t } = await getTranslations();
  try {
    const rotated = await callAction(await context(), "webhooks.rotateSecret", {
      id: text(form, "id"),
    });
    revalidatePath("/admin/webhooks");
    return {
      ok: true,
      message: rotated.previousSecretUntil
        ? t("admin.webhooks.rotated", {
            until: rotated.previousSecretUntil.slice(0, 16).replace("T", " "),
          })
        : "",
      secret: rotated.secret,
    };
  } catch (error) {
    return refused(error);
  }
}

/**
 * The one-button writes: test, turn on or off, take over, remove and send
 * again. One action keyed by `command`, because each is a hidden id and a
 * press, and five copies of the same twelve lines would drift.
 */
export async function webhookCommandAction(
  _previous: WebhookResult | null,
  form: FormData,
): Promise<WebhookResult> {
  const { t } = await getTranslations();
  const id = text(form, "id");
  const command = text(form, "command");
  try {
    const call = await context();
    if (command === "test") {
      await callAction(call, "webhooks.test", { id });
    } else if (command === "on" || command === "off") {
      await callAction(call, "webhooks.update", {
        id,
        enabled: command === "on",
      });
    } else if (command === "takeOver") {
      await callAction(call, "webhooks.update", { id, takeOwnership: true });
    } else if (command === "remove") {
      await callAction(call, "webhooks.remove", { id });
    } else if (command === "redeliver") {
      await callAction(call, "webhooks.redeliver", { deliveryId: id });
    } else {
      return { ok: false, message: t("admin.webhooks.failed") };
    }
  } catch (error) {
    return refused(error);
  }
  revalidatePath("/admin/webhooks");
  if (command === "remove") {
    // Outside the try: a redirect is thrown, and must not read as a refusal.
    redirect("/admin/webhooks");
  }
  return {
    ok: true,
    message:
      command === "test"
        ? t("admin.webhooks.tested")
        : command === "redeliver"
          ? t("admin.webhooks.deliveries.resent")
          : "",
  };
}
