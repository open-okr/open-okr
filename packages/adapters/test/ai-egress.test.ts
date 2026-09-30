import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MockAIProvider } from "../src/drivers/ai/mock.ts";
import { OpenRouterProvider } from "../src/drivers/ai/openrouter.ts";
import {
  type AIEgressEvent,
  type AIEgressPolicy,
  AIEgressRefusedError,
  type AIEgressTarget,
  aiEgressRefusal,
  EgressGuardedProvider,
  isLocalAIHost,
  redactPersonalData,
} from "../src/outbound/ai-egress.ts";

/**
 * The AI egress controls, at the one place every provider call passes
 * (completeness review M-10).
 *
 * The privacy card was static text: nothing in the call path withheld,
 * redacted or checked anything. These drive the guard with a mock provider
 * that records what it was actually handed, because the claim under test is
 * about what leaves, and only the receiving end can prove that.
 */

const OPEN: AIEgressPolicy = {
  contextEgress: "all",
  redactPersonalData: false,
  noTraining: false,
  allowedHosts: [],
};

const REMOTE: AIEgressTarget = { host: "api.openai.com", local: false };
const LOCAL: AIEgressTarget = { host: "localhost", local: true };

function guarded(
  policy: Partial<AIEgressPolicy>,
  target: AIEgressTarget = REMOTE,
) {
  const mock = new MockAIProvider({ streamChunks: ["one ", "two"] });
  const events: AIEgressEvent[] = [];
  const provider = new EgressGuardedProvider(mock, {
    provider: "openai",
    target,
    policy: { ...OPEN, ...policy },
    onWithheld: (event) => {
      events.push(event);
    },
  });
  return { mock, events, provider };
}

const PERSONAL =
  "Ask jane.doe@example.com or ring +60 12-345 6789 before Friday.";

describe("redactPersonalData", () => {
  it("replaces an address and a phone number, and counts each", () => {
    expect(redactPersonalData(PERSONAL)).toEqual({
      text: "Ask [email] or ring [phone] before Friday.",
      emails: 1,
      phones: 1,
    });
  });

  it.each([
    ["(03) 2345 6789", "[phone]"],
    ["012-345 6789", "[phone]"],
    ["020 7946 0958", "[phone]"],
    ["0123456789", "[phone]"],
    ["+44 20 7946 0958", "[phone]"],
    ["Write to jane@example.com.", "Write to [email]."],
    ["(priya+okr@northwind.example.co.uk)", "([email])"],
  ])("recognises %s", (input, expected) => {
    expect(redactPersonalData(input).text).toBe(expected);
  });

  it.each([
    "Grow weekly active teams from 1,200 to 1,500 by 30 June 2026",
    "Due 2026-09-29, reviewed 2026-10-06",
    "Raise the score from 0.5 to 0.7",
    "NPS +12 points, churn -3%",
    "Buckets 0 10 20 30 40 for the histogram",
    "Revenue RM 1 000 000",
    "Release v1.2.3 in Q3 2026",
    "Mention @here and @priya",
    "user@localhost is not an address anybody can mail",
    "Budget 10 000 000, headcount 120",
  ])("leaves a key result's own numbers and words alone: %s", (input) => {
    expect(redactPersonalData(input)).toEqual({
      text: input,
      emails: 0,
      phones: 0,
    });
  });

  it("stays linear on a long run with nothing in it to find", () => {
    // The shape a backtracking pattern takes quadratic time over. A scan by
    // index finishes this in milliseconds; a regular expression of the
    // obvious kind does not.
    const long = "a".repeat(200_000);
    const started = performance.now();
    expect(redactPersonalData(`${long}@`).emails).toBe(0);
    expect(redactPersonalData("1 ".repeat(100_000)).phones).toBe(0);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe("isLocalAIHost", () => {
  it.each(["localhost", "LOCALHOST", "ai.localhost", "127.0.0.1", "::1"])(
    "treats %s as this machine",
    (host) => {
      expect(isLocalAIHost(host)).toBe(true);
    },
  );

  it.each(["10.1.2.3", "192.168.1.20", "172.16.0.4", "fd00::1"])(
    "treats %s as a private network",
    (host) => {
      expect(isLocalAIHost(host)).toBe(true);
    },
  );

  it.each(["api.openai.com", "ollama", "llm.internal", "8.8.8.8"])(
    "governs %s, because only a resolver could say it is private",
    (host) => {
      expect(isLocalAIHost(host)).toBe(false);
    },
  );
});

describe("the guard redacts before anything is sent", () => {
  it("hands the provider placeholders, and reports counts without the text", async () => {
    const { mock, events, provider } = guarded({ redactPersonalData: true });

    await provider.chat({
      model: "m",
      purpose: "assist",
      messages: [
        { role: "system", content: "Draft a check-in." },
        { role: "user", content: PERSONAL },
      ],
    });

    const sent = mock.calls[0];
    expect(sent?.method).toBe("chat");
    const received = JSON.stringify(sent?.request);
    expect(received).not.toContain("jane.doe@example.com");
    expect(received).not.toContain("345 6789");
    expect(received).toContain("Ask [email] or ring [phone] before Friday.");

    expect(events).toEqual([
      {
        provider: "openai",
        host: "api.openai.com",
        purpose: "assist",
        outcome: "redacted",
        emails: 1,
        phones: 1,
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("jane");
  });

  it("redacts every method: extract, tools, stream and embed", async () => {
    const { mock, provider } = guarded({
      redactPersonalData: true,
      contextEgress: "all",
    });
    const messages = [{ role: "user" as const, content: PERSONAL }];

    await provider.extract({
      model: "m",
      purpose: "assist",
      messages,
      schema: {},
    });
    await provider.chatWithTools({
      model: "m",
      purpose: "assist",
      messages,
      tools: [],
    });
    const pieces: string[] = [];
    for await (const piece of provider.stream({
      model: "m",
      purpose: "retrieval",
      messages,
    })) {
      pieces.push(piece);
    }
    await provider.embed({ model: "e", input: [PERSONAL] });

    expect(pieces.join("")).toBe("one two");
    expect(mock.calls.map((call) => call.method)).toEqual([
      "extract",
      "chatWithTools",
      "stream",
      "embed",
    ]);
    expect(JSON.stringify(mock.calls)).not.toContain("jane.doe@example.com");
  });

  it("sends the text unchanged when redaction is off", async () => {
    const { mock, events, provider } = guarded({ redactPersonalData: false });
    await provider.chat({
      model: "m",
      purpose: "assist",
      messages: [{ role: "user", content: PERSONAL }],
    });
    expect(JSON.stringify(mock.calls)).toContain("jane.doe@example.com");
    expect(events).toEqual([]);
  });

  it("records nothing when there was nothing to replace", async () => {
    const { events, provider } = guarded({ redactPersonalData: true });
    await provider.chat({
      model: "m",
      purpose: "assist",
      messages: [{ role: "user", content: "Grow from 1,200 to 1,500" }],
    });
    expect(events).toEqual([]);
  });
});

describe("the context level", () => {
  it("lets assists through and withholds retrieval under `assists`", async () => {
    const { mock, events, provider } = guarded({ contextEgress: "assists" });

    await provider.extract({
      model: "m",
      purpose: "assist",
      messages: [{ role: "user", content: "Rewrite this" }],
      schema: {},
    });
    await expect(
      provider.chat({
        model: "m",
        purpose: "retrieval",
        messages: [{ role: "user", content: "What is at risk?" }],
      }),
    ).rejects.toBeInstanceOf(AIEgressRefusedError);
    await expect(
      provider.embed({ model: "e", input: ["A goal's text"] }),
    ).rejects.toBeInstanceOf(AIEgressRefusedError);

    expect(mock.calls.map((call) => call.method)).toEqual(["extract"]);
    expect(events.map((event) => [event.purpose, event.reason])).toEqual([
      ["retrieval", "context_withheld"],
      ["retrieval", "context_withheld"],
    ]);
    expect(provider.permits("assist")).toBe(true);
    expect(provider.permits("retrieval")).toBe(false);
  });

  it("treats a request that names no purpose as retrieval", async () => {
    // Fail closed: a call site added without thinking about egress is
    // withheld under a narrow level rather than let through by omission.
    const { mock, provider } = guarded({ contextEgress: "assists" });
    await expect(
      provider.chat({
        model: "m",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toBeInstanceOf(AIEgressRefusedError);
    expect(mock.calls).toEqual([]);
  });

  it("withholds everything under `none`, the stream included", async () => {
    const { mock, provider } = guarded({ contextEgress: "none" });
    const stream = provider.stream({
      model: "m",
      purpose: "assist",
      messages: [{ role: "user", content: "hi" }],
    });
    await expect(
      (async () => {
        for await (const _ of stream) {
          // Nothing should arrive.
        }
      })(),
    ).rejects.toBeInstanceOf(AIEgressRefusedError);
    expect(mock.calls).toEqual([]);
    expect(provider.permits("assist")).toBe(false);
  });

  it("governs nothing on a local provider, because nothing leaves", async () => {
    const { mock, events, provider } = guarded(
      {
        contextEgress: "none",
        redactPersonalData: true,
        allowedHosts: ["api.openai.com"],
      },
      LOCAL,
    );
    await provider.chat({
      model: "m",
      messages: [{ role: "user", content: PERSONAL }],
    });
    await provider.embed({ model: "e", input: [PERSONAL] });
    expect(JSON.stringify(mock.calls)).toContain("jane.doe@example.com");
    expect(events).toEqual([]);
  });
});

describe("the allow-list", () => {
  it("refuses a host that is not on it, and sends nothing", async () => {
    const { mock, events, provider } = guarded({
      allowedHosts: ["openrouter.ai"],
    });
    await expect(
      provider.chat({
        model: "m",
        purpose: "assist",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow("api.openai.com is not on this workspace's");
    expect(mock.calls).toEqual([]);
    expect(events[0]).toMatchObject({
      outcome: "refused",
      reason: "host_not_allowed",
      host: "api.openai.com",
    });
  });

  it("lets a listed host through, whatever its case", async () => {
    const { mock, provider } = guarded({ allowedHosts: ["API.OpenAI.com"] });
    await provider.chat({
      model: "m",
      purpose: "assist",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(mock.calls).toHaveLength(1);
  });

  it("allows any host when it is empty", () => {
    expect(aiEgressRefusal(OPEN, REMOTE, "retrieval")).toBeNull();
  });
});

describe("a record that cannot be written", () => {
  it("does not become a reason to send the original", async () => {
    const mock = new MockAIProvider();
    const provider = new EgressGuardedProvider(mock, {
      provider: "openai",
      target: REMOTE,
      policy: { ...OPEN, redactPersonalData: true },
      onWithheld: () => {
        throw new Error("the database is down");
      },
    });
    await provider.chat({
      model: "m",
      purpose: "assist",
      messages: [{ role: "user", content: PERSONAL }],
    });
    expect(JSON.stringify(mock.calls)).not.toContain("jane.doe@example.com");
  });
});

describe("no training", () => {
  it("asks OpenRouter to route only to endpoints that do not collect data", async () => {
    const bodies: unknown[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          choices: [
            { index: 0, message: { role: "assistant", content: "ok" } },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { headers: { "content-type": "application/json" } },
      );
    };
    const request = {
      model: "m",
      messages: [{ role: "user" as const, content: "hi" }],
    };

    await new OpenRouterProvider({
      apiKey: "k",
      noTraining: true,
      fetch: fetchImpl,
    }).chat(request);
    await new OpenRouterProvider({ apiKey: "k", fetch: fetchImpl }).chat(
      request,
    );

    expect(bodies[0]).toMatchObject({
      provider: { data_collection: "deny" },
    });
    expect(bodies[1]).not.toHaveProperty("provider");
  });
});

/**
 * Nothing can be handed a driver that skips the guard.
 *
 * Outside this package, `pnpm check:boundaries` refuses an import that
 * reaches a driver module. Inside it, this is the rule: an AI driver class is
 * constructed in `create-ai-provider.ts` and nowhere else, so every provider a
 * caller can obtain is one `createAIProvider` wrapped.
 */
describe("the one place a driver is built", () => {
  const SOURCE = fileURLToPath(new URL("../src", import.meta.url));
  const DRIVER_CLASSES =
    /new\s+(Anthropic|Google|OpenAi|OpenAiCompatible|OpenRouter|Ollama)Provider\s*\(/;

  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? files(join(dir, entry.name))
        : entry.name.endsWith(".ts")
          ? [join(dir, entry.name)]
          : [],
    );

  it("is createAIProvider", () => {
    const building = files(SOURCE)
      .filter((path) => DRIVER_CLASSES.test(readFileSync(path, "utf8")))
      .map((path) =>
        path
          .slice(SOURCE.length + 1)
          .split("\\")
          .join("/"),
      );
    expect(building).toEqual(["create-ai-provider.ts"]);
  });

  it("exports no AI driver class from the package entry", () => {
    const entry = readFileSync(join(SOURCE, "index.ts"), "utf8");
    expect(entry).not.toMatch(
      /\b(Anthropic|Google|OpenAi|OpenAiCompatible|OpenRouter|Ollama)Provider\b/,
    );
    expect(entry).not.toContain("EgressGuardedProvider");
  });
});
