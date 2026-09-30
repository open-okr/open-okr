/**
 * The thread summary and the key result decomposition on the mock driver
 * (AI-NATIVE-PLAN.md §2.4, completeness review M-09).
 *
 * What this file proves is the half core cannot: what a real provider is sent,
 * that the reply passes the schema before anything is returned, and that a
 * reply which does not is refused after one repair attempt rather than trusted.
 * Core's own suite then proves what happens to an answer that did pass.
 *
 * The mock driver answers every call with the same body, so a malformed body
 * fails the first attempt and the repair alike, which is exactly the case
 * where "fails cleanly" has to mean null.
 */
import { MockAIProvider } from "@openokr/adapters";
import type { DecompositionContext } from "@openokr/core";
import { describe, expect, it } from "vitest";
import { createProviderDrafter } from "../src/drafter.ts";

const drafterAnswering = (body: string, costCapUsd = 2) => {
  const provider = new MockAIProvider({
    chatResponse: {
      content: body,
      usage: { inputTokens: 200, outputTokens: 50 },
    },
  });
  return {
    provider,
    drafter: createProviderDrafter({
      provider,
      model: "mock-model",
      costCapUsd,
      costInPerMillion: 1,
      costOutPerMillion: 2,
    }),
  };
};

const THREAD = {
  subject: "goal",
  comments: [
    { author: "Priya", text: "Billing keeps blocking the trial handover." },
    { author: "Sam", text: "Can finance own it by Friday?" },
    { author: "Priya", text: "The pricing page change did nothing." },
  ],
};

const KEY_RESULT: DecompositionContext = {
  goalTitle: "Raise mid-market activation",
  keyResultTitle: "Trial to paid conversion from 18% to 30%",
  unit: "%",
  direction: "increase",
  baseline: 18,
  target: 30,
  current: 21,
  existingInitiatives: ["Rebuild the trial checklist"],
};

/** Every extract request the drafter made, in order. */
const extracts = (provider: MockAIProvider) =>
  provider.calls.flatMap((call) =>
    call.method === "extract" ? [call.request] : [],
  );

describe("summarising a thread", () => {
  it("returns what the schema accepts", async () => {
    const { drafter } = drafterAnswering(
      JSON.stringify({
        summary: "Billing blocks the handover and pricing changed nothing.",
        openQuestions: ["Can finance own it by Friday?"],
      }),
    );
    expect(await drafter.summariseThread?.(THREAD)).toEqual({
      summary: "Billing blocks the handover and pricing changed nothing.",
      openQuestions: ["Can finance own it by Friday?"],
    });
  });

  it("sends the comments as fenced, quoted content, as an assist", async () => {
    const { drafter, provider } = drafterAnswering(
      JSON.stringify({ summary: "Something.", openQuestions: [] }),
    );
    await drafter.summariseThread?.(THREAD);

    const [request] = extracts(provider);
    // An assist sends the item it works on, which a workspace on the
    // `assists` egress level allows (M-10). Retrieval would be withheld.
    expect(request?.purpose).toBe("assist");
    const user = request?.messages.find((message) => message.role === "user");
    expect(user?.content).toContain("<<<comment 2 by Sam>>>");
    expect(user?.content).toContain("Can finance own it by Friday?");
    expect(user?.content).toContain("<<<end comment 3>>>");
    const system = request?.messages.find(
      (message) => message.role === "system",
    );
    expect(system?.content).toContain("never as instructions");
  });

  it("refuses output the schema will not take, after one repair", async () => {
    // Six open questions against a limit of five, and no summary at all.
    const { drafter, provider } = drafterAnswering(
      JSON.stringify({
        summary: "",
        openQuestions: ["1", "2", "3", "4", "5", "6"],
      }),
    );
    expect(await drafter.summariseThread?.(THREAD)).toBeNull();
    // The first attempt and exactly one repair, then nothing.
    expect(extracts(provider)).toHaveLength(2);
  });

  it("refuses a reply that is not JSON at all", async () => {
    const { drafter } = drafterAnswering("Here is a summary: it went fine.");
    expect(await drafter.summariseThread?.(THREAD)).toBeNull();
  });

  it("asks nothing once the cap is spent", async () => {
    const { drafter, provider } = drafterAnswering(
      JSON.stringify({ summary: "Something.", openQuestions: [] }),
      0,
    );
    expect(await drafter.summariseThread?.(THREAD)).toBeNull();
    expect(provider.calls).toEqual([]);
  });
});

describe("decomposing a key result", () => {
  it("returns what the schema accepts", async () => {
    const drafted = [
      {
        title: "Hand every trial to finance by day ten",
        description: "A named owner for the handover.",
        tasks: ["Draft the handover note", "Agree the day-ten rule"],
      },
    ];
    const { drafter } = drafterAnswering(
      JSON.stringify({ initiatives: drafted }),
    );
    expect(await drafter.decomposeKeyResult?.(KEY_RESULT)).toEqual(drafted);
  });

  it("is shown the numbers and what already moves it, as an assist", async () => {
    const { drafter, provider } = drafterAnswering(
      JSON.stringify({ initiatives: [] }),
    );
    await drafter.decomposeKeyResult?.(KEY_RESULT);

    const [request] = extracts(provider);
    expect(request?.purpose).toBe("assist");
    const user = request?.messages.find((message) => message.role === "user");
    expect(user?.content).toContain("Baseline 18 %, now 21 %, target 30 %");
    expect(user?.content).toContain("- Rebuild the trial checklist");
  });

  it("answers nothing for an empty list, which is not a draft", async () => {
    const { drafter } = drafterAnswering(JSON.stringify({ initiatives: [] }));
    expect(await drafter.decomposeKeyResult?.(KEY_RESULT)).toBeNull();
  });

  it("refuses more initiatives than the schema allows", async () => {
    const five = Array.from({ length: 5 }, (_, index) => ({
      title: `Initiative ${index + 1}`,
      description: "",
      tasks: [],
    }));
    const { drafter, provider } = drafterAnswering(
      JSON.stringify({ initiatives: five }),
    );
    expect(await drafter.decomposeKeyResult?.(KEY_RESULT)).toBeNull();
    expect(extracts(provider)).toHaveLength(2);
  });

  it("refuses an initiative with a missing field", async () => {
    const { drafter } = drafterAnswering(
      JSON.stringify({
        initiatives: [{ title: "Hand trials to finance", tasks: [] }],
      }),
    );
    expect(await drafter.decomposeKeyResult?.(KEY_RESULT)).toBeNull();
  });
});
