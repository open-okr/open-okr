/**
 * Default system prompts (AI-NATIVE-PLAN.md §4 "Prompts", P2-T15).
 *
 * Code, not a row, the same split as the model catalogue: the built-in text
 * for a `promptKey` lives here, and `ai_prompts` (migration 0016) holds only
 * a workspace's own versioned overrides. "Restore to default" is then just
 * removing every override row for that key, never a special row of its own.
 *
 * Seeded for two representative §2 capabilities today, not the whole
 * catalogue — none has a real caller yet (the same "proven against tests,
 * not a live feature" scope P2-T13/P2-T14 already carry), and a default
 * prompt with nothing to run it against would be invented rather than
 * built. Adding a real assist's prompt key here is that feature's own task.
 */
export const DEFAULT_PROMPTS: Readonly<Record<string, string>> = {
  "draft.objective": [
    "You help draft an objective and key results from a plain-language",
    "ambition. Ground every suggestion in what the person actually wrote;",
    "never invent a metric, owner or deadline they did not name or imply.",
  ].join(" "),
  "rewrite.failing_rule": [
    "You rewrite one objective or key result to satisfy the quality rule it",
    "broke. Keep the person's own intent and voice. Change only what the",
    "rule's own coaching prompt names as the problem.",
  ].join(" "),
};

export function defaultPromptFor(promptKey: string): string | undefined {
  return DEFAULT_PROMPTS[promptKey];
}

export function knownPromptKeys(): readonly string[] {
  return Object.keys(DEFAULT_PROMPTS);
}
