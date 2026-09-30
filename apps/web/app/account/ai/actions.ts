"use server";

/**
 * A member's own AI key writes (completeness review M-36, P2-T14).
 *
 * **Three actions and not one caller.** `ai.setPersonalCredential`,
 * `ai.removePersonalCredential` and `ai.readOwnCredentialStatus` were built at
 * P2-T14 and no screen reached them, so P2-T14's own acceptance, "given a
 * workspace key and a personal key, when the member runs an assist, then their
 * own key is used", could not happen in the product.
 *
 * Both writes resolve the member from the session and take no member id, so
 * there is no identifier a caller could pass to set or remove somebody else's
 * key, and they pass the key ring the credential actions seal with.
 *
 * **Nothing here ever repeats the key.** Every answer is a sentence from the
 * catalogue. A refusal is mapped to one by its code rather than passed through,
 * both so it reads in the member's language and so that no message built
 * anywhere below can carry what was pasted back up to the screen.
 */
import { aiApiKeySchema, callAction, OperationError } from "@openokr/core";
import { AI_PROVIDER_KINDS, type AIProviderKind } from "@openokr/db";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/pool";
import { getKeyRing } from "../../../lib/secrets";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import type { KeyResult } from "./key-state.ts";
import { providerWord } from "./words.ts";

async function context() {
  const { session, workspace } = await requireWorkspace();
  return {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
    ring: getKeyRing(),
  };
}

/** The provider the form names, if it is one this product has. */
function providerFrom(form: FormData): AIProviderKind | null {
  const raw = String(form.get("provider") ?? "");
  return (AI_PROVIDER_KINDS as readonly string[]).includes(raw)
    ? (raw as AIProviderKind)
    : null;
}

/**
 * The sentence for a refusal.
 *
 * `not_found` means the provider stopped taking personal keys when storing,
 * and that there was nothing of yours when removing. `forbidden` is the
 * member's level, or a frozen or read-only workspace; both leave the key as it
 * was. Anything else is a failure with nothing changed, because the write is
 * one transaction.
 */
function refusal(
  t: (key: string, values?: Record<string, string>) => string,
  error: unknown,
  doing: "store" | "remove",
  provider: string,
): KeyResult {
  if (error instanceof OperationError && error.code === "not_found") {
    return {
      ok: false,
      message:
        doing === "store"
          ? t("account.aiKeys.actions.notTaken", { provider })
          : t("account.aiKeys.actions.nothingToRemove", { provider }),
    };
  }
  if (error instanceof OperationError && error.code === "forbidden") {
    return { ok: false, message: t("account.aiKeys.actions.notAllowed") };
  }
  return { ok: false, message: t("account.aiKeys.actions.failed") };
}

/**
 * Stores or replaces the member's own key for one provider.
 *
 * **Written once and never read back.** The key is sealed on the way in and
 * the card shows a masked hint, so no render can show it again. The shape is
 * checked here as well as by the action, so that a key pasted with a line
 * break inside it is refused in the member's own language and before anything
 * is sent anywhere.
 */
export async function savePersonalKey(
  _previous: KeyResult,
  form: FormData,
): Promise<KeyResult> {
  const { t } = await getTranslations();
  const provider = providerFrom(form);
  if (!provider) {
    return { ok: false, message: t("account.aiKeys.actions.failed") };
  }
  const name = providerWord(t, provider);
  const pasted = String(form.get("apiKey") ?? "");
  if (pasted.trim() === "") {
    return { ok: false, message: t("account.aiKeys.actions.pasteAKey") };
  }
  const parsed = aiApiKeySchema.safeParse(pasted);
  if (!parsed.success) {
    return { ok: false, message: t("account.aiKeys.actions.malformed") };
  }

  try {
    await callAction(await context(), "ai.setPersonalCredential", {
      provider,
      apiKey: parsed.data,
    });
  } catch (error) {
    return refusal(t, error, "store", name);
  }
  revalidatePath("/account/ai");
  return {
    ok: true,
    message: t("account.aiKeys.actions.stored", { provider: name }),
  };
}

/** Removes the member's own key for one provider. */
export async function removePersonalKey(
  _previous: KeyResult,
  form: FormData,
): Promise<KeyResult> {
  const { t } = await getTranslations();
  const provider = providerFrom(form);
  if (!provider) {
    return { ok: false, message: t("account.aiKeys.actions.failed") };
  }
  const name = providerWord(t, provider);
  try {
    await callAction(await context(), "ai.removePersonalCredential", {
      provider,
    });
  } catch (error) {
    return refusal(t, error, "remove", name);
  }
  revalidatePath("/account/ai");
  return {
    ok: true,
    message: t("account.aiKeys.actions.removed", { provider: name }),
  };
}
