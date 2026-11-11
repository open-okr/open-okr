/**
 * What one AI action really costs, in credits (docs/design/ai-credits.md §8).
 *
 * The pricing page's numbers came from assumed token counts. This makes real calls for
 * the features people use most, on the models somebody names, and reports tokens,
 * dollars and credits per action, with what the model said, because a cheaper model
 * only saves money if its answers are good enough, and only a person can judge that.
 */
import type { AIProvider, TokenUsage } from "@openokr/adapters";
import { type AgentDrafter, costOfUsage, findSeededModel } from "@openokr/core";
import { KEY_RESULT_CHECKS } from "@openokr/method";
import { createProviderDrafter } from "./drafter.ts";

/** A real check's own words, because the method package is the only source of them. */
const REWRITE_CHECK = KEY_RESULT_CHECKS[1];

/** One action, against one provider. Northwind's own words, so they read as real. */
const ACTIONS: readonly {
  readonly key: string;
  run(drafter: AgentDrafter): Promise<unknown>;
}[] = [
  {
    key: "Rewrite a key result the Coach flagged",
    run: (drafter) =>
      drafter.rewriteForRule?.({
        text: "Improve customer onboarding",
        ruleId: REWRITE_CHECK?.id ?? "",
        rulePrompt:
          REWRITE_CHECK?.conditions.find((row) => row.status !== "pass")
            ?.prompt ?? "",
        goalTitle: "Win the mid-market",
      }) ?? Promise.resolve(null),
  },
  {
    key: "Draft an objective from a sentence",
    run: (drafter) =>
      drafter.draftObjective?.({
        ambition: "Mid-market customers should get value in their first week",
        spaceName: "Customer Success",
        existingTitles: ["Win the mid-market", "Cut time to first report"],
      }) ?? Promise.resolve(null),
  },
  {
    key: "Word a check-in the Champion is chasing",
    run: (drafter) =>
      drafter.draftCheckIn?.({
        goalTitle: "Win the mid-market",
        daysOverdue: 3,
        previousStatus: "On track, with two new logos this month.",
        keyResults: [
          { title: "Close 12 mid-market logos", progressPct: 42 },
          { title: "Raise activation from 41% to 60%", progressPct: 30 },
        ],
      }) ?? Promise.resolve(null),
  },
  {
    key: "Summarise a comment thread",
    run: (drafter) =>
      drafter.summariseThread?.({
        subject: "Activation is behind plan",
        comments: [
          {
            author: "Priya",
            text: "Activation sits at 41%, behind the 50% we wanted.",
          },
          {
            author: "Ben",
            text: "Onboarding takes four days. Most drop-off is on day two.",
          },
          {
            author: "Priya",
            text: "Can support own the day-two call until the product fix lands?",
          },
          { author: "Sam", text: "Yes, from Monday, for the next six weeks." },
        ],
      }) ?? Promise.resolve(null),
  },
  {
    key: "Answer a copilot question",
    async run(drafter) {
      const chunks = drafter.streamGrounded?.({
        question:
          "How is mid-market activation doing, and what is being done about it?",
        history: [],
        sources: [
          {
            label: "Raise mid-market activation",
            content:
              "Activation sits at 41%, behind the 50% target for this quarter.",
          },
          {
            label: "Cut onboarding time",
            content:
              "Onboarding takes four days. Support owns a day-two call for six weeks.",
          },
          {
            label: "Weekly check-in, Customer Success",
            content:
              "Two new logos this month. Confidence on activation is down to 0.5.",
          },
        ],
      });
      let text = "";
      for await (const chunk of chunks ?? []) {
        if (chunk.kind === "text") {
          text += chunk.text;
        }
      }
      return text;
    },
  },
];

/** Adds up what a provider reports, whichever method a drafter happened to call. */
class Counting implements AIProvider {
  inputTokens = 0;
  outputTokens = 0;
  cachedInputTokens = 0;
  readonly #inner: AIProvider;

  constructor(inner: AIProvider) {
    this.#inner = inner;
  }

  #add(usage: TokenUsage): void {
    this.inputTokens += usage.inputTokens;
    this.outputTokens += usage.outputTokens;
    this.cachedInputTokens += usage.cachedInputTokens ?? 0;
  }

  reset(): void {
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.cachedInputTokens = 0;
  }

  async chat(...args: Parameters<AIProvider["chat"]>) {
    const response = await this.#inner.chat(...args);
    this.#add(response.usage);
    return response;
  }
  stream(request: Parameters<AIProvider["stream"]>[0]) {
    return this.#inner.stream(request, (usage) => this.#add(usage));
  }
  async chatWithTools(...args: Parameters<AIProvider["chatWithTools"]>) {
    const response = await this.#inner.chatWithTools(...args);
    this.#add(response.usage);
    return response;
  }
  async extract(...args: Parameters<AIProvider["extract"]>) {
    const response = await this.#inner.extract(...args);
    this.#add(response.usage);
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

export interface MeasuredAction {
  readonly action: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly credits: number;
  /** What the model said, for a person to judge. */
  readonly answer: string;
}

export async function measureActions(input: {
  readonly provider: AIProvider;
  readonly providerKind: Parameters<typeof findSeededModel>[0];
  readonly model: string;
  readonly creditValueUsd: number;
}): Promise<readonly MeasuredAction[]> {
  const rates = findSeededModel(input.providerKind, input.model);
  if (!rates) {
    throw new Error(`${input.model} has no price in the catalogue.`);
  }
  const counting = new Counting(input.provider);
  const drafter = createProviderDrafter({
    provider: counting,
    providerName: input.providerKind,
    model: input.model,
    // A measurement, not a budget: the point is to see what it costs.
    costCapUsd: 1_000,
    costInPerMillion: rates.costInPerMillion,
    costOutPerMillion: rates.costOutPerMillion,
    ...(rates.costCachedInPerMillion === undefined
      ? {}
      : { costCachedInPerMillion: rates.costCachedInPerMillion }),
  });

  const measured: MeasuredAction[] = [];
  for (const action of ACTIONS) {
    counting.reset();
    const answer = await action.run(drafter);
    const costUsd = costOfUsage(rates, counting);
    measured.push({
      action: action.key,
      model: input.model,
      inputTokens: counting.inputTokens,
      outputTokens: counting.outputTokens,
      costUsd,
      credits: costUsd / input.creditValueUsd,
      answer: typeof answer === "string" ? answer : JSON.stringify(answer),
    });
  }
  return measured;
}
