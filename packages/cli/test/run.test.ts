import { mkdtempSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CliContract } from "../src/contract.ts";
import { readConfig } from "../src/profiles.ts";
import { run } from "../src/run.ts";

/**
 * The tool end to end, against a real HTTP server (P5-T07c-a).
 *
 * A real server rather than a stubbed `fetch`, because what is being tested is
 * the request: the method, the path, where the values went, and what a refusal
 * looks like when it comes back. A stub would be this file asserting its own
 * expectations.
 *
 * The server answers the way `apps/web/app/api/v1` does, which is the contract
 * both sides are written against.
 */

const CONTRACT: CliContract = {
  version: "v1",
  commands: [
    {
      name: "goals list",
      action: "goals.list",
      method: "GET",
      path: "/goals/list",
      scope: "read",
      summary: "Goals in a cycle.",
      pages: false,
      flags: [
        { name: "space-id", field: "spaceId", type: "string", required: false },
        {
          name: "include-closed",
          field: "includeClosed",
          type: "boolean",
          required: false,
        },
      ],
    },
    {
      name: "goals create",
      action: "goals.create",
      method: "POST",
      path: "/goals/create",
      scope: "write",
      summary: "Create a goal.",
      pages: false,
      flags: [
        { name: "title", field: "title", type: "string", required: true },
      ],
    },
    {
      name: "activities workspaceFeed",
      action: "activities.workspaceFeed",
      method: "GET",
      path: "/activities/workspaceFeed",
      scope: "read",
      summary: "The feed.",
      pages: true,
      flags: [],
    },
  ],
};

interface Seen {
  method: string;
  url: string;
  authorization: string;
  body: string;
}

let server: Server;
let base: string;
let seen: Seen[] = [];
/** What the next request is answered with. */
let reply: { status: number; body: unknown } = { status: 200, body: {} };
let configFile: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      seen.push({
        method: request.method ?? "",
        url: request.url ?? "",
        authorization: request.headers.authorization ?? "",
        body,
      });
      response.writeHead(reply.status, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify(reply.body));
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
  reply = { status: 200, body: { data: { goals: [] } } };
  configFile = join(mkdtempSync(join(tmpdir(), "okr-cfg-")), "config.json");
});

const okr = (line: string) =>
  run(line.split(" ").filter(Boolean), {
    contract: CONTRACT,
    configFile,
  });

const withProfile = async () => {
  await okr(`login --url ${base} --token okr_rest_atokenatokenatoken`);
};

describe("profiles", () => {
  it("stores a profile and never prints the token back", async () => {
    const result = await okr(
      `login --url ${base} --token okr_rest_secretvalue`,
    );
    expect(result.code).toBe(0);
    expect(result.out).not.toContain("okr_rest_secretvalue");
    // Half the length, capped at sixteen: for this twenty-character token that
    // is ten, and for a real fifty-two character one it is sixteen.
    expect(result.out).toContain("okr_rest_s…");

    const stored = readConfig(configFile);
    expect(stored.current).toBe("default");
    expect(stored.profiles.default?.url).toBe(base);
  });

  it("makes the first profile the default, and keeps it when a second arrives", async () => {
    await okr(`login --url ${base} --token okr_rest_one`);
    await okr(`login --url ${base} --token okr_rest_two --profile staging`);
    const stored = readConfig(configFile);
    expect(stored.current).toBe("default");
    expect(Object.keys(stored.profiles).sort()).toEqual(["default", "staging"]);
  });

  it("refuses a URL that is not one", async () => {
    const result = await okr("login --url example.com --token okr_rest_x");
    expect(result.code).toBe(2);
    expect(result.err).toContain("http://");
  });

  it("says what to do when there is no profile at all", async () => {
    const result = await okr("goals list");
    expect(result.code).toBe(2);
    expect(result.err).toContain("/account/api-tokens");
    expect(seen).toHaveLength(0);
  });

  it("names the profiles it does have when the one asked for is absent", async () => {
    await withProfile();
    const result = await okr("goals list --profile staging");
    expect(result.code).toBe(2);
    expect(result.err).toContain("staging");
    expect(result.err).toContain("default");
  });

  it("lists them, marking the default and hinting the token", async () => {
    await withProfile();
    const result = await okr("profiles");
    expect(result.out).toContain("* default");
    expect(result.out).toContain(base);
    expect(result.out).not.toContain("okr_rest_atokenatokenatoken");
  });

  it("forgets one on logout", async () => {
    await withProfile();
    const result = await okr("logout");
    expect(result.code).toBe(0);
    expect(Object.keys(readConfig(configFile).profiles)).toEqual([]);
  });
});

describe("sending a command", () => {
  it("sends a read as a GET with query parameters and the bearer token", async () => {
    await withProfile();
    const result = await okr("goals list --space-id abc --include-closed true");

    expect(result.code).toBe(0);
    expect(seen).toHaveLength(1);
    const request = seen[0] as Seen;
    expect(request.method).toBe("GET");
    expect(request.url).toBe(
      "/api/v1/goals/list?spaceId=abc&includeClosed=true",
    );
    expect(request.authorization).toBe("Bearer okr_rest_atokenatokenatoken");
    expect(request.body).toBe("");
  });

  it("sends a write as a POST with a JSON body", async () => {
    await withProfile();
    reply = { status: 200, body: { data: { id: "g-1" } } };
    const result = await okr("goals create --title Something");

    expect(result.code).toBe(0);
    const request = seen[0] as Seen;
    expect(request.method).toBe("POST");
    expect(request.url).toBe("/api/v1/goals/create");
    expect(JSON.parse(request.body)).toEqual({ title: "Something" });
    expect(JSON.parse(result.out)).toEqual({ id: "g-1" });
  });

  it("prints the action's own output and nothing around it", async () => {
    await withProfile();
    reply = { status: 200, body: { data: { goals: [{ id: "g-1" }] } } };
    const result = await okr("goals list");
    expect(JSON.parse(result.out)).toEqual({ goals: [{ id: "g-1" }] });
    expect(result.err).toBe("");
  });

  it("puts the next cursor on stderr, so a pipe still carries clean JSON", async () => {
    await withProfile();
    reply = { status: 200, body: { data: [], nextCursor: "abc123" } };
    const result = await okr("activities workspaceFeed");
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toEqual([]);
    expect(result.err).toContain("--cursor abc123");
  });

  it("passes a cursor back", async () => {
    await withProfile();
    await okr("activities workspaceFeed --cursor abc123");
    expect((seen[0] as Seen).url).toBe(
      "/api/v1/activities/workspaceFeed?cursor=abc123",
    );
  });

  it("takes a URL and a token from flags, with no profile at all", async () => {
    const result = await run(
      ["goals", "list", "--url", base, "--token", "okr_rest_flag"],
      { contract: CONTRACT, configFile },
    );
    expect(result.code).toBe(0);
    expect((seen[0] as Seen).authorization).toBe("Bearer okr_rest_flag");
  });
});

describe("what a refusal looks like", () => {
  /**
   * The test-plan line: a revoked token reports that it was revoked.
   */
  it("carries the instance's own sentence rather than inventing one", async () => {
    await withProfile();
    reply = {
      status: 401,
      body: {
        error: {
          code: "unauthenticated",
          message: "That token has been revoked.",
        },
      },
    };
    const result = await okr("goals list");

    expect(result.code).toBe(1);
    expect(result.err).toBe("That token has been revoked.");
    // Not "authentication failed", which is what a tool that classified the
    // status itself would have said, and which sends somebody looking for a
    // typo in a token that is perfectly well formed.
    expect(result.err).not.toContain("authentication");
  });

  it("names the scope a token was missing", async () => {
    await withProfile();
    reply = {
      status: 403,
      body: {
        error: {
          code: "insufficient_scope",
          message: "goals.create needs the write scope. This token has: read.",
        },
      },
    };
    const result = await okr("goals create --title Something");
    expect(result.code).toBe(1);
    expect(result.err).toContain("write scope");
  });

  it("lays out field errors under the message", async () => {
    await withProfile();
    reply = {
      status: 422,
      body: {
        error: {
          code: "invalid_input",
          message: "That input is not valid.",
          fields: { title: "Too short." },
        },
      },
    };
    const result = await okr("goals create --title x");
    expect(result.code).toBe(1);
    expect(result.err).toContain("title: Too short.");
  });

  it("says so when the answer is not JSON at all", async () => {
    await withProfile();
    const html = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><title>Sign in</title>");
    });
    await new Promise<void>((resolve) => html.listen(0, "127.0.0.1", resolve));
    const address = html.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const result = await run(
      [
        "goals",
        "list",
        "--url",
        `http://127.0.0.1:${port}`,
        "--token",
        "okr_rest_x",
      ],
      { contract: CONTRACT, configFile },
    );
    await new Promise<void>((resolve) => html.close(() => resolve()));

    expect(result.code).toBe(1);
    expect(result.err).toContain("not JSON");
  });

  it("reports an instance it cannot reach as that, not as a refusal", async () => {
    const result = await run(
      ["goals", "list", "--url", "http://127.0.0.1:1", "--token", "okr_rest_x"],
      { contract: CONTRACT, configFile },
    );
    expect(result.code).toBe(1);
    expect(result.err).toContain("Could not reach");
  });
});

describe("nothing is sent when the line is wrong", () => {
  it("refuses a bad flag before opening a socket", async () => {
    await withProfile();
    seen = [];
    const result = await okr("goals list --nonsense abc");
    expect(result.code).toBe(2);
    expect(seen).toHaveLength(0);
  });

  it("refuses a missing required flag before opening a socket", async () => {
    await withProfile();
    seen = [];
    const result = await okr("goals create");
    expect(result.code).toBe(2);
    expect(result.err).toContain("--title");
    expect(seen).toHaveLength(0);
  });
});

describe("finding a command", () => {
  it("lists a domain's commands when only the domain is typed", async () => {
    const result = await okr("goals");
    expect(result.code).toBe(0);
    expect(result.out).toContain("goals list");
    expect(result.out).toContain("goals create");
  });

  it("says what to run when the command does not exist", async () => {
    const result = await okr("nonsense verb");
    expect(result.code).toBe(2);
    expect(result.err).toContain("okr help");
  });

  it("prints the domains without a profile, because help needs no token", async () => {
    const result = await okr("help");
    expect(result.code).toBe(0);
    expect(result.out).toContain("okr login");
  });
});

describe("the config file", () => {
  it("is written as readable JSON, so a person can fix it by hand", async () => {
    await withProfile();
    const text = readFileSync(configFile, "utf8");
    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(text).profiles.default.url).toBe(base);
  });
});
