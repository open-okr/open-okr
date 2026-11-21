import {
  ALIGNMENT_CHECKS,
  CYCLE_CHECKS,
  KEY_RESULT_CHECKS,
  OBJECTIVE_CHECKS,
  type QualityVerdict,
  WORD_CHECKS_SKIPPED_NOTICE,
} from "@openokr/method";
import { METHOD_MESSAGE_KEYS } from "./method-message-keys.ts";

const qualityChecks = new Map(
  [
    ...OBJECTIVE_CHECKS,
    ...KEY_RESULT_CHECKS,
    ...ALIGNMENT_CHECKS,
    ...CYCLE_CHECKS,
  ].map((rule) => [rule.id, rule]),
);

export function methodTitle(
  t: (key: string) => string,
  id: string,
  fallback: string,
): string {
  const keys = METHOD_MESSAGE_KEYS[id];
  return keys ? t(keys.title) : fallback;
}

function keysForCondition(id: string, condition: string) {
  const conditions = qualityChecks.get(id)?.conditions;
  const index =
    conditions?.findIndex((row) => row.condition === condition) ?? -1;
  return METHOD_MESSAGE_KEYS[id]?.conditions[index];
}

export function methodConditionLabel(
  t: (key: string) => string,
  id: string,
  condition: string,
): string {
  const keys = keysForCondition(id, condition);
  return keys ? t(keys.label) : condition;
}

export function methodConditionPrompt(
  t: (key: string) => string,
  id: string,
  condition: string,
  fallback: string,
): string {
  const keys = keysForCondition(id, condition);
  return keys ? t(keys.prompt) : fallback;
}

/**
 * A prompt that arrives as English text only (a chip that holds the rule's
 * key and sentence, not its condition). Found again by its text, so the
 * catalogue value shows. An unknown sentence stays as given.
 */
export function methodPromptText(
  t: (key: string) => string,
  id: string,
  prompt: string,
): string {
  const rule = qualityChecks.get(id);
  const keys = METHOD_MESSAGE_KEYS[id];
  if (!rule || !keys) return prompt;
  if (prompt === WORD_CHECKS_SKIPPED_NOTICE) {
    return t("method.wordChecksSkipped");
  }
  const index = rule.conditions.findIndex((row) => row.prompt === prompt);
  const found = keys.conditions[index];
  if (index >= 0 && found) return t(found.prompt);
  return prompt === rule.title ? t(keys.title) : prompt;
}

export function methodVerdictWords(
  t: (key: string) => string,
  verdict: Pick<
    QualityVerdict,
    "id" | "condition" | "prompt" | "wordChecksSkipped"
  >,
) {
  if (
    verdict.wordChecksSkipped &&
    verdict.prompt === WORD_CHECKS_SKIPPED_NOTICE
  ) {
    return {
      condition: t("method.wordChecksSkippedLabel"),
      prompt: t("method.wordChecksSkipped"),
    };
  }
  const keys = keysForCondition(verdict.id, verdict.condition);
  if (keys) return { condition: t(keys.label), prompt: t(keys.prompt) };
  if (verdict.condition === "Nothing to judge yet") {
    const first = METHOD_MESSAGE_KEYS[verdict.id]?.conditions[0];
    return {
      condition: t("method.nothingToJudge"),
      prompt: first ? t(first.prompt) : verdict.prompt,
    };
  }
  return { condition: verdict.condition, prompt: verdict.prompt };
}
