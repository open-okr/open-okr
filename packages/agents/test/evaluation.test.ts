/**
 * The evaluation set (plan 0.7.0 A9, docs/design/ai-evaluation.md).
 *
 * The first block is the CI half of "a prompt version that regresses the
 * evaluation set fails the check": every set, against the built-in prompts,
 * must pass, so a change to a built-in prompt or to the code around it that
 * breaks a set fails the build. The rest proves each check can fail, because
 * a check that cannot fail is a check that is not there.
 */
import { MockAIProvider } from "@openokr/adapters";
import {
  DEFAULT_PROMPTS,
  evaluationPasses,
  knownPromptKeys,
  PROMPT_KEYS,
  type PromptEvaluator,
} from "@openokr/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProviderDrafter } from "../src/drafter.ts";
import { evaluateAll, evaluatePrompt } from "../src/evaluation/index.ts";
import {
  evaluateSet,
  LATENCY_CEILING_MS,
  passingPrompts,
} from "../src/evaluation/run.ts";
import { EVALUATION_SETS } from "../src/evaluation/sets.ts";

const OBJECTIVE = PROMPT_KEYS.draftObjective;
const REWRITE = PROMPT_KEYS.rewriteForRule;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("every set, against the built-in prompts", () => {
  it("passes whole: decision A4's bar", async () => {
    const reports = await evaluateAll();
    const failed = reports.flatMap((report) =>
      report.outcomes.flatMap((outcome) =>
        outcome.failures.map(
          (failure) =>
            `${report.capability} / ${outcome.fixture}: ${failure.check}, ${failure.detail}`,
        ),
      ),
    );
    expect(failed).toEqual([]);
    expect(
      reports.every(
        (report) => report.fixtures > 0 && report.passed === report.fixtures,
      ),
    ).toBe(true);
  });

  it("covers every capability the drafter offers, once each", () => {
    const drafter = createProviderDrafter({
      provider: new MockAIProvider(),
      model: "evaluation",
      costCapUsd: 1,
      costInPerMillion: 0,
      costOutPerMillion: 0,
    });
    const offered = Object.keys(drafter)
      .filter((name) => name !== "spentUsd")
      .sort();
    const covered = EVALUATION_SETS.map((set) => set.capability).sort();
    expect(covered).toEqual(offered);
    expect(new Set(covered).size).toBe(covered.length);
  });

  it("gives every editable prompt exactly one set", () => {
    for (const promptKey of knownPromptKeys()) {
      expect(
        EVALUATION_SETS.filter((set) => set.promptKey === promptKey),
        promptKey,
      ).toHaveLength(1);
    }
  });

  it("holds two fixtures or more in each set, and a refusal wherever the capability can refuse", () => {
    for (const set of EVALUATION_SETS) {
      expect(set.fixtures.length, set.capability).toBeGreaterThanOrEqual(2);
      // A stream always ends on an answer; withholding the sources line from
      // the reader is its refusal, and its first fixture proves that.
      if (set.capability !== "streamGrounded") {
        expect(
          set.fixtures.some((fixture) => fixture.expected === null),
          `${set.capability} has no fixture the product must refuse`,
        ).toBe(true);
      }
    }
  });

  it("holds no address or number of anybody's in any fixture", async () => {
    // So a `personal-data` failure is always about the prompt under test.
    const reports = await evaluateAll();
    const flagged = reports.flatMap((report) =>
      report.outcomes.flatMap((outcome) =>
        outcome.failures.filter((failure) => failure.check === "personal-data"),
      ),
    );
    expect(flagged).toEqual([]);
  });
});

describe("a new version of an editable prompt", () => {
  it("passes when it is the built-in text", async () => {
    for (const promptKey of knownPromptKeys()) {
      const evaluation = await evaluatePrompt(
        promptKey,
        DEFAULT_PROMPTS[promptKey],
      );
      expect(evaluationPasses(evaluation), promptKey).toBe(true);
    }
  });

  it("passes when it is reworded, and is what the requests carried", async () => {
    const evaluation = await evaluatePrompt(
      OBJECTIVE,
      "Draft one objective that names a change, with two or three measures. Use only numbers the writer gave.",
    );
    expect(evaluation).toMatchObject({ known: true, failures: [] });
    expect(evaluation.passed).toBe(evaluation.fixtures);
    expect(evaluation.fixtures).toBeGreaterThanOrEqual(2);
  });

  it("fails `personal-data` on every fixture when it holds an email address", async () => {
    const evaluation = await evaluatePrompt(
      OBJECTIVE,
      `${DEFAULT_PROMPTS[OBJECTIVE]} Questions go to priya@northwind.example.`,
    );
    expect(evaluationPasses(evaluation)).toBe(false);
    expect(evaluation.passed).toBe(0);
    expect(
      evaluation.failures.every(
        (failure) =>
          failure.check === "personal-data" &&
          failure.detail === "an email address in the system prompt",
      ),
    ).toBe(true);
    expect(evaluation.failures).toHaveLength(evaluation.fixtures);
  });

  it("fails `personal-data` when it holds a phone number", async () => {
    const evaluation = await evaluatePrompt(
      REWRITE,
      `${DEFAULT_PROMPTS[REWRITE]} Call +60 12 345 6789 if unsure.`,
    );
    expect(evaluation.failures[0]).toMatchObject({
      check: "personal-data",
      detail: "a phone number in the system prompt",
    });
  });

  it("fails `budget` when it would multiply what every call sends", async () => {
    const evaluation = await evaluatePrompt(
      OBJECTIVE,
      `${DEFAULT_PROMPTS[OBJECTIVE]} ${"Be careful. ".repeat(800)}`,
    );
    expect(evaluationPasses(evaluation)).toBe(false);
    expect(evaluation.failures[0]?.check).toBe("budget");
    expect(evaluation.failures[0]?.detail).toMatch(
      /^about [\d,]+ tokens, over 2,000$/,
    );
  });

  it("is not known for a key with no set", async () => {
    expect(await evaluatePrompt("coach.rewrite", "Anything.")).toEqual({
      promptKey: "coach.rewrite",
      known: false,
      fixtures: 0,
      passed: 0,
      failures: [],
    });
  });
});

describe("the checks that are about the product, not the prompt", () => {
  const objectiveSet = () => {
    const set = EVALUATION_SETS.find(
      (one) => one.capability === "draftObjective",
    );
    if (!set) {
      throw new Error("No draftObjective set.");
    }
    return set;
  };

  it("fails `result` when the product would treat a reply differently", async () => {
    const set = objectiveSet();
    const [first] = set.fixtures;
    if (!first) {
      throw new Error("No fixture.");
    }
    const report = await evaluateSet({
      ...set,
      fixtures: [{ ...first, expected: null }],
    });
    expect(report.passed).toBe(0);
    expect(report.outcomes[0]?.failures[0]).toMatchObject({ check: "result" });
    expect(report.outcomes[0]?.failures[0]?.detail).toMatch(/^it returned /);
  });

  it("fails `prompt` when a fixture sends nothing a prompt could change", async () => {
    const set = objectiveSet();
    const report = await evaluateSet({
      ...set,
      fixtures: [
        {
          name: "sends nothing",
          reply: "",
          expected: null,
          run: async () => null,
        },
      ],
    });
    expect(report.outcomes[0]?.failures).toEqual([
      { check: "prompt", detail: "no request was sent" },
    ]);
  });

  it("names a capability the drafter does not have", async () => {
    const set = objectiveSet();
    const [first] = set.fixtures;
    if (!first) {
      throw new Error("No fixture.");
    }
    const report = await evaluateSet({
      ...set,
      capability: "draftNothing",
      fixtures: [
        {
          ...first,
          run: (drafter) =>
            first.run({ ...drafter, draftObjective: undefined }),
        },
      ],
    });
    expect(report.outcomes[0]?.failures[0]).toEqual({
      check: "result",
      detail: "the drafter has no draftNothing",
    });
  });

  it("fails `latency` past the ceiling", async () => {
    const set = objectiveSet();
    const [first] = set.fixtures;
    if (!first) {
      throw new Error("No fixture.");
    }
    // The fixture's start and end, a second and a half apart.
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(LATENCY_CEILING_MS + 500);
    const report = await evaluateSet({ ...set, fixtures: [first] });
    expect(report.outcomes[0]?.failures).toEqual([
      { check: "latency", detail: "1,500 ms, over 1,000" },
    ]);
  });
});

describe("the live smoke test's half (design §8)", () => {
  it("asks only for an answer, and skips the fixtures that expect a refusal", async () => {
    const set = EVALUATION_SETS.find(
      (one) => one.capability === "suggestMeasure",
    );
    if (!set) {
      throw new Error("No suggestMeasure set.");
    }
    // A "real" model that answers sensibly, in words no fixture expects.
    const provider = new MockAIProvider({
      chatResponse: {
        content: JSON.stringify({
          unit: "percent",
          direction: "increase",
          indicatorType: "lagging",
          baseline: 15,
          target: 25,
        }),
        usage: { inputTokens: 120, outputTokens: 30 },
      },
    });
    const report = await evaluateSet(set, {
      live: { provider, model: "cheap-model" },
    });
    const answering = set.fixtures.filter((one) => one.expected !== null);
    expect(report.fixtures).toBe(answering.length);
    expect(report.passed).toBe(report.fixtures);
    expect(report.outcomes[0]).toMatchObject({
      inputTokens: 120,
      outputTokens: 30,
    });
  });

  it("fails `result` when a live model's answer never passes the schema", async () => {
    const set = EVALUATION_SETS.find(
      (one) => one.capability === "suggestMeasure",
    );
    if (!set) {
      throw new Error("No suggestMeasure set.");
    }
    const report = await evaluateSet(set, {
      live: {
        provider: new MockAIProvider({
          chatResponse: {
            content: "Sure!",
            usage: { inputTokens: 1, outputTokens: 1 },
          },
        }),
        model: "cheap-model",
      },
    });
    expect(report.outcomes[0]?.failures).toEqual([
      { check: "result", detail: "no answer the schema accepted came back" },
    ]);
  });
});

describe("the versions a drafter may send", () => {
  it("keeps those that pass and leaves out those that do not", async () => {
    const sent = await passingPrompts(evaluatePrompt, {
      [OBJECTIVE]: "Draft one objective that names a change.",
      [REWRITE]: `${DEFAULT_PROMPTS[REWRITE]} Ask priya@northwind.example.`,
    });
    expect(sent).toEqual({
      [OBJECTIVE]: "Draft one objective that names a change.",
    });
  });

  it("judges a text once, however many drafters are built with it", async () => {
    let asked = 0;
    const counting: PromptEvaluator = async (promptKey, text) => {
      asked += 1;
      return evaluatePrompt(promptKey, text);
    };
    const stored = { [OBJECTIVE]: "Draft one objective, briefly." };
    await passingPrompts(counting, stored);
    await passingPrompts(counting, stored);
    expect(asked).toBe(1);
    await passingPrompts(counting, { [OBJECTIVE]: "Another text." });
    expect(asked).toBe(2);
  });
});

describe("the drafter and a workspace's version", () => {
  const draftWith = async (systemPrompts?: Record<string, string>) => {
    const provider = new MockAIProvider({
      chatResponse: {
        content: JSON.stringify({ rewritten: "Cut onboarding to two days" }),
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    });
    const drafter = createProviderDrafter({
      provider,
      model: "mock-model",
      costCapUsd: 1,
      costInPerMillion: 0,
      costOutPerMillion: 0,
      ...(systemPrompts ? { systemPrompts } : {}),
    });
    await drafter.rewriteForRule?.({
      text: "Improve onboarding",
      ruleId: "KR-2",
      rulePrompt: "What number moves?",
      goalTitle: "Win the mid-market",
    });
    const [call] = provider.calls;
    return call?.method === "extract"
      ? call.request.messages[0]?.content
      : undefined;
  };

  it("sends the workspace's version when it has one", async () => {
    expect(await draftWith({ [REWRITE]: "Our own words." })).toBe(
      "Our own words.",
    );
  });

  it("sends the built-in text otherwise, or for a blank version", async () => {
    expect(await draftWith()).toBe(DEFAULT_PROMPTS[REWRITE]);
    expect(await draftWith({ [REWRITE]: "  " })).toBe(DEFAULT_PROMPTS[REWRITE]);
    // Another key's version is not this capability's.
    expect(await draftWith({ [OBJECTIVE]: "Not mine." })).toBe(
      DEFAULT_PROMPTS[REWRITE],
    );
  });
});
