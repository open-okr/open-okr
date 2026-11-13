import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { runMcpBridge } from "../src/mcp-bridge.ts";
import { saveProfile } from "../src/profiles.ts";
import { run } from "../src/run.ts";

/**
 * `okr mcp` (docs/design/agent-stdio.md, plan 0.7.0 A1): a desktop agent's
 * standard input and output, bridged to the instance's agent endpoint.
 */

interface Seen {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

/** A fake instance: answers each request with what `reply` returns. */
function instance(
  reply: (body: Record<string, unknown>) => {
    status?: number;
    body?: unknown;
    headers?: Record<string, string>;
  },
) {
  const seen: Seen[] = [];
  const fetch = (async (url: string | URL, init?: RequestInit) => {
    const body = String(init?.body ?? "");
    seen.push({
      url: String(url),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body,
    });
    const answer = reply(JSON.parse(body));
    return new Response(
      answer.body === undefined ? null : JSON.stringify(answer.body),
      {
        status: answer.status ?? 200,
        headers: {
          "content-type": "application/json",
          ...(answer.headers ?? {}),
        },
      },
    );
  }) as typeof globalThis.fetch;
  return { seen, fetch };
}

/** Feeds `lines` to the bridge and returns what it wrote, one message a line. */
async function bridge(
  lines: readonly string[],
  fetch: typeof globalThis.fetch,
  url = "https://okr.example/",
): Promise<unknown[]> {
  const input = new PassThrough();
  const output = new PassThrough();
  const written: string[] = [];
  output.on("data", (chunk) => written.push(String(chunk)));
  const done = runMcpBridge({
    url,
    token: "okr_mcp_agenttoken",
    input,
    output,
    fetch,
  });
  for (const line of lines) {
    input.write(`${line}\n`);
  }
  input.end();
  await done;
  return written
    .join("")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("the bridge", () => {
  it("posts each message with the agent token and passes the answers through in order", async () => {
    const fake = instance((body) => ({
      body: { jsonrpc: "2.0", id: body.id, result: { echo: body.method } },
    }));
    const answers = await bridge(
      [
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      ],
      fake.fetch,
    );

    expect(answers).toEqual([
      { jsonrpc: "2.0", id: 1, result: { echo: "initialize" } },
      { jsonrpc: "2.0", id: 2, result: { echo: "tools/list" } },
    ]);
    expect(fake.seen.map((one) => one.url)).toEqual([
      "https://okr.example/api/mcp",
      "https://okr.example/api/mcp",
    ]);
    expect(fake.seen[0]?.headers.authorization).toBe(
      "Bearer okr_mcp_agenttoken",
    );
  });

  it("sends back the session and protocol version the server gave", async () => {
    const fake = instance((body) =>
      body.method === "initialize"
        ? {
            body: {
              jsonrpc: "2.0",
              id: body.id,
              result: { protocolVersion: "2025-06-18" },
            },
            headers: { "mcp-session-id": "session-1" },
          }
        : { body: { jsonrpc: "2.0", id: body.id, result: {} } },
    );
    await bridge(
      [
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      ],
      fake.fetch,
    );
    expect(fake.seen[1]?.headers["mcp-session-id"]).toBe("session-1");
    expect(fake.seen[1]?.headers["mcp-protocol-version"]).toBe("2025-06-18");
  });

  it("passes on each message of an event-stream answer", async () => {
    const fetch = (async () =>
      new Response(
        'event: message\ndata: {"jsonrpc":"2.0","id":4,"result":{}}\n\n',
        { headers: { "content-type": "text/event-stream" } },
      )) as typeof globalThis.fetch;
    const answers = await bridge(
      [JSON.stringify({ jsonrpc: "2.0", id: 4, method: "ping" })],
      fetch,
    );
    expect(answers).toEqual([{ jsonrpc: "2.0", id: 4, result: {} }]);
  });

  it("writes nothing for a notification the server accepted", async () => {
    const fake = instance(() => ({ status: 202 }));
    const answers = await bridge(
      [JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })],
      fake.fetch,
    );
    expect(answers).toEqual([]);
  });

  it("passes the server's refusal through as it came", async () => {
    const refusal = {
      jsonrpc: "2.0",
      id: 3,
      result: {
        isError: true,
        content: [{ type: "text", text: "That connection has read scope." }],
      },
    };
    const fake = instance(() => ({ body: refusal }));
    const answers = await bridge(
      [JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call" })],
      fake.fetch,
    );
    expect(answers).toEqual([refusal]);
  });

  it("answers an unreachable instance with a JSON-RPC error naming it, and keeps running", async () => {
    let calls = 0;
    const fetch = (async (_url: string | URL, init?: RequestInit) => {
      calls += 1;
      if (calls === 1) {
        throw new Error("connect ECONNREFUSED");
      }
      const body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }),
        { headers: { "content-type": "application/json" } },
      );
    }) as typeof globalThis.fetch;
    const answers = await bridge(
      [
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      ],
      fetch,
    );
    expect(answers).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32000,
          message: "Could not reach https://okr.example/: connect ECONNREFUSED",
        },
      },
      { jsonrpc: "2.0", id: 2, result: {} },
    ]);
  });

  it("refuses a line that is not JSON without sending it", async () => {
    const fake = instance(() => ({ body: {} }));
    const answers = await bridge(["not json"], fake.fetch);
    expect(answers).toEqual([
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "That line is not JSON." },
      },
    ]);
    expect(fake.seen).toEqual([]);
  });
});

describe("okr mcp", () => {
  const configFile = () =>
    join(mkdtempSync(join(tmpdir(), "okr-mcp-")), "config.json");

  it("refuses a profile with only a REST token, and says how to add an agent token", async () => {
    const file = configFile();
    saveProfile(
      "default",
      { url: "https://okr.example", token: "okr_rest_atokenatoken" },
      file,
    );
    const result = await run(["mcp"], {
      configFile: file,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
    });
    expect(result.code).toBe(2);
    expect(result.err).toContain("--mcp-token");
  });

  it("stores an agent token beside the REST token with okr login --mcp-token", async () => {
    const file = configFile();
    saveProfile(
      "default",
      { url: "https://okr.example", token: "okr_rest_atokenatoken" },
      file,
    );
    const result = await run(
      [
        "login",
        "--url",
        "https://okr.example",
        "--mcp-token",
        "okr_mcp_agenttokenagent",
      ],
      { configFile: file },
    );
    expect(result.code).toBe(0);
    // Never the token itself on the screen.
    expect(result.out).not.toContain("okr_mcp_agenttokenagent");
    const { readConfig } = await import("../src/profiles.ts");
    expect(readConfig(file).profiles.default).toEqual({
      url: "https://okr.example",
      token: "okr_rest_atokenatoken",
      mcpToken: "okr_mcp_agenttokenagent",
    });
  });

  it("refuses an http address that is not the machine's own, before sending anything", async () => {
    const fake = instance((body) => ({
      body: { jsonrpc: "2.0", id: body.id, result: {} },
    }));
    await expect(
      bridge(
        [JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })],
        fake.fetch,
        "http://okr.example/",
      ),
    ).rejects.toThrow(/https/);
    expect(fake.seen).toEqual([]);
  });

  it("allows http for localhost", async () => {
    const fake = instance((body) => ({
      body: { jsonrpc: "2.0", id: body.id, result: {} },
    }));
    const answers = await bridge(
      [JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })],
      fake.fetch,
      "http://localhost:3000",
    );
    expect(answers).toEqual([{ jsonrpc: "2.0", id: 1, result: {} }]);
    expect(fake.seen[0]?.url).toBe("http://localhost:3000/api/mcp");
  });

  it("refuses a redirect to another origin and says so on the request", async () => {
    const fake = instance(() => ({
      status: 302,
      headers: { location: "https://elsewhere.example/api/mcp" },
    }));
    const answers = await bridge(
      [JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })],
      fake.fetch,
    );
    // Only the first address was asked, so the token went nowhere else.
    expect(fake.seen).toHaveLength(1);
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      error: { message: expect.stringContaining("redirect") },
    });
  });
});
