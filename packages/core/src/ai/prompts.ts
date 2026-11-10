/**
 * Default system prompts (AI-NATIVE-PLAN.md §4 "Prompts", P2-T15).
 *
 * Code, not a row, the same split as the model catalogue: the built-in text
 * for a `promptKey` lives here, and `ai_prompts` (migration 0016) holds only
 * a workspace's own versioned overrides. "Restore to default" is then just
 * removing every override row for that key, never a special row of its own.
 *
 * **These are the words the drafter sends** (plan 0.7.0 A9,
 * docs/design/ai-evaluation.md §6). Until A9 this file held two sentences
 * written for the card, the drafter sent constants of its own, and nothing read
 * a stored version, so a version saved on S-37 changed nothing a model was
 * sent. The drafter now reads its text for these two capabilities from here,
 * and the host hands it the workspace's newest version while that version
 * passes its evaluation set.
 *
 * Two capabilities, not the whole catalogue: the card's scope since P2-T15.
 * Making another one editable is moving its text here from
 * `packages/agents/src/drafter.ts` and naming it in both languages; its
 * evaluation set already exists, so the gate covers it from its first version.
 *
 * Imports nothing, so the web page and the drafter can both read it without
 * pulling an action module and its import graph in behind it.
 */

/** The editable prompts, by the capability that sends each one. */
export const PROMPT_KEYS = {
  draftObjective: "draft.objective",
  rewriteForRule: "rewrite.failing_rule",
} as const;

export type PromptKey = (typeof PROMPT_KEYS)[keyof typeof PROMPT_KEYS];

export const DEFAULT_PROMPTS: Readonly<Record<PromptKey, string>> = {
  // §2.1's objective draft. Whether the numbers are any good is not the
  // model's claim: core runs §4 over whatever comes back and reports what
  // genuinely passes.
  "draft.objective":
    "You turn an ambition somebody typed into one objective and the measures " +
    "under it. The objective says what changes, not what gets done. Each " +
    "measure carries a baseline and a target as real numbers, and its sentence " +
    "carries them too. Never repeat an objective that already exists. Never " +
    "invent a number you were not given: if you have to choose one, choose a " +
    "round figure the writer will obviously want to correct.",
  // The assist is told the rule and asked for one sentence. It is **not**
  // asked to claim it fixed anything: the caller re-runs §4 over whatever
  // comes back and reports what actually passes, so a persuasive rewrite that
  // fixes nothing is caught by the catalogue rather than believed.
  "rewrite.failing_rule":
    "You rewrite one key result so that it satisfies a named check, changing as " +
    "little as possible and keeping the author's intent. Return one line. Keep " +
    "any number, unit or date that is already there unless the check is about " +
    "that number. Never add a number that was not given to you.",
};

/** The built-in text for a key, or undefined for a key this release has none for. */
export function defaultPromptFor(promptKey: string): string | undefined {
  // Own keys only: "constructor" is not a prompt.
  return Object.hasOwn(DEFAULT_PROMPTS, promptKey)
    ? DEFAULT_PROMPTS[promptKey as PromptKey]
    : undefined;
}

export function knownPromptKeys(): readonly PromptKey[] {
  return Object.values(PROMPT_KEYS);
}
