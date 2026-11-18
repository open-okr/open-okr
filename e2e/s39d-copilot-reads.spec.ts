/**
 * The Northwind questions, asked in a browser (plan 0.9.0 L6, docs/design/
 * copilot-live-data.md sections 1 and 9).
 *
 * Acceptance criteria:
 *   Given a key result at 64.64 of 68 with confidence 0.6, when its owner asks
 *   how it is doing, then the panel says what it is reading, the answer gives
 *   the stored value, target and confidence, the source links to the key
 *   result, and after a reload the line "Searched your workspace, made 2
 *   reads" is still there (criteria 1 and 10).
 *   Given an objective the member cannot read, when they ask about it, then no
 *   tool result and no answer names it (criterion 3).
 *   Given no provider, when they ask the same question, then they see matching
 *   passages and the reason, and no model is called (criterion 8).
 *
 * **What is scripted and what is real.** The instance has no AI provider, so
 * this file starts a small server on this machine that speaks the OpenAI chat
 * shape, and points the workspace's `ollama` provider at it (a keyless
 * provider, so no secret is stored). The server plays the model: it chooses
 * the reads, as `toolRounds` does in the mock driver, and it writes its answer
 * from the passages the product sends it. **Everything else is the product's:**
 * the reads run as the member through `callAction`, the numbered references,
 * the sources, the recording in `ai_tool_calls`, the stream and the panel. The
 * mock driver itself cannot be used here, because the server process builds
 * its provider from the database and `createAIProvider` has no mock kind.
 *
 * **The file cleans up after itself.** The suite is the AI-off leg, so the
 * provider row is removed at the end, and so are the objectives made here.
 *
 * **The file name carries the run order**, as `s39-copilot.spec.ts` explains.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import type {
  APIRequestContext,
  BrowserContext,
  Locator,
  Page,
} from "@playwright/test";
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import pg from "pg";
import { expect, test } from "./fixtures.ts";
import { goTo, INSTANCE_ACCOUNT, signIn } from "./instance-account.ts";

const CONNECTION = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : connectionOptions(
      process.env.E2E_DATABASE ?? "openokr_e2e",
      // The superuser, for the reason `s39b-copilot-proposals.spec.ts` gives:
      // these setup queries run before any tenant setting could be applied.
      testDbEnv.superuser,
    );

const GOAL_TITLE = "Raise activation for mid-market teams";
const KR_TITLE = "Activated accounts in the first 14 days";
const SECRET_TITLE = "Quietly merge the Lisbon office";
const ACTIVATION_QUESTION = "How is my activation key result doing?";
const SECRET_QUESTION = "How is my secret restructuring objective doing?";

/** One request the scripted model received. */
interface Received {
  readonly kind: "tools" | "answer" | "proposal" | "embedding" | "other";
  readonly body: {
    readonly messages?: readonly {
      readonly role: string;
      readonly content?: unknown;
      readonly tool_calls?: readonly unknown[];
    }[];
  };
}

const received: Received[] = [];
/** Held before the answer's first word, so the step line can be seen. */
let answerDelayMs = 2_500;
/** Things the script wanted from a tool result and did not find. */
const scriptMisses: string[] = [];

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const textOf = (content: unknown): string =>
  typeof content === "string" ? content : JSON.stringify(content ?? "");

function toolReply(
  res: http.ServerResponse,
  call: { name: string; args: Record<string, unknown> } | null,
): void {
  const message = call
    ? {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: `call-${Math.random().toString(36).slice(2)}`,
            type: "function",
            function: {
              // The wire name: a dot becomes an underscore.
              name: call.name.replace(/[^a-zA-Z0-9_-]/g, "_"),
              arguments: JSON.stringify(call.args),
            },
          },
        ],
      }
    : { role: "assistant", content: "READY" };
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      id: "chatcmpl-e2e",
      object: "chat.completion",
      created: 0,
      model: "llama3.1",
      choices: [
        {
          index: 0,
          message,
          finish_reason: call ? "tool_calls" : "stop",
        },
      ],
      usage: { prompt_tokens: 120, completion_tokens: 12, total_tokens: 132 },
    }),
  );
}

/** The model's choice of reads: find the objective, then open it. */
function chooseRound(
  res: http.ServerResponse,
  messages: NonNullable<Received["body"]["messages"]>,
): void {
  const question = textOf(
    [...messages].reverse().find((m) => m.role === "user")?.content,
  );
  const secret = question.includes("secret restructuring");
  const round = messages.filter(
    (m) => m.role === "assistant" && (m.tool_calls?.length ?? 0) > 0,
  ).length;
  if (round === 0) {
    toolReply(res, { name: "goals.list", args: { mine: true, limit: 50 } });
    return;
  }
  if (round === 1) {
    if (secret) {
      // A reference the model was never shown. The record it is after is not
      // in the list, because this member cannot read it.
      toolReply(res, { name: "goals.read", args: { id: 999 } });
      return;
    }
    const listed = textOf(
      [...messages].reverse().find((m) => m.role === "tool")?.content,
    );
    const found = new RegExp(`\\[(\\d+)\\] ${escapeRegExp(GOAL_TITLE)} \\(`).exec(
      listed,
    );
    if (!found?.[1]) {
      scriptMisses.push(`the list did not show "${GOAL_TITLE}"`);
      toolReply(res, null);
      return;
    }
    toolReply(res, { name: "goals.read", args: { id: Number(found[1]) } });
    return;
  }
  toolReply(res, null);
}

/** The answer, written from the passages the product sent, streamed. */
async function streamAnswer(
  res: http.ServerResponse,
  messages: NonNullable<Received["body"]["messages"]>,
): Promise<void> {
  const prompt = textOf(
    [...messages].reverse().find((m) => m.role === "user")?.content,
  );
  const passages = [
    ...prompt.matchAll(
      /\[(\d+)\] (.*)\n<<<passage \1>>>\n([\s\S]*?)\n<<<end passage \1>>>/g,
    ),
  ].map((one) => ({
    index: Number(one[1]),
    label: one[2] ?? "",
    content: (one[3] ?? "").replace(/\s+/g, " ").trim(),
  }));
  // The goals list shows this member's own key result too, so the secret
  // question must be answered as not found whatever the passages hold.
  const keyResult = prompt.includes("secret restructuring")
    ? undefined
    : passages.find((one) => one.label === KR_TITLE);
  const text = keyResult
    ? `${keyResult.content} [${keyResult.index}]\nSOURCES: ${keyResult.index}`
    : "I could not find that objective, so I cannot say how it is doing.\nSOURCES: none";

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
  });
  await new Promise((resolve) => setTimeout(resolve, answerDelayMs));
  const chunk = (delta: object, usage?: object) =>
    `data: ${JSON.stringify({
      id: "chatcmpl-e2e",
      object: "chat.completion.chunk",
      created: 0,
      model: "llama3.1",
      choices: usage ? [] : [{ index: 0, delta, finish_reason: null }],
      ...(usage ? { usage } : {}),
    })}\n\n`;
  const pieces = text.match(/[\s\S]{1,40}/g) ?? [text];
  for (const piece of pieces) {
    res.write(chunk({ content: piece }));
  }
  res.write(
    chunk(
      {},
      { prompt_tokens: 400, completion_tokens: 40, total_tokens: 440 },
    ),
  );
  res.end("data: [DONE]\n\n");
}

function startModel(): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (piece: Buffer) => chunks.push(piece));
    req.on("end", () => {
      let body: Received["body"] & {
        tools?: unknown[];
        stream?: boolean;
        response_format?: unknown;
      } = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        body = {};
      }
      const messages = body.messages ?? [];
      const path = req.url ?? "";
      if (path.includes("/embeddings")) {
        received.push({ kind: "embedding", body });
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "no embeddings here" } }));
        return;
      }
      if (!path.includes("/chat/completions")) {
        received.push({ kind: "other", body });
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "not found" } }));
        return;
      }
      if ((body.tools?.length ?? 0) > 0) {
        received.push({ kind: "tools", body });
        chooseRound(res, messages);
        return;
      }
      if (body.stream) {
        received.push({ kind: "answer", body });
        void streamAnswer(res, messages);
        return;
      }
      // The proposal check: a structured reply that proposes nothing.
      received.push({ kind: "proposal", body });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-e2e",
          object: "chat.completion",
          created: 0,
          model: "llama3.1",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: JSON.stringify({
                  propose: false,
                  action: "none",
                  fields: {},
                  why: "",
                }),
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 60, completion_tokens: 10, total_tokens: 70 },
        }),
      );
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
let pool: pg.Pool;
let model: http.Server;
let token = "";
let workspaceId = "";
let memberId = "";
let providerId = "";
let goalId = "";
let secretGoalId = "";
let keyResultId = "";
let startedAt = new Date();

const authed = () => ({ authorization: `Bearer ${token}` });

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  pool = new pg.Pool(CONNECTION);
  model = await startModel();
  context = await browser.newContext();
  page = await context.newPage();
  api = await playwright.request.newContext({ baseURL });
});

test.afterAll(async () => {
  // The suite is the AI-off leg: leave the instance as it was found.
  try {
    if (providerId) {
      await pool.query("delete from ai_providers where id = $1", [providerId]);
    }
    for (const id of [goalId, secretGoalId]) {
      if (id && token) {
        await api.post("/api/v1/goals/delete", {
          headers: authed(),
          data: { id },
        });
      }
    }
  } finally {
    await api?.dispose();
    await pool?.end();
    await context?.close();
    await new Promise<void>((resolve) => model.close(() => resolve()));
  }
});

/** Opens the panel by clicking, and starts an empty conversation. */
async function openFreshPanel() {
  await goTo(page, "/");
  await expect(
    page.getByRole("heading", { level: 1, name: "Work map" }),
  ).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState("networkidle");
  const panel = page.getByRole("dialog", { name: "Copilot" });
  if (!(await panel.isVisible())) {
    await page.getByRole("button", { name: "Ask the copilot" }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole("button", { name: "New chat" }).click();
  return panel;
}

async function ask(panel: Locator, question: string): Promise<void> {
  await panel.getByRole("textbox").fill(question);
  await panel.getByRole("button", { name: "Send the question" }).click();
  await expect(panel.getByText(question).first()).toBeVisible({
    timeout: 15_000,
  });
}

test("set up: the objectives are real, and the workspace's provider is the scripted model", async () => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("Copilot reads e2e");
  await expect(page.getByRole("checkbox", { name: /^Read/ })).toBeChecked();
  await page.getByRole("checkbox", { name: /^Write/ }).check();
  await page.getByRole("checkbox", { name: /^Destructive/ }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  token = ((await shown.textContent()) ?? "").trim();

  const member = (
    await pool.query<{ id: string; workspace_id: string }>(
      `select m.id, m.workspace_id
       from workspace_members m
       join users u on u.id = m.user_id
       where u.email = $1
       limit 1`,
      [INSTANCE_ACCOUNT.email],
    )
  ).rows[0];
  if (!member) {
    throw new Error("Member not found. Did the claiming spec run?");
  }
  memberId = member.id;
  workspaceId = member.workspace_id;

  const post = async (path: string, data: object) => {
    const response = await api.post(`/api/v1/${path}`, {
      headers: authed(),
      data,
    });
    expect(response.status(), `${path}: ${await response.text()}`).toBe(200);
    return (await response.json()).data as Record<string, unknown>;
  };

  const spaces = await api.get("/api/v1/spaces/list", { headers: authed() });
  const spaceId = ((await spaces.json()).data as { id: string }[])[0]
    ?.id as string;
  const cycles = await api.get("/api/v1/cycles/current?mode=quarterly", {
    headers: authed(),
  });
  const cycleId = (await cycles.json()).data.id as string;

  const newGoal = (title: string) =>
    post("goals/create", {
      title,
      cycleId,
      level: "team",
      ownerKind: "space",
      spaceId,
      championId: memberId,
      reviewerId: memberId,
      weight: 1,
    });

  goalId = (await newGoal(GOAL_TITLE)).id as string;
  keyResultId = (
    await post("goals/addKeyResult", {
      goalId,
      title: KR_TITLE,
      direction: "increase",
      indicatorType: "lagging",
      baselineValue: 40,
      targetValue: 68,
      weight: 1,
      ownerId: memberId,
    })
  ).id as string;
  await post("goals/recordValue", { id: keyResultId, value: 64.64 });
  await post("goals/updateConfidence", { id: keyResultId, confidence: 0.6 });

  // An objective this member cannot read: made, then deleted. A deleted row is
  // not found through the access getter, whoever asks.
  secretGoalId = (await newGoal(SECRET_TITLE)).id as string;
  await post("goals/delete", { id: secretGoalId });

  // A keyless provider whose address is the scripted model.
  const port = (model.address() as AddressInfo).port;
  providerId = (
    await pool.query<{ id: string }>(
      `insert into ai_providers (id, workspace_id, provider, base_url, enabled)
       values (gen_random_uuid(), $1, 'ollama', $2, true)
       returning id`,
      [workspaceId, `http://127.0.0.1:${port}/v1`],
    )
  ).rows[0]?.id as string;
});

test("the panel says what it is reading, then answers from the stored values with a link to the key result", async () => {
  startedAt = new Date();
  const panel = await openFreshPanel();
  await ask(panel, ACTIVATION_QUESTION);

  // The working line, replaced in place while no word has come. The model
  // holds its answer back long enough for it to be read.
  await expect(
    panel.getByText(/^(Looking through objectives|Reading .+|Writing the answer)…$/),
  ).toBeVisible({ timeout: 15_000 });
  // The polite status line is the panel's own region for it.
  await expect(panel.getByRole("status").first()).toBeAttached();

  const turn = panel.locator("article").last();
  // What the key result holds, as the product stored it: from the read, not
  // from the model.
  await expect(turn).toContainText("64.64", { timeout: 30_000 });
  await expect(turn).toContainText("68");
  await expect(turn).toContainText("0.6");
  await expect(panel.locator("article[aria-busy]")).toHaveCount(0, {
    timeout: 30_000,
  });
  expect(scriptMisses).toEqual([]);

  // Folded into one line once the words arrived.
  await expect(
    turn.getByText("Searched your workspace, made 2 reads"),
  ).toBeVisible();

  // The source opens the key result on its goal's page, a link the server
  // made. Exact, so a numbered chip named "Source 1: <title>" is not a second match.
  await expect(
    turn.getByRole("link", { name: KR_TITLE, exact: true }),
  ).toHaveAttribute("href", `/goals/${goalId}#kr-${keyResultId}`);

  // Each read is a recorded row, as the member's.
  const rows = await pool.query<{ tool: string; outcome: string }>(
    `select tool, outcome from ai_tool_calls
     where workspace_id = $1 and member_id = $2 and source = 'copilot'
       and called_at >= $3
     order by called_at`,
    [workspaceId, memberId, startedAt],
  );
  expect(rows.rows.map((row) => row.tool)).toEqual([
    "goals.list",
    "goals.read",
  ]);
  expect(rows.rows.every((row) => row.outcome === "ok")).toBe(true);
});

test("after a reload the line still says how many reads it made", async () => {
  const reads = (
    await pool.query<{ count: string }>(
      `select count(*) from ai_tool_calls
       where workspace_id = $1 and member_id = $2 and source = 'copilot'
         and called_at >= $3`,
      [workspaceId, memberId, startedAt],
    )
  ).rows[0]?.count;
  expect(reads).toBe("2");

  await page.reload();
  const panel = page.getByRole("dialog", { name: "Copilot" });
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByText(ACTIVATION_QUESTION).first()).toBeVisible({
    timeout: 15_000,
  });
  // The steps are not stored; the count is rebuilt from the record.
  await expect(
    panel.getByText(`Searched your workspace, made ${reads} reads`),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    panel.getByRole("link", { name: KR_TITLE, exact: true }),
  ).toHaveAttribute("href", `/goals/${goalId}#kr-${keyResultId}`);
});

test("an objective the member cannot read is not named, in a tool result or in the answer", async () => {
  answerDelayMs = 0;
  const before = received.length;
  const panel = await openFreshPanel();
  await ask(panel, SECRET_QUESTION);

  await expect(
    panel.getByText("I could not find that objective", { exact: false }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(panel.locator("article[aria-busy]")).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(panel.getByText(SECRET_TITLE)).toHaveCount(0);
  await expect(page.getByText(SECRET_TITLE)).toHaveCount(0);

  // Nothing the model was sent, in a tool result or in the passages, held it.
  const sent = JSON.stringify(received.slice(before).map((one) => one.body));
  expect(sent).not.toContain(SECRET_TITLE);
  expect(sent).toContain("That is not something you were shown.");
});

test("with the provider off, the same question returns matching passages and the reason, and no model is called", async () => {
  await pool.query("update ai_providers set enabled = false where id = $1", [
    providerId,
  ]);
  const before = received.length;
  const panel = await openFreshPanel();
  await ask(panel, ACTIVATION_QUESTION);

  await expect(
    panel.getByText("No AI provider is configured", { exact: false }).first(),
  ).toBeVisible({ timeout: 15_000 });
  await expect(panel.locator("article[aria-busy]")).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(
    panel
      .getByRole("log", { name: "Conversation" })
      .getByText("these are the passages that match your question", {
        exact: false,
      }),
  ).toBeVisible();
  await expect(panel.getByText(/Searched your workspace, made/)).toHaveCount(0);
  expect(
    received.slice(before).filter((one) => one.kind !== "embedding"),
  ).toEqual([]);
});
