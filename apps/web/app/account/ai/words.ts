/**
 * Catalogue keys for what the personal key screen names (completeness review
 * M-36).
 *
 * The providers are the AI console's own words, so a provider is called the
 * same thing on both screens. A value the schema adds before the catalogue
 * knows it is shown as itself rather than hidden.
 */
import type { AIProviderKind } from "@openokr/db";

const PROVIDER_WORDS: Readonly<Record<AIProviderKind, string>> = {
  anthropic: "admin.ai.providerAnthropic",
  openai: "admin.ai.providerOpenai",
  google: "admin.ai.providerGoogle",
  openrouter: "admin.ai.providerOpenrouter",
  ollama: "admin.ai.providerOllama",
  "openai-compatible": "admin.ai.providerOpenaiCompatible",
};

export function providerWord(
  t: (key: string) => string,
  provider: string,
): string {
  const key = PROVIDER_WORDS[provider as AIProviderKind];
  return key ? t(key) : provider;
}

/**
 * A stored key's status, in words a person reads.
 *
 * Nothing calls a provider to check a key yet, so every key reads "not tried
 * yet" until something does. That is said rather than dressed up as working.
 */
export const STATUS_WORDS: Readonly<
  Record<"unverified" | "verified" | "invalid", string>
> = {
  unverified: "account.aiKeys.statusUnverified",
  verified: "account.aiKeys.statusVerified",
  invalid: "account.aiKeys.statusInvalid",
};
