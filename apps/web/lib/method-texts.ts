import { PROCESS_HEALTH_STATEMENTS } from "@openokr/method";
import {
  GATE_TITLE_KEYS,
  PHASE_OUTPUT_KEYS,
  PHASE_TITLE_KEYS,
  PROCESS_HEALTH_KEYS,
  REVIEW_STAGE_PURPOSE_KEYS,
  REVIEW_STAGE_TITLE_KEYS,
  TRIGGER_FIRES_KEYS,
  TRIGGER_RECIPIENT_KEYS,
  WEEKLY_STEP_PURPOSE_KEYS,
  WEEKLY_STEP_TITLE_KEYS,
} from "./method-text-keys.ts";

/**
 * The method's own words beyond rule titles and prompts, in the reader's
 * language (languages.md §13, A-7, D5b): phases, phase outputs, publish gates,
 * agenda stages, process-health statements, and when a trigger fires and who
 * hears it. The English value of each key equals the package's text, which
 * `pnpm method:check` holds, so a screen in English reads as it did.
 *
 * Keys follow the package's own positions and rule keys, never its text, so a
 * reworded sentence keeps its key. A number or key the map does not know
 * shows the package's English rather than nothing.
 */

type Translate = (key: string) => string;

function from<K extends string | number>(
  t: Translate,
  keys: Readonly<Record<K, string>>,
  at: K,
  fallback: string,
): string {
  const key = keys[at];
  return key === undefined ? fallback : t(key);
}

export function phaseTitle(t: Translate, phase: number): string {
  return from(t, PHASE_TITLE_KEYS, phase, "");
}

export function phaseOutput(t: Translate, phase: number): string {
  return from(t, PHASE_OUTPUT_KEYS, phase, "");
}

/** Gate 1 to 6, as METHOD.md §4.5 numbers them. */
export function gateTitle(t: Translate, gateKey: number): string {
  return from(t, GATE_TITLE_KEYS, gateKey, "");
}

/** Weekly step 1 to 4 (§7.2). */
export function weeklyStepTitle(t: Translate, step: number): string {
  return from(t, WEEKLY_STEP_TITLE_KEYS, step, "");
}

export function weeklyStepPurpose(t: Translate, step: number): string {
  return from(t, WEEKLY_STEP_PURPOSE_KEYS, step, "");
}

/** Quarterly review stage 1 to 11 (§8.1). */
export function reviewStageTitle(t: Translate, stage: number): string {
  return from(t, REVIEW_STAGE_TITLE_KEYS, stage, "");
}

export function reviewStagePurpose(t: Translate, stage: number): string {
  return from(t, REVIEW_STAGE_PURPOSE_KEYS, stage, "");
}

/** Process-health statement 1 to 5 (§8.5). */
export function processHealthStatement(
  t: Translate,
  statementKey: number,
): string {
  return from(
    t,
    PROCESS_HEALTH_KEYS,
    statementKey,
    PROCESS_HEALTH_STATEMENTS[statementKey - 1] ?? "",
  );
}

/**
 * A statement that arrives as English text only (the minutes carry the
 * sentence, not its number). Found again by its text; an unknown sentence
 * stays as given.
 */
export function processHealthStatementText(
  t: Translate,
  statement: string,
): string {
  const index = PROCESS_HEALTH_STATEMENTS.indexOf(statement);
  return index < 0 ? statement : processHealthStatement(t, index + 1);
}

/** When a trigger fires (§6.4). `fallback` is the package's English. */
export function triggerFires(
  t: Translate,
  ruleKey: string,
  fallback: string,
): string {
  return from(t, TRIGGER_FIRES_KEYS, ruleKey, fallback);
}

/** Who a trigger reaches (§6.4). `fallback` is the package's English. */
export function triggerRecipient(
  t: Translate,
  ruleKey: string,
  fallback: string,
): string {
  return from(t, TRIGGER_RECIPIENT_KEYS, ruleKey, fallback);
}
