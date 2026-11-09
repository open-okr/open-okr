/**
 * The evaluation set, as this host uses it (plan 0.7.0 A9,
 * docs/design/ai-evaluation.md §7 and §9).
 *
 * `installPromptEvaluator` hands core the set at boot, because core may not
 * import the drafter the set runs and `ai.updatePrompt` refuses every version
 * until something is installed. REST, the agent endpoint and the command line
 * reach the same process, so one install gates every surface.
 *
 * `latestEvaluations` is the usage card's "latest evaluation results",
 * computed when the page renders. The run is deterministic and takes
 * milliseconds against the mock, so a stored result could only be a copy of
 * this that goes stale when an upgrade changes a set.
 */

import { redactPersonalData } from "@openokr/adapters";
import { evaluatePrompt } from "@openokr/agents";
import {
  evaluationPasses,
  setDefaultPromptEvaluator,
  setPersonalDataFinder,
} from "@openokr/core";

export function installPromptEvaluator(): void {
  setDefaultPromptEvaluator(evaluatePrompt);
  // The same finder a prompt's evaluation uses, for an agent's instructions
  // (plan 0.7.0 A7, agent-instructions.md I7).
  setPersonalDataFinder(redactPersonalData);
}

/** One editable prompt's current version, against its set. */
export interface PromptEvaluationRow {
  readonly promptKey: string;
  /** Zero for the built-in text. */
  readonly version: number;
  readonly isDefault: boolean;
  readonly fixtures: number;
  readonly passed: number;
  /** Each check that failed, once, in the order the set reported them. */
  readonly failedChecks: readonly string[];
  /** False when a stored version fails, so the built-in text goes instead. */
  readonly sent: boolean;
}

export async function latestEvaluations(
  prompts: readonly {
    readonly promptKey: string;
    readonly version: number;
    readonly isDefault: boolean;
    readonly systemPrompt: string;
  }[],
): Promise<readonly PromptEvaluationRow[]> {
  return Promise.all(
    prompts.map(async (prompt) => {
      const evaluation = await evaluatePrompt(
        prompt.promptKey,
        prompt.systemPrompt,
      );
      return {
        promptKey: prompt.promptKey,
        version: prompt.version,
        isDefault: prompt.isDefault,
        fixtures: evaluation.fixtures,
        passed: evaluation.passed,
        failedChecks: [
          ...new Set(evaluation.failures.map((failure) => failure.check)),
        ],
        sent: prompt.isDefault || evaluationPasses(evaluation),
      };
    }),
  );
}
