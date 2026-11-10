/**
 * The evaluation set, assembled (plan 0.7.0 A9, docs/design/ai-evaluation.md).
 *
 * `evaluatePrompt` is what the host installs for `ai.updatePrompt`'s gate and
 * what the usage card asks; `workspacePrompts` is what a drafter is built
 * with. Both run the same sets through the same runner, so the gate, the card
 * and what is sent cannot disagree about a prompt.
 */
import type { PromptEvaluator } from "@openokr/core";
import type { Pool } from "pg";
import {
  type EvaluateOptions,
  evaluateSet,
  evaluatorOver,
  type SetReport,
  workspacePromptsWith,
} from "./run.ts";
import { EVALUATION_SETS } from "./sets.ts";

/** One prompt key's set over one text, in the shape core's gate reads. */
export const evaluatePrompt: PromptEvaluator = evaluatorOver(EVALUATION_SETS);

/** Every set, in order: the unit suite's run and `pnpm ai:evaluate`'s. */
export async function evaluateAll(
  options: EvaluateOptions = {},
): Promise<readonly SetReport[]> {
  const reports: SetReport[] = [];
  for (const set of EVALUATION_SETS) {
    reports.push(await evaluateSet(set, options));
  }
  return reports;
}

/**
 * A workspace's own prompt versions that a drafter may send: each key's newest,
 * while it passes its set (design §6).
 */
export function workspacePrompts(
  pool: Pool,
  workspaceId: string,
): Promise<Readonly<Record<string, string>>> {
  return workspacePromptsWith(evaluatePrompt, pool, workspaceId);
}
