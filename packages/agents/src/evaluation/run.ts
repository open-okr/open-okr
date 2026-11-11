/**
 * The evaluation runner (plan 0.7.0 A9, docs/design/ai-evaluation.md).
 *
 * **It runs the production drafter, not a copy.** Each fixture builds a drafter
 * with `createProviderDrafter`, the function `drafterFor` builds a workspace's
 * with, hands it the prompt under test through `systemPrompts`, the option a
 * workspace's own version arrives through, and drives it with a mock driver
 * scripted with the fixture's reply. So what passes here is what would be sent
 * and what would be done with the answer.
 *
 * Pure: no database, no network, no clock but the one it times itself with.
 * The same function answers the unit suite, `pnpm ai:evaluate`, the save gate
 * in `ai.updatePrompt` and the usage card, which is why none of them can
 * disagree about whether a prompt passes.
 */
import { isDeepStrictEqual } from "node:util";
import {
  type AIProvider,
  type ChatRequest,
  type ExtractRequest,
  MockAIProvider,
  redactPersonalData,
  type TokenUsage,
  type ToolDefinition,
} from "@openokr/adapters";
import {
  type AgentDrafter,
  currentPromptVersions,
  DEFAULT_PROMPTS,
  evaluationPasses,
  type PromptEvaluation,
  type PromptEvaluator,
  type PromptKey,
} from "@openokr/core";
import type { Pool } from "pg";
import { createProviderDrafter } from "../drafter.ts";

/** Every check a fixture runs, in the order a report lists them (design §4). */
const EVALUATION_CHECKS = [
  "result",
  "schema",
  "prompt",
  "personal-data",
  "budget",
  "latency",
] as const;

type EvaluationCheck = (typeof EVALUATION_CHECKS)[number];

/**
 * How long one fixture may take against the mock (design §4).
 *
 * The product's own time around the call, which is microseconds: building
 * the request and checking the reply. A second catches a capability that
 * waits on something it should not, and is far enough from the real figure
 * that a busy machine does not refuse a prompt for being slow.
 */
export const LATENCY_CEILING_MS = 1_000;

/** The budget a set takes when it names none (design §5). */
export const DEFAULT_INPUT_BUDGET_TOKENS = 2_000;

/** The model name a mock run puts on its requests, which no driver will see. */
const EVALUATION_MODEL = "evaluation";

/** What the mock reports, so the drafter's spend stays at nothing. */
const NO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0 };

/** Characters per token, the estimate the egress guard already makes. */
const CHARACTERS_PER_TOKEN = 4;

/** One request and one golden reply, for one capability. */
interface EvaluationFixture {
  readonly name: string;
  /**
   * What a well-behaved model answers. A list is a streamed answer, in the
   * pieces it arrives in.
   */
  readonly reply: string | readonly string[];
  /** The capability's result after the product's own checks. Null to refuse. */
  readonly expected: unknown;
  /**
   * `note` is how a capability says why it answered nothing (plan 0.8.1 A3):
   * a dropped proposal's reason. Printed beside a `result` failure only.
   */
  run(drafter: AgentDrafter, note: (text: string) => void): Promise<unknown>;
}

/** One capability's fixtures, and the limits they are held to. */
export interface EvaluationSet {
  /** The drafter method, which is also the `feature` on its usage row. */
  readonly capability: string;
  /** The editable prompt this capability sends, or null when it is built in. */
  readonly promptKey: PromptKey | null;
  readonly inputBudgetTokens: number;
  readonly fixtures: readonly EvaluationFixture[];
}

interface EvaluationFailure {
  readonly check: EvaluationCheck;
  readonly detail: string;
}

interface FixtureOutcome {
  readonly fixture: string;
  readonly failures: readonly EvaluationFailure[];
  readonly ms: number;
  /** The first request's size, as the budget estimates it. */
  readonly estimatedInputTokens: number;
  /** What the provider counted, which is nothing against the mock. */
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface SetReport {
  readonly capability: string;
  readonly promptKey: PromptKey | null;
  readonly fixtures: number;
  readonly passed: number;
  readonly outcomes: readonly FixtureOutcome[];
}

export interface EvaluateOptions {
  /** The text to send in place of the set's prompt. Ignored for a built-in set. */
  readonly systemPrompt?: string;
  /**
   * A real provider instead of the mock: the live smoke test (design §8).
   *
   * A live reply cannot be compared word for word, so `result` asks only
   * whether an answer came back where the fixture expects one, fixtures that
   * expect a refusal are skipped, and time is reported rather than judged.
   */
  readonly live?: { readonly provider: AIProvider; readonly model: string };
}

type Recorded =
  | { readonly method: "extract"; readonly request: ExtractRequest }
  | { readonly method: "chat" | "stream"; readonly request: ChatRequest };

/** The provider, with every request it was sent written down. */
class Recording implements AIProvider {
  readonly requests: Recorded[] = [];
  inputTokens = 0;
  outputTokens = 0;
  readonly #inner: AIProvider;

  constructor(inner: AIProvider) {
    this.#inner = inner;
  }

  #count(usage: TokenUsage | undefined): void {
    this.inputTokens += usage?.inputTokens ?? 0;
    this.outputTokens += usage?.outputTokens ?? 0;
  }

  async chat(request: ChatRequest) {
    this.requests.push({ method: "chat", request });
    const response = await this.#inner.chat(request);
    this.#count(response.usage);
    return response;
  }

  stream(request: ChatRequest, onUsage?: (usage: TokenUsage) => void) {
    this.requests.push({ method: "stream", request });
    return this.#inner.stream(request, (usage) => {
      this.#count(usage);
      onUsage?.(usage);
    });
  }

  async chatWithTools(
    request: ChatRequest & { readonly tools: readonly ToolDefinition[] },
  ) {
    this.requests.push({ method: "chat", request });
    const response = await this.#inner.chatWithTools(request);
    this.#count(response.usage);
    return response;
  }

  async extract(request: ExtractRequest) {
    this.requests.push({ method: "extract", request });
    const response = await this.#inner.extract(request);
    this.#count(response.usage);
    return response;
  }

  embed(...args: Parameters<AIProvider["embed"]>) {
    return this.#inner.embed(...args);
  }

  capabilities(model: string) {
    return this.#inner.capabilities(model);
  }

  stop() {
    return this.#inner.stop();
  }
}

const estimateTokens = (request: ChatRequest): number =>
  Math.ceil(
    request.messages.reduce(
      (characters, message) => characters + message.content.length,
      0,
    ) / CHARACTERS_PER_TOKEN,
  );

const figure = (value: number): string => value.toLocaleString("en-GB");

/** A value short enough to quote in a refusal. */
function quoted(value: unknown): string {
  const text = value === undefined ? "nothing" : JSON.stringify(value);
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

/** What `fixture.run` answers when the drafter has no such capability. */
const MISSING = Symbol("missing capability");

/** Wraps a capability call so a drafter without it is named, not mistaken for null. */
export function missingAs(
  call: Promise<unknown> | undefined,
): Promise<unknown> {
  return call ?? Promise.resolve(MISSING);
}

function personalDataIn(
  request: ChatRequest,
): { readonly where: string; readonly what: string } | null {
  for (const message of request.messages) {
    const found = redactPersonalData(message.content);
    if (found.emails + found.phones === 0) {
      continue;
    }
    const what = [
      found.emails === 0
        ? null
        : found.emails === 1
          ? "an email address"
          : `${found.emails} email addresses`,
      found.phones === 0
        ? null
        : found.phones === 1
          ? "a phone number"
          : `${found.phones} phone numbers`,
    ]
      .filter((part) => part !== null)
      .join(" and ");
    return {
      where:
        message.role === "system"
          ? "in the system prompt"
          : "in what the capability sends",
      what,
    };
  }
  return null;
}

/** Every check, over one fixture's run. */
function judge(
  set: EvaluationSet,
  fixture: EvaluationFixture,
  outcome: {
    readonly result: unknown;
    readonly threw: unknown;
    readonly ms: number;
    readonly requests: readonly Recorded[];
    /** What the capability said about an empty answer, if anything. */
    readonly notes: readonly string[];
  },
  options: EvaluateOptions & { readonly expectedPrompt: string | null },
): EvaluationFailure[] {
  const failures: EvaluationFailure[] = [];
  const fail = (check: EvaluationCheck, detail: string) =>
    failures.push({ check, detail });
  const why =
    outcome.notes.length === 0 ? "" : ` (${outcome.notes.join("; ")})`;

  // result
  if (outcome.result === MISSING) {
    fail("result", `the drafter has no ${set.capability}`);
  } else if (outcome.threw !== undefined) {
    // Every capability answers null rather than throwing, so a throw is the
    // product's fault, whatever the reply was.
    fail(
      "result",
      `it threw ${outcome.threw instanceof Error ? outcome.threw.message : String(outcome.threw)}`,
    );
  } else if (options.live) {
    if (outcome.result === null || outcome.result === undefined) {
      fail("result", `no answer the schema accepted came back${why}`);
    }
  } else if (!isDeepStrictEqual(outcome.result, fixture.expected)) {
    fail(
      "result",
      `it returned ${quoted(outcome.result)}, not ${quoted(fixture.expected)}${why}`,
    );
  }

  const [first] = outcome.requests;
  if (first === undefined) {
    // A fixture that sends nothing tests nothing a prompt can change.
    fail("prompt", "no request was sent");
    return failures;
  }

  for (const { method, request } of outcome.requests) {
    // schema
    if (method === "extract") {
      const schema = request.schema;
      if (schema.type !== "object") {
        fail("schema", "a structured request carries no object schema");
        break;
      }
    }
  }

  for (const { request } of outcome.requests) {
    // prompt: one system message, first, and the one under test.
    const systems = request.messages.filter(
      (message) => message.role === "system",
    );
    const [leading] = request.messages;
    if (systems.length !== 1 || leading?.role !== "system") {
      fail("prompt", "the request does not open with one system message");
      break;
    }
    if (options.expectedPrompt !== null) {
      if (leading.content !== options.expectedPrompt) {
        fail("prompt", "the system message is not the prompt under test");
        break;
      }
    } else if (leading.content.trim() === "") {
      fail("prompt", "the system message is empty");
      break;
    }
  }

  for (const { request } of outcome.requests) {
    const found = personalDataIn(request);
    if (found) {
      fail("personal-data", `${found.what} ${found.where}`);
      break;
    }
  }

  const estimated = estimateTokens(first.request);
  if (estimated > set.inputBudgetTokens) {
    fail(
      "budget",
      `about ${figure(estimated)} tokens, over ${figure(set.inputBudgetTokens)}`,
    );
  }

  if (!options.live && outcome.ms > LATENCY_CEILING_MS) {
    fail(
      "latency",
      `${figure(Math.round(outcome.ms))} ms, over ${figure(LATENCY_CEILING_MS)}`,
    );
  }
  return failures;
}

async function evaluateFixture(
  set: EvaluationSet,
  fixture: EvaluationFixture,
  options: EvaluateOptions & { readonly expectedPrompt: string | null },
): Promise<FixtureOutcome> {
  const pieces = typeof fixture.reply === "string" ? null : fixture.reply;
  const inner =
    options.live?.provider ??
    new MockAIProvider({
      chatResponse: {
        content: pieces === null ? (fixture.reply as string) : pieces.join(""),
        usage: NO_USAGE,
      },
      streamChunks: pieces ?? [fixture.reply as string],
    });
  const recording = new Recording(inner);
  const drafter = createProviderDrafter({
    provider: recording,
    model: options.live?.model ?? EVALUATION_MODEL,
    // Priced at nothing, so the cap never stops a fixture. A live run is
    // bounded by its handful of short requests instead.
    costCapUsd: 1,
    costInPerMillion: 0,
    costOutPerMillion: 0,
    ...(set.promptKey !== null && options.systemPrompt !== undefined
      ? { systemPrompts: { [set.promptKey]: options.systemPrompt } }
      : {}),
  });

  let result: unknown;
  let threw: unknown;
  const notes: string[] = [];
  const started = performance.now();
  try {
    result = await fixture.run(drafter, (text) => notes.push(text));
  } catch (error) {
    threw = error ?? new Error("an empty throw");
  }
  const ms = performance.now() - started;

  const failures = judge(
    set,
    fixture,
    { result, threw, ms, requests: recording.requests, notes },
    options,
  );
  const [first] = recording.requests;
  return {
    fixture: fixture.name,
    failures,
    ms,
    estimatedInputTokens: first ? estimateTokens(first.request) : 0,
    inputTokens: recording.inputTokens,
    outputTokens: recording.outputTokens,
  };
}

/** One set, every fixture, in order. */
export async function evaluateSet(
  set: EvaluationSet,
  options: EvaluateOptions = {},
): Promise<SetReport> {
  const fixtures = options.live
    ? set.fixtures.filter((fixture) => fixture.expected !== null)
    : set.fixtures;
  // The prompt a request must carry: the one under test, or the built-in
  // text the drafter reads from core. A built-in set only needs one there.
  const expectedPrompt =
    set.promptKey === null
      ? null
      : options.systemPrompt !== undefined && options.systemPrompt.trim() !== ""
        ? options.systemPrompt
        : DEFAULT_PROMPTS[set.promptKey];
  const outcomes: FixtureOutcome[] = [];
  for (const fixture of fixtures) {
    outcomes.push(
      await evaluateFixture(set, fixture, { ...options, expectedPrompt }),
    );
  }
  return {
    capability: set.capability,
    promptKey: set.promptKey,
    fixtures: outcomes.length,
    passed: outcomes.filter((outcome) => outcome.failures.length === 0).length,
    outcomes,
  };
}

/** Runs one prompt key's set over a text, in the shape core's gate reads. */
export function evaluatorOver(sets: readonly EvaluationSet[]): PromptEvaluator {
  return async (promptKey, systemPrompt) => {
    const set = sets.find((one) => one.promptKey === promptKey);
    if (!set) {
      return { promptKey, known: false, fixtures: 0, passed: 0, failures: [] };
    }
    const report = await evaluateSet(set, { systemPrompt });
    return {
      promptKey,
      known: true,
      fixtures: report.fixtures,
      passed: report.passed,
      failures: report.outcomes.flatMap((outcome) =>
        outcome.failures.map((failure) => ({
          fixture: outcome.fixture,
          check: failure.check,
          detail: failure.detail,
        })),
      ),
    } satisfies PromptEvaluation;
  };
}

/**
 * Verdicts already reached, per evaluator, by key and text, so a drafter costs
 * one run per new text rather than one per call.
 */
const verdictsBy = new WeakMap<PromptEvaluator, Map<string, boolean>>();

/** Enough for every version a busy instance's workspaces hold, and bounded anyway. */
const VERDICTS_KEPT = 512;

/**
 * The stored versions a drafter may send: those that pass their set now
 * (design §6).
 *
 * A version saved before the gate, one that arrived in an archive import and
 * one a later release's set fails are all left out, so the built-in text goes
 * instead. The verdict is deterministic, so it is remembered by key and text.
 */
export async function passingPrompts(
  evaluate: PromptEvaluator,
  stored: Readonly<Record<string, string>>,
): Promise<Readonly<Record<string, string>>> {
  const sent: Record<string, string> = {};
  let verdicts = verdictsBy.get(evaluate);
  if (verdicts === undefined) {
    verdicts = new Map();
    verdictsBy.set(evaluate, verdicts);
  }
  for (const [promptKey, text] of Object.entries(stored)) {
    const key = `${promptKey}\u0000${text}`;
    let passes = verdicts.get(key);
    if (passes === undefined) {
      passes = evaluationPasses(await evaluate(promptKey, text));
      if (verdicts.size >= VERDICTS_KEPT) {
        verdicts.clear();
      }
      verdicts.set(key, passes);
    }
    if (passes) {
      sent[promptKey] = text;
    }
  }
  return sent;
}

/** A workspace's versions that a drafter may send, read and judged in one call. */
export async function workspacePromptsWith(
  evaluate: PromptEvaluator,
  pool: Pool,
  workspaceId: string,
): Promise<Readonly<Record<string, string>>> {
  return passingPrompts(
    evaluate,
    await currentPromptVersions(pool, workspaceId),
  );
}
