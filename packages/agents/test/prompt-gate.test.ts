/**
 * The gate on a new prompt version, with the real evaluation set, against a
 * real database (plan 0.7.0 A9, docs/design/ai-evaluation.md §6 and §7).
 *
 * Core's own suite proves what `ai.updatePrompt` does with an evaluator's
 * answer, using a stand-in, because core cannot import the drafter. This file
 * is the two halves together: the set the host installs, deciding a save, and
 * the version that save stored reaching a model, or not.
 */
import { MockAIProvider } from "@openokr/adapters";
import {
  callAction,
  DEFAULT_PROMPTS,
  OperationError,
  PROMPT_KEYS,
  type PromptEvaluator,
  provisionWorkspaceForUser,
} from "@openokr/core";
import { workerDb } from "@openokr/test-support/db";
import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createProviderDrafter } from "../src/drafter.ts";
import { evaluatePrompt, workspacePrompts } from "../src/evaluation/index.ts";

const OWNER = "prompt-gate-owner";
const OBJECTIVE = PROMPT_KEYS.draftObjective;

let workspaceId: string;
let pool: Pool;

/** The owner, gated by the set the host installs. */
const gated = (evaluate: PromptEvaluator = evaluatePrompt) => ({
  pool,
  workspaceId,
  actor: { kind: "human" as const, userId: OWNER },
  evaluatePrompt: evaluate,
});

/** What an objective draft sends as its system message, built as the host builds it. */
async function sentSystemPrompt(): Promise<string | undefined> {
  const provider = new MockAIProvider({
    chatResponse: {
      content: JSON.stringify({
        title: "Mid-market customers see value in their first week",
        description: "",
        keyResults: [],
      }),
      usage: { inputTokens: 0, outputTokens: 0 },
    },
  });
  const drafter = createProviderDrafter({
    provider,
    model: "mock-model",
    costCapUsd: 1,
    costInPerMillion: 0,
    costOutPerMillion: 0,
    systemPrompts: await workspacePrompts(pool, workspaceId),
  });
  await drafter.draftObjective?.({
    ambition: "Mid-market customers should get value in their first week",
    spaceName: null,
    existingTitles: [],
  });
  const [call] = provider.calls;
  return call?.method === "extract"
    ? call.request.messages[0]?.content
    : undefined;
}

beforeEach(async () => {
  const wb = await workerDb();
  pool = wb.appPool;
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Prompt Gate Owner", "prompt-gate-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Prompt Gate Owner",
  });
  workspaceId = provisioned.workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("saving a version (design §7)", () => {
  it("refuses one with an email address in it, naming the check, and stores nothing", async () => {
    const refused = await callAction(gated(), "ai.updatePrompt", {
      promptKey: OBJECTIVE,
      systemPrompt: `${DEFAULT_PROMPTS[OBJECTIVE]} Questions go to priya@northwind.example.`,
    }).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(OperationError);
    expect((refused as OperationError).field).toBe("systemPrompt");
    expect((refused as Error).message).toMatch(
      /^Not saved\. This version fails 4 of the 4 examples in its evaluation set: personal-data on "an ambition with a team and two objectives already" \(an email address in the system prompt\)/,
    );

    const read = await callAction(gated(), "ai.readPrompt", {
      promptKey: OBJECTIVE,
    });
    expect(read).toMatchObject({ isDefault: true, history: [] });
    expect(await sentSystemPrompt()).toBe(DEFAULT_PROMPTS[OBJECTIVE]);
  });

  it("stores one that passes, and the next draft sends it", async () => {
    const ours =
      "Draft one objective that names a change, with two or three measures. Use only numbers the writer gave.";
    const saved = await callAction(gated(), "ai.updatePrompt", {
      promptKey: OBJECTIVE,
      systemPrompt: ours,
    });
    expect(saved).toMatchObject({ version: 1, isDefault: false });
    expect(await sentSystemPrompt()).toBe(ours);

    await callAction(gated(), "ai.restorePrompt", { promptKey: OBJECTIVE });
    expect(await sentSystemPrompt()).toBe(DEFAULT_PROMPTS[OBJECTIVE]);
  });
});

describe("a stored version the set fails (design §6)", () => {
  it("is not sent: the built-in text is", async () => {
    // Stored past a gate that said yes to everything, as a version saved
    // before 0.7.0 or brought in by an archive import was.
    const lenient: PromptEvaluator = async (promptKey) => ({
      promptKey,
      known: true,
      fixtures: 1,
      passed: 1,
      failures: [],
    });
    await callAction(gated(lenient), "ai.updatePrompt", {
      promptKey: OBJECTIVE,
      systemPrompt: "Ask priya@northwind.example before drafting anything.",
    });

    expect(await workspacePrompts(pool, workspaceId)).toEqual({});
    expect(await sentSystemPrompt()).toBe(DEFAULT_PROMPTS[OBJECTIVE]);
  });
});
