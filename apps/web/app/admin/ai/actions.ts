"use server";

/**
 * The AI console's writes (S-37, P6-G12a).
 *
 * **Twenty-four registered actions and not one caller.** `ai.*` was built
 * across P2-T13, P2-T14, P4-T14 and P4-T15 and no screen ever reached any of
 * it, so an instance could only be given a provider key by calling an action
 * directly. The gap audit recorded the whole domain as B-05, the largest
 * blocker on the list.
 *
 * Every one of these resolves the workspace from the session and passes the key
 * ring, which the credential actions need to seal and open what they store.
 * The refusal comes from the action rather than from here, so an administrator
 * whose level changed between the page rendering and the button being pressed
 * is told why.
 */
import { callAction, OperationError } from "@openokr/core";
import type { AIProviderKind, ModelTier } from "@openokr/db";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/pool";
import { getKeyRing } from "../../../lib/secrets";
import { requireWorkspace } from "../../../lib/workspace";
import type { FormResult } from "./form-state.ts";

// **Taken from the schema, not written out.** The first draft of this file
// guessed "openai | anthropic | google | azure | local" and "embedding", and
// three of those six are not providers this product has while `embed` is
// spelt differently. A hand-copied union is a second declaration of a list
// that already exists, and it was wrong the moment it was typed.
type Provider = AIProviderKind;
type Tier = ModelTier;

async function context() {
  const { session, workspace } = await requireWorkspace();
  return {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
    // The credential actions seal and open what they store, and refuse loudly
    // rather than silently when a host hands them no ring.
    ring: getKeyRing(),
  };
}

const reason = (error: unknown): string =>
  error instanceof OperationError
    ? error.message
    : error instanceof Error
      ? error.message
      : "Something went wrong.";

function done(message: string): FormResult {
  revalidatePath("/admin/ai");
  return { ok: true, message };
}

export async function saveProvider(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  const provider = String(form.get("provider") ?? "") as Provider;
  const baseUrlRaw = String(form.get("baseUrl") ?? "").trim();
  try {
    await callAction(await context(), "ai.updateProviderConfig", {
      provider,
      enabled: form.get("enabled") !== null,
      allowUserKeys: form.get("allowUserKeys") !== null,
      // An empty box means "no override", which is null rather than "".
      baseUrl: baseUrlRaw === "" ? null : baseUrlRaw,
    });
  } catch (error) {
    return { ok: false, message: reason(error) };
  }
  return done("Saved.");
}

/**
 * Stores a workspace key.
 *
 * **The key is written once and never read back.** It is envelope-encrypted on
 * the way in and the card renders a masked hint, so there is no render that
 * could show it again and no field pre-filled with it. Replacing one means
 * typing the new one, which is the same shape the channel card takes.
 */
export async function saveWorkspaceKey(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  const provider = String(form.get("provider") ?? "") as Provider;
  const apiKey = String(form.get("apiKey") ?? "");
  try {
    await callAction(await context(), "ai.setWorkspaceCredential", {
      provider,
      apiKey,
    });
  } catch (error) {
    return { ok: false, message: reason(error) };
  }
  return done(
    "Stored. Nothing has called the provider yet, so it is unverified rather than working.",
  );
}

export async function removeWorkspaceKey(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  const provider = String(form.get("provider") ?? "") as Provider;
  try {
    await callAction(await context(), "ai.removeWorkspaceCredential", {
      provider,
    });
  } catch (error) {
    return { ok: false, message: reason(error) };
  }
  return done("Removed.");
}

/**
 * Re-wraps every stored credential onto the current root key.
 *
 * The command line has had `pnpm keys:rotate` since P2-T14 for the instance's
 * own secrets; this is the per-workspace half, which had no surface at all.
 */
export async function rotateKeys(
  _previous: FormResult,
  _form: FormData,
): Promise<FormResult> {
  try {
    const result = await callAction(
      await context(),
      "ai.rotateCredentials",
      {},
    );
    return done(
      `Examined ${result.examined}, re-wrapped ${result.rewrapped}. Nothing lost access.`,
    );
  } catch (error) {
    return { ok: false, message: reason(error) };
  }
}

export async function addModel(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  const number = (name: string, fallback: number): number => {
    const raw = String(form.get(name) ?? "").trim();
    return raw === "" ? fallback : Number(raw);
  };
  try {
    await callAction(await context(), "ai.addCustomModel", {
      provider: String(form.get("provider") ?? "") as Provider,
      modelId: String(form.get("modelId") ?? ""),
      displayName: String(form.get("displayName") ?? ""),
      contextWindow: number("contextWindow", 8192),
      // Its own cost figures, so a self-hosted or negotiated model meters what
      // it actually costs rather than what the catalogue guesses.
      costInPerMillion: number("costInPerMillion", 0),
      costOutPerMillion: number("costOutPerMillion", 0),
      supportsTools: form.get("supportsTools") !== null,
      supportsVision: form.get("supportsVision") !== null,
      supportsJsonMode: form.get("supportsJsonMode") !== null,
      supportsStreaming: form.get("supportsStreaming") !== null,
      embeddingDimensions: null,
      tiers: form.getAll("tiers").map((value) => String(value) as Tier),
    });
  } catch (error) {
    return { ok: false, message: reason(error) };
  }
  return done("Added.");
}

export async function removeModel(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  try {
    await callAction(await context(), "ai.removeCustomModel", {
      id: String(form.get("id") ?? ""),
    });
  } catch (error) {
    return { ok: false, message: reason(error) };
  }
  return done("Removed.");
}

export async function saveTier(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  const temperature = String(form.get("temperature") ?? "").trim();
  const maxTokens = String(form.get("maxTokens") ?? "").trim();
  try {
    await callAction(await context(), "ai.setTierPolicy", {
      tier: String(form.get("tier") ?? "") as Tier,
      provider: String(form.get("provider") ?? "") as Provider,
      modelId: String(form.get("modelId") ?? ""),
      // Absent means "leave it to the driver", which is null rather than zero:
      // a temperature of 0 is a real and different choice.
      temperature: temperature === "" ? null : Number(temperature),
      maxTokens: maxTokens === "" ? null : Number(maxTokens),
    });
  } catch (error) {
    return { ok: false, message: reason(error) };
  }
  return done("Routed.");
}

export async function clearTier(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  try {
    await callAction(await context(), "ai.removeTierPolicy", {
      tier: String(form.get("tier") ?? "") as Tier,
    });
  } catch (error) {
    return { ok: false, message: reason(error) };
  }
  return done("Back to the seeded default.");
}
