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
import {
  AI_CONTEXT_EGRESS_LEVELS,
  type AIContextEgressLevel,
  aiEgressAllowListSchema,
  callAction,
} from "@openokr/core";
import type {
  AIProviderKind,
  BudgetMetric,
  BudgetPeriod,
  BudgetScope,
  ModelTier,
} from "@openokr/db";
import { hostOf } from "@openokr/formats";
import { revalidatePath } from "next/cache";
import { testWorkspaceKey } from "../../../lib/ai-key-test";
import { getPool } from "../../../lib/pool";
import { refusedByField } from "../../../lib/refusal";
import { getKeyRing } from "../../../lib/secrets";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { budgetOwnerFrom, tierModelFrom } from "./choices.ts";
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

/**
 * What a refused write says on the AI console (guided-inputs §4.2, plan
 * U1b): under each field it names, which `AIForm` hands to the page's fields
 * by name, and the sentence only when it names none. A schema's own sentence,
 * not the JSON of every issue (F5): a base URL or a model id refused by its
 * rule says why, under that box. `renamed` maps the action's input path to
 * the form's field where the two differ.
 */
async function refused(
  error: unknown,
  renamed?: Readonly<Record<string, string>>,
): Promise<FormResult> {
  const { t } = await getTranslations();
  const state = refusedByField(error, t, renamed);
  if (state !== null) {
    return state.fields
      ? { ok: false, message: "", fields: state.fields }
      : { ok: false, message: state.error ?? "" };
  }
  // Not a refusal, but this console has always said what went wrong rather
  // than opening the error page, such as a host that holds no key ring.
  return {
    ok: false,
    message:
      error instanceof Error
        ? error.message
        : t("admin.agents.proposalQueue.somethingWentWrong"),
  };
}

/** The form's own check, said under the one field it is about. */
const on = (field: string, message: string): FormResult => ({
  ok: false,
  message: "",
  fields: { [field]: message },
});

function done(message: string): FormResult {
  revalidatePath("/admin/ai");
  return { ok: true, message };
}

export async function saveProvider(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  const { t } = await getTranslations();
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
    return refused(error);
  }
  return done(t("admin.rhythm.actions.saved"));
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
    return refused(error);
  }
  // A stored key is tested at once (UAT BUG-026), so the chip says whether it
  // works rather than "unverified" for ever.
  return checkWorkspaceKey(provider);
}

/** Tests the stored workspace key now, and records what the provider said. */
export async function testWorkspaceKeyAction(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  return checkWorkspaceKey(String(form.get("provider") ?? "") as Provider);
}

async function checkWorkspaceKey(provider: Provider): Promise<FormResult> {
  const { t } = await getTranslations();
  const ctx = await context();
  const outcome = await testWorkspaceKey(ctx.workspaceId, provider);
  if (outcome === "unreachable") {
    return done(t("admin.ai.actions.keyNotReached"));
  }
  try {
    await callAction(ctx, "ai.recordCredentialCheck", {
      provider,
      status: outcome,
    });
  } catch (error) {
    return refused(error);
  }
  return outcome === "verified"
    ? done(t("admin.ai.actions.keyVerified"))
    : { ok: false, message: t("admin.ai.actions.keyInvalid") };
}

export async function removeWorkspaceKey(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  const { t } = await getTranslations();
  const provider = String(form.get("provider") ?? "") as Provider;
  try {
    await callAction(await context(), "ai.removeWorkspaceCredential", {
      provider,
    });
  } catch (error) {
    return refused(error);
  }
  return done(t("admin.ai.actions.removed"));
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
  const { t } = await getTranslations();
  try {
    const result = await callAction(
      await context(),
      "ai.rotateCredentials",
      {},
    );
    return done(
      t("admin.ai.actions.examinedRewrapped", {
        examined: result.examined,
        rewrapped: result.rewrapped,
      }),
    );
  } catch (error) {
    return refused(error);
  }
}

export async function addModel(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  const { t } = await getTranslations();
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
    return refused(error);
  }
  return done(t("admin.ai.actions.added"));
}

export async function removeModel(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  const { t } = await getTranslations();
  try {
    await callAction(await context(), "ai.removeCustomModel", {
      id: String(form.get("id") ?? ""),
    });
  } catch (error) {
    return refused(error);
  }
  return done(t("admin.ai.actions.removed"));
}

export async function saveTier(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  const { t } = await getTranslations();
  const temperature = String(form.get("temperature") ?? "").trim();
  const maxTokens = String(form.get("maxTokens") ?? "").trim();
  // The model chosen says its provider (guided-inputs §4.10).
  const model = tierModelFrom(String(form.get("model") ?? ""));
  if (model === null) {
    return on("model", t("admin.ai.actions.whichModel"));
  }
  try {
    await callAction(await context(), "ai.setTierPolicy", {
      tier: String(form.get("tier") ?? "") as Tier,
      provider: model.provider as Provider,
      modelId: model.modelId,
      // Absent means "leave it to the driver", which is null rather than zero:
      // a temperature of 0 is a real and different choice.
      temperature: temperature === "" ? null : Number(temperature),
      maxTokens: maxTokens === "" ? null : Number(maxTokens),
    });
  } catch (error) {
    // One picker chose both the provider and the model.
    return refused(error, { provider: "model", modelId: "model" });
  }
  return done(t("admin.ai.actions.routed"));
}

export async function clearTier(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  const { t } = await getTranslations();
  try {
    await callAction(await context(), "ai.removeTierPolicy", {
      tier: String(form.get("tier") ?? "") as Tier,
    });
  } catch (error) {
    return refused(error);
  }
  return done(t("admin.ai.actions.backToTheSeededDefault"));
}

export async function saveFeature(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  const { t } = await getTranslations();
  const tier = String(form.get("tierOverride") ?? "").trim();
  try {
    await callAction(await context(), "ai.updateFeatureSetting", {
      featureKey: String(form.get("featureKey") ?? ""),
      enabled: form.get("enabled") !== null,
      // Empty means "follow whatever the assist asks for", which is null
      // rather than a tier chosen on the reader's behalf.
      tierOverride: tier === "" ? null : (tier as Tier),
    });
  } catch (error) {
    return refused(error);
  }
  return done(t("admin.rhythm.actions.saved"));
}

/**
 * Records a new version of one prompt.
 *
 * Versioned rather than overwritten, which is what makes the restore below
 * possible: `ai_prompts` keeps every version a workspace has written and the
 * built-in text lives in code, so "restore to default" is removing the
 * overrides rather than writing a special row.
 */
export async function savePrompt(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  const { t } = await getTranslations();
  try {
    const updated = await callAction(await context(), "ai.updatePrompt", {
      promptKey: String(form.get("promptKey") ?? ""),
      systemPrompt: String(form.get("systemPrompt") ?? ""),
    });
    return done(
      t("admin.ai.actions.savedAsVersion", { version: updated.version }),
    );
  } catch (error) {
    return refused(error);
  }
}

export async function restoreDefaultPrompt(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  const { t } = await getTranslations();
  try {
    await callAction(await context(), "ai.restorePrompt", {
      promptKey: String(form.get("promptKey") ?? ""),
    });
  } catch (error) {
    return refused(error);
  }
  return done(t("admin.ai.actions.backToTheBuiltInPrompt"));
}

/**
 * The hosts the allow-list box holds, one per line.
 *
 * Commas and spaces separate too, because a list pasted from somewhere else
 * rarely arrives one per line. A pasted address is reduced to its host, since
 * that is what the guard compares and what the person meant.
 */
function hostsFrom(raw: string): string[] {
  return raw
    .split(/[\s,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map(hostOf);
}

/**
 * Saves the privacy card: the context level, redaction, no-training and the
 * allow-list (completeness review M-10).
 *
 * Every host is checked here before anything is sent, so a typo is refused by
 * name rather than as the schema's own message. The action checks the same
 * schema again, because REST and the command line reach it without this form.
 */
export async function savePrivacy(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  const { t } = await getTranslations();
  const allowedHosts = hostsFrom(String(form.get("allowedHosts") ?? ""));
  const notAHost = allowedHosts.find(
    (host) => !aiEgressAllowListSchema.safeParse([host]).success,
  );
  if (notAHost !== undefined) {
    return on(
      "allowedHosts",
      t("admin.ai.privacy.notAHost", { host: notAHost }),
    );
  }
  const level = String(form.get("contextEgress") ?? "");
  try {
    await callAction(await context(), "ai.updatePrivacySettings", {
      // A form posted without a level (a radio nobody touched cannot be, but
      // a hand-built request can) leaves the stored one as it is.
      ...(AI_CONTEXT_EGRESS_LEVELS.some((one) => one === level)
        ? { contextEgress: level as AIContextEgressLevel }
        : {}),
      redactPersonalData: form.get("redactPersonalData") !== null,
      noTraining: form.get("noTraining") !== null,
      allowedHosts,
    });
  } catch (error) {
    // Every host is one line of the one box.
    return refused(
      error,
      Object.fromEntries(
        allowedHosts.map((_, index) => [
          `allowedHosts.${index}`,
          "allowedHosts",
        ]),
      ),
    );
  }
  return done(t("admin.rhythm.actions.saved"));
}

export async function saveBudget(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  const { t } = await getTranslations();
  // One picker says whose it is: nobody for the whole workspace, or a person
  // or an agent, which also says the scope (guided-inputs §4.10).
  const owner = budgetOwnerFrom(String(form.get("owner") ?? ""));
  if (owner === null) {
    return on("owner", t("admin.ai.actions.whoseBudget"));
  }
  try {
    await callAction(await context(), "ai.setBudget", {
      scope: owner.scope as BudgetScope,
      scopeRef: owner.scopeRef,
      metric: String(form.get("metric") ?? "cost") as BudgetMetric,
      period: String(form.get("period") ?? "month") as BudgetPeriod,
      limitValue: Number(form.get("limitValue") ?? 0),
    });
  } catch (error) {
    // One picker said both whose budget it is and what kind of owner.
    return refused(error, { scope: "owner", scopeRef: "owner" });
  }
  return done(t("admin.ai.actions.set"));
}

export async function removeBudget(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  const { t } = await getTranslations();
  try {
    await callAction(await context(), "ai.removeBudget", {
      id: String(form.get("id") ?? ""),
    });
  } catch (error) {
    return refused(error);
  }
  return done(t("admin.ai.actions.removed"));
}
