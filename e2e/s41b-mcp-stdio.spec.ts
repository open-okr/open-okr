/**
 * `okr mcp`, the standard input and output bridge, against a real instance
 * (docs/design/agent-stdio.md, plan 0.7.0 A1).
 *
 * Acceptance:
 *   Given a profile with an agent token, when a desktop agent starts
 *   `okr mcp` and sends `initialize` then `tools/list`, then it receives the
 *   instance's answers, the same as over HTTP.
 *
 * The bridge runs as its own process, as a desktop agent would start it, with
 * a profile file of its own. Relies on the claim and nothing else.
 */
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let agentToken = "";

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await context?.close();
});

/** Starts `okr mcp` and returns a way to send a message and read the answer. */
function startBridge(baseURL: string, token: string) {
  const config = join(mkdtempSync(join(tmpdir(), "okr-mcp-e2e-")), "config.json");
  writeFileSync(
    config,
    JSON.stringify({
      current: "default",
      profiles: { default: { url: baseURL, token: "", mcpToken: token } },
    }),
  );
  const child: ChildProcessWithoutNullStreams = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings",
      "packages/cli/src/bin/okr.ts",
      "mcp",
    ],
    { env: { ...process.env, OPENOKR_CONFIG: config } },
  );
  const answers: unknown[] = [];
  const waiting: ((answer: unknown) => void)[] = [];
  createInterface({ input: child.stdout }).on("line", (line) => {
    const answer = JSON.parse(line);
    const next = waiting.shift();
    if (next) {
      next(answer);
    } else {
      answers.push(answer);
    }
  });
  return {
    send(message: Record<string, unknown>): Promise<unknown> {
      child.stdin.write(`${JSON.stringify(message)}\n`);
      const ready = answers.shift();
      return ready
        ? Promise.resolve(ready)
        : new Promise((resolve) => waiting.push(resolve));
    },
    close() {
      child.stdin.end();
      child.kill();
    },
  };
}

test("mint an agent token", async () => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("Desktop agent over stdio e2e");
  await page.getByRole("radio", { name: /An AI agent/ }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  agentToken = ((await shown.textContent()) ?? "").trim();
  expect(agentToken).toMatch(/^okr_mcp_/);
});

test("acceptance: initialize then tools/list over standard input and output", async ({
  baseURL,
}) => {
  const bridge = startBridge(baseURL ?? "http://127.0.0.1:3210", agentToken);
  try {
    const initialized = (await bridge.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "stdio-e2e", version: "1.0.0" },
      },
    })) as { id: number; result?: { serverInfo?: { name?: string } } };
    expect(initialized.id).toBe(1);
    expect(initialized.result?.serverInfo?.name).toBeTruthy();

    const listed = (await bridge.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    })) as { id: number; result?: { tools?: { name: string }[] } };
    expect(listed.id).toBe(2);
    expect(listed.result?.tools?.length ?? 0).toBeGreaterThan(0);
  } finally {
    bridge.close();
  }
});
