import { createAIProvider } from "@openokr/adapters";
import { loadEnv } from "@openokr/config";
import {
  isCloudEnabled,
  resolveAICredential,
  resolveAIPrivacySettings,
  SEEDED_MODELS,
} from "@openokr/core";
import type { AIProviderKind } from "@openokr/db";
import { providerConfigFor } from "./ai-provider";
import { getInstanceName } from "./instance-name";
import { getPool } from "./pool";
import { getKeyRing } from "./secrets";

/**
 * The live connection test AI-NATIVE-PLAN §2 asks the AI screen for (UAT
 * BUG-026).
 *
 * One request of a few tokens to the provider's cheapest seeded chat model,
 * carrying no workspace content. What it answers decides the key's status:
 *
 * | The provider | Means |
 * |---|---|
 * | Answers | `verified` |
 * | Refuses with 401 or 403 | `invalid`: the key itself is wrong |
 * | Anything else, or cannot be reached | `unreachable`: says nothing about the key, so the status is left alone |
 */
export type KeyTestOutcome = "verified" | "invalid" | "unreachable";

const REFUSED = new Set([401, 403]);

function modelFor(provider: AIProviderKind): string | null {
  const chat = SEEDED_MODELS.filter(
    (model) =>
      model.provider === provider && model.embeddingDimensions === undefined,
  );
  const fast = chat.find((model) => model.tiers.includes("fast"));
  return (fast ?? chat[0])?.modelId ?? null;
}

function statusOf(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status: unknown }).status;
    return typeof status === "number" ? status : null;
  }
  return null;
}

export async function testWorkspaceKey(
  workspaceId: string,
  provider: AIProviderKind,
): Promise<KeyTestOutcome> {
  const pool = getPool();
  const resolved = await resolveAICredential(pool, getKeyRing(), process.env, {
    workspaceId,
    provider,
  });
  if (resolved.source !== "workspace") {
    return "unreachable";
  }
  const config = providerConfigFor(resolved, {
    guardOutbound: await isCloudEnabled(pool),
    appUrl: loadEnv().BETTER_AUTH_URL,
    appName: await getInstanceName(),
  });
  const model = modelFor(provider);
  if (!config || !model) {
    return "unreachable";
  }
  const client = createAIProvider(config, {
    policy: await resolveAIPrivacySettings(pool, workspaceId),
  });
  if (!client.permits("assist")) {
    return "unreachable";
  }
  try {
    await client.chat({
      model,
      messages: [{ role: "user", content: "Reply with the word OK." }],
      maxTokens: 5,
      purpose: "assist",
    });
    return "verified";
  } catch (error) {
    const status = statusOf(error);
    return status !== null && REFUSED.has(status) ? "invalid" : "unreachable";
  }
}
