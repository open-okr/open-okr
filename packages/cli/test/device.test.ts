import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CliContract } from "../src/contract.ts";
import { clientName } from "../src/device.ts";
import { readConfig } from "../src/profiles.ts";
import { run } from "../src/run.ts";

/**
 * The device login, from the terminal's side (P5-T07c-b).
 *
 * A real HTTP server answering the way `/api/v1/cli/device` does, so what is
 * tested is the request the tool makes and how it reads the protocol's own
 * words. The clock and the browser are passed in: a test that waited five
 * seconds per poll would take a minute, and one that opened a browser would open
 * a browser.
 */

const CONTRACT: CliContract = { version: "v1", commands: [] };

interface Seen {
  readonly path: string;
  readonly body: Record<string, unknown>;
}

let server: Server;
let base: string;
let seen: Seen[] = [];
let configFile: string;
/** Queued answers to the poll, in order. The last one repeats. */
let polls: { status: number; body: unknown }[] = [];
let startAnswer: { status: number; body: unknown };
let opened: string[] = [];
let said: string[] = [];
let waits: number[] = [];

const started = (over: Record<string, unknown> = {}) => ({
  status: 200,
  body: {
    data: {
      deviceCode: "DEVICECODEDEVICECODEDEVICECODEDEVICECODE",
      userCode: "ABCD-EFGH",
      verificationUri: `${base}/account/device?code=ABCD-EFGH`,
      expiresIn: 600,
      interval: 5,
      ...over,
    },
  },
});

beforeAll(async () => {
  server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      const path = request.url ?? "";
      seen.push({
        path,
        body: raw === "" ? {} : (JSON.parse(raw) as Record<string, unknown>),
      });
      const answer = path.endsWith("/token")
        ? ((polls.length > 1 ? polls.shift() : polls[0]) ?? {
            status: 500,
            body: {},
          })
        : startAnswer;
      response.writeHead(answer.status, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "string" || address === null) {
    throw new Error("no port");
  }
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  seen = [];
  opened = [];
  said = [];
  waits = [];
  configFile = join(mkdtempSync(join(tmpdir(), "okr-dev-")), "config.json");
  startAnswer = started();
  polls = [
    {
      status: 200,
      body: { data: { token: "okr_rest_grantedtokenthatlooksrealenough" } },
    },
  ];
});

const login = (extra = "") =>
  run(`login --url ${base}${extra ? ` ${extra}` : ""}`.split(" "), {
    contract: CONTRACT,
    configFile,
    say: (line) => said.push(line),
    wait: async (milliseconds) => {
      waits.push(milliseconds);
    },
    open: (url) => opened.push(url),
  });

describe("what the terminal asks for", () => {
  it("asks for read and write, and never destructive", async () => {
    await login();
    const start = seen.find((one) => one.path.endsWith("/cli/device"));
    expect(start?.body.scopes).toEqual(["read", "write"]);
    // Destructive removes things other people can see. A login should not
    // quietly acquire it.
    expect(start?.body.scopes).not.toContain("destructive");
  });

  it("takes the scopes it is given", async () => {
    await login("--scopes read");
    const start = seen.find((one) => one.path.endsWith("/cli/device"));
    expect(start?.body.scopes).toEqual(["read"]);
  });

  it("names itself, so the approval screen can say which machine asked", async () => {
    await login();
    const start = seen.find((one) => one.path.endsWith("/cli/device"));
    expect(start?.body.clientName).toBe(clientName());
    expect(String(start?.body.clientName)).toContain("okr on ");
  });
});

describe("what a person sees", () => {
  it("prints the link and the code, and opens a browser", async () => {
    await login();
    expect(said.join("\n")).toContain("/account/device?code=ABCD-EFGH");
    expect(said.join("\n")).toContain("ABCD-EFGH");
    expect(said.join("\n")).toContain("10 minutes");
    expect(opened).toEqual([`${base}/account/device?code=ABCD-EFGH`]);
  });

  it("saves the profile and hints the token, never printing it", async () => {
    const result = await login();
    expect(result.code).toBe(0);
    expect(result.out).not.toContain(
      "okr_rest_grantedtokenthatlooksrealenough",
    );

    const stored = readConfig(configFile);
    expect(stored.profiles.default?.token).toBe(
      "okr_rest_grantedtokenthatlooksrealenough",
    );
    expect(stored.profiles.default?.url).toBe(base);
  });

  it("stores it under the profile it was told to", async () => {
    await login("--profile staging");
    expect(Object.keys(readConfig(configFile).profiles)).toEqual(["staging"]);
  });
});

describe("waiting", () => {
  it("keeps polling while nobody has answered", async () => {
    polls = [
      {
        status: 400,
        body: { error: { code: "authorization_pending", message: "no" } },
      },
      {
        status: 400,
        body: { error: { code: "authorization_pending", message: "no" } },
      },
      { status: 200, body: { data: { token: "okr_rest_eventually" } } },
    ];

    const result = await login();
    expect(result.code).toBe(0);
    expect(readConfig(configFile).profiles.default?.token).toBe(
      "okr_rest_eventually",
    );
    // Three polls, and it waited the interval it was given before each.
    expect(seen.filter((one) => one.path.endsWith("/token"))).toHaveLength(3);
    expect(waits).toEqual([5000, 5000, 5000]);
  });

  it("waits longer when the instance says slow down", async () => {
    polls = [
      { status: 400, body: { error: { code: "slow_down", message: "wait" } } },
      { status: 200, body: { data: { token: "okr_rest_after" } } },
    ];

    await login();
    // Doubled rather than incremented: a client that is too fast is usually
    // much too fast.
    expect(waits).toEqual([5000, 10_000]);
  });

  it("gives up when the login expires, and says so", async () => {
    startAnswer = started({ expiresIn: 0 });
    const result = await login();
    expect(result.code).toBe(1);
    expect(result.err).toContain("expired");
    // Nothing was polled: the deadline had already passed.
    expect(seen.filter((one) => one.path.endsWith("/token"))).toHaveLength(0);
  });
});

describe("how it ends without a token", () => {
  it("reports a refusal in the browser as a refusal", async () => {
    polls = [
      {
        status: 400,
        body: {
          error: {
            code: "access_denied",
            message: "That login was refused in the browser.",
          },
        },
      },
    ];
    const result = await login();
    expect(result.code).toBe(1);
    expect(result.err).toBe("That login was refused in the browser.");
    expect(Object.keys(readConfig(configFile).profiles)).toEqual([]);
  });

  it("reports an expired code from the instance rather than retrying forever", async () => {
    polls = [
      {
        status: 400,
        body: {
          error: { code: "expired_token", message: "That login expired." },
        },
      },
    ];
    const result = await login();
    expect(result.code).toBe(1);
    expect(result.err).toBe("That login expired.");
  });

  it("carries the instance's refusal to start one at all", async () => {
    startAnswer = {
      status: 429,
      body: {
        error: {
          code: "rate_limited",
          message: "That is a lot of logins at once. Try again shortly.",
        },
      },
    };
    const result = await login();
    expect(result.code).toBe(1);
    expect(result.err).toContain("a lot of logins");
    expect(seen.filter((one) => one.path.endsWith("/token"))).toHaveLength(0);
  });

  it("says so when the instance answers with something that is not JSON", async () => {
    startAnswer = { status: 200, body: undefined };
    const html = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html>");
    });
    await new Promise<void>((resolve) => html.listen(0, "127.0.0.1", resolve));
    const address = html.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const result = await run(["login", "--url", `http://127.0.0.1:${port}`], {
      contract: CONTRACT,
      configFile,
      say: () => {},
      open: () => {},
    });
    await new Promise<void>((resolve) => html.close(() => resolve()));

    expect(result.code).toBe(1);
    expect(result.err).toContain("not JSON");
  });
});

describe("the two ways to log in", () => {
  it("stores a token that is handed to it, with no device flow at all", async () => {
    const result = await run(
      ["login", "--url", base, "--token", "okr_rest_pasted"],
      { contract: CONTRACT, configFile, say: () => {}, open: () => {} },
    );
    expect(result.code).toBe(0);
    expect(seen).toHaveLength(0);
    expect(readConfig(configFile).profiles.default?.token).toBe(
      "okr_rest_pasted",
    );
  });

  it("still needs a URL", async () => {
    const result = await run(["login"], { contract: CONTRACT, configFile });
    expect(result.code).toBe(2);
    expect(result.err).toContain("--url");
  });
});
