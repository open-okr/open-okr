/**
 * The evaluation set's shape, as core needs to know it (plan 0.7.0 A9,
 * docs/design/ai-evaluation.md §7).
 *
 * **Declared here and implemented in `packages/agents`**, for the reason the
 * drafter is: running a set means running the drafter against the mock driver,
 * the drafter lives in `packages/agents`, and core may import neither that nor
 * `packages/adapters`. So core says what an evaluator answers and the host
 * installs the real one at boot.
 *
 * **On `globalThis`, for the reason admission and the metrics recorder are.**
 * Next loads `instrumentation.ts` separately from the request path, so a
 * module-level binding would give the boot and the request two copies, and the
 * request's would be empty.
 *
 * **No evaluator is not "no gate".** `ai.updatePrompt` refuses every version
 * when nothing is installed, so a host that forgot the install cannot store a
 * prompt unchecked.
 */

/** One check that failed on one fixture. */
interface PromptEvaluationFailure {
  /** The fixture's name, as its set gives it. */
  readonly fixture: string;
  /** `result`, `schema`, `prompt`, `personal-data`, `budget` or `latency`. */
  readonly check: string;
  /** What was seen, in a sentence fragment a refusal can quote. */
  readonly detail: string;
}

/** What running one prompt key's set with one text found. */
export interface PromptEvaluation {
  readonly promptKey: string;
  /** False when this release has no set for the key. */
  readonly known: boolean;
  readonly fixtures: number;
  /** Fixtures with no failure. */
  readonly passed: number;
  readonly failures: readonly PromptEvaluationFailure[];
}

export type PromptEvaluator = (
  promptKey: string,
  systemPrompt: string,
) => Promise<PromptEvaluation>;

/** Whether a version may be saved and sent: a known set, every fixture passing. */
export function evaluationPasses(evaluation: PromptEvaluation): boolean {
  return evaluation.known && evaluation.passed === evaluation.fixtures;
}

const globals = globalThis as typeof globalThis & {
  openokrPromptEvaluator?: PromptEvaluator;
};

export function setDefaultPromptEvaluator(evaluator: PromptEvaluator): void {
  globals.openokrPromptEvaluator = evaluator;
}

/** Undefined until the host installs one, and then every save is refused. */
export function defaultPromptEvaluator(): PromptEvaluator | undefined {
  return globals.openokrPromptEvaluator;
}
