import { mcpSessions, withWorkspace } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import {
  approveAuthorisationForMember,
  challengeFor,
  closeSessionFor,
  dispatchResource,
  dispatchTool,
  MCP_RESOURCES,
  matchTemplate,
  negotiateVersion,
  originAllowed,
  recordSessionFor,
  redeemCodeForTokens,
  SUPPORTED_PROTOCOL_VERSIONS,
  sessionFor,
} from "../src/index.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Running a tool as an external agent (AI-NATIVE-PLAN.md §8.3, P5-T09b).
 *
 * The acceptance criterion is the second test: an agent holding read scope
 * calling a write tool is denied by the permission layer, and gets a clear
 * error rather than a partial result.
 */

const OWNER = "mcp-owner";
const VIEWER = "mcp-viewer";
const ISSUER = "https://okr.example";
/**
 * What a grant is bound to: the protected resource, not the instance root.
 * RFC 9728 names the agent endpoint, so that is what a client sends back and
 * what every token is checked against.
 */
const RESOURCE = `${ISSUER}/api/mcp`;
const REDIRECT = "http://127.0.0.1:7777/callback";
const VERIFIER = "a".repeat(64);

let workspaceId: string;
let grantId: string;

const context = (userId = OWNER) => ({
  workspaceId,
  actor: { kind: "human" as const, userId },
});

/** A grant with exactly these scopes, as the consent screen would make it. */
async function grantWith(scopes: readonly string[]): Promise<string> {
  const wb = await workerDb();
  const outcome = await approveAuthorisationForMember(wb.appPool, {
    workspaceId,
    userId: OWNER,
    clientId: "openokr-cli",
    redirectUri: REDIRECT,
    challenge: challengeFor(VERIFIER),
    challengeMethod: "S256",
    scope: scopes.join(" "),
    resource: "",
    issuer: ISSUER,
    now: new Date(),
  });
  if (outcome.kind !== "issued") {
    throw new Error("expected a code");
  }
  grantId = outcome.grantId;
  const tokens = await redeemCodeForTokens(wb.appPool, {
    code: outcome.code,
    verifier: VERIFIER,
    redirectUri: REDIRECT,
    resource: RESOURCE,
    now: new Date(),
  });
  if (tokens.kind !== "issued") {
    throw new Error("expected tokens");
  }
  return tokens.tokens.accessToken;
}

const run = async (
  name: string,
  input: Record<string, unknown> = {},
  scopes: readonly string[] = ["read", "write"],
  userId = OWNER,
) => {
  const wb = await workerDb();
  return dispatchTool(wb.appPool, { workspaceId, userId, scopes }, name, input);
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [
      OWNER,
      "Ada",
      "mcp-owner@example.com",
      VIEWER,
      "Bo",
      "mcp-viewer@example.com",
    ],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Ada",
  });
  workspaceId = provisioned.workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the two gates, and neither substituting for the other", () => {
  it("runs a read a grant carries the scope for", async () => {
    const outcome = await run("cycles.list", {}, ["read"]);
    expect(outcome.isError).toBe(false);
    expect(() => JSON.parse(outcome.text)).not.toThrow();
  });

  it("acceptance: a read-scoped agent calling a write tool is denied, clearly", async () => {
    const outcome = await run("goals.create", { title: "Anything" }, ["read"]);

    expect(outcome.isError).toBe(true);
    // Names the scope it has and the scope it needed, because a person
    // debugging their agent has to know what to ask for next time.
    expect(outcome.text).toContain("read scope");
    expect(outcome.text).toContain("goals.create needs write");
  });

  it("refuses before the action runs, so nothing is half done", async () => {
    await run("goals.create", { title: "Never written" }, ["read"]);

    const wb = await workerDb();
    const goals = await wb.admin.query(
      "select count(*)::int as count from goals where workspace_id = $1",
      [workspaceId],
    );
    expect(goals.rows[0].count).toBe(0);
  });

  it("needs destructive scope for a destructive tool, not write", async () => {
    const outcome = await run(
      "goals.delete",
      { id: "00000000-0000-4000-8000-000000000000" },
      ["read", "write"],
    );
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain("needs destructive");
  });

  it("still lets can() decide once the scope allows it", async () => {
    // A grant with write scope held by somebody who is not a member of this
    // workspace reaches nothing: the scope narrows, `can()` decides.
    const outcome = await run(
      "goals.create",
      { title: "Anything" },
      ["read", "write"],
      VIEWER,
    );
    expect(outcome.isError).toBe(true);
  });
});

describe("what a refusal says, and what it does not", () => {
  it("answers a tool it does not have by name", async () => {
    const outcome = await run("goals.nonsense");
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain("goals.nonsense");
  });

  it("carries the browser's own sentence for a not-found", async () => {
    // Unchanged, so a probe learns nothing about what exists in a workspace it
    // cannot see.
    const outcome = await run("goals.read", {
      id: "00000000-0000-4000-8000-000000000000",
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.text.length).toBeGreaterThan(0);
  });

  it("never throws, because a thrown error is a thing an agent retries", async () => {
    // An input the schema refuses, which is a fault rather than a refusal.
    await expect(run("goals.read", { id: "not-a-uuid" })).resolves.toEqual({
      text: "That call could not be completed.",
      isError: true,
    });
  });
});

describe("resources, which are actions with a friendlier address", () => {
  it("binds a template's variable and runs the action behind it", async () => {
    const wb = await workerDb();
    const cycle = await callAction(
      { pool: wb.appPool, ...context() },
      "cycles.current",
      { mode: "quarterly" },
    );
    const member = await wb.admin.query(
      "select id from workspace_members where workspace_id = $1 and user_id = $2",
      [workspaceId, OWNER],
    );
    const memberId = member.rows[0].id as string;
    const goal = (await callAction(
      { pool: wb.appPool, ...context() },
      "goals.create",
      {
        cycleId: cycle?.id as string,
        level: "company",
        title: "Become the preferred platform for mid-market teams",
        ownerKind: "workspace",
        championId: memberId,
        reviewerId: memberId,
        weight: 1,
      },
    )) as { id: string };

    const outcome = await dispatchResource(
      wb.appPool,
      { workspaceId, userId: OWNER, scopes: ["read"] },
      `openokr://goal/${goal.id}`,
      MCP_RESOURCES,
    );
    expect(outcome.isError).toBe(false);
    expect(outcome.text).toContain("mid-market");
  });

  it("answers nothing for a URI no template matches", async () => {
    const wb = await workerDb();
    const outcome = await dispatchResource(
      wb.appPool,
      { workspaceId, userId: OWNER, scopes: ["read"] },
      "openokr://nothing/1",
      MCP_RESOURCES,
    );
    expect(outcome.isError).toBe(true);
  });
});

describe("reading a URI template", () => {
  it("binds the variable it names", () => {
    expect(
      matchTemplate("openokr://goal/{goalId}", "openokr://goal/abc"),
    ).toEqual({ goalId: "abc" });
  });

  it("refuses a URI with an extra segment, rather than binding a slash", () => {
    expect(
      matchTemplate("openokr://goal/{goalId}", "openokr://goal/abc/extra"),
    ).toBeNull();
  });

  it("refuses a URI for another template", () => {
    expect(
      matchTemplate("openokr://goal/{goalId}", "openokr://cycle/abc"),
    ).toBeNull();
  });

  it("decodes what the address encoded", () => {
    expect(
      matchTemplate("openokr://goal/{goalId}", "openokr://goal/a%20b"),
    ).toEqual({ goalId: "a b" });
  });
});

describe("the protocol version", () => {
  it("agrees to one both sides speak", () => {
    for (const version of SUPPORTED_PROTOCOL_VERSIONS) {
      expect(negotiateVersion(version), version).toBe(version);
    }
  });

  it("refuses one it cannot speak, rather than guessing", () => {
    expect(negotiateVersion("1999-01-01")).toBeNull();
  });

  it("gives a client that names none the oldest, as the specification says", () => {
    expect(negotiateVersion(null)).toBe(
      SUPPORTED_PROTOCOL_VERSIONS[SUPPORTED_PROTOCOL_VERSIONS.length - 1],
    );
  });
});

describe("the origin, which is the rebinding defence", () => {
  it("allows the instance's own", () => {
    expect(originAllowed("https://okr.example", ISSUER)).toBe(true);
    expect(originAllowed("https://okr.example:443", ISSUER)).toBe(true);
  });

  it("allows a request with no origin, which is a program rather than a page", () => {
    expect(originAllowed(null, ISSUER)).toBe(true);
    expect(originAllowed("", ISSUER)).toBe(true);
  });

  it("refuses anywhere else, and anything that is not an origin", () => {
    expect(originAllowed("https://attacker.test", ISSUER)).toBe(false);
    expect(originAllowed("http://okr.example", ISSUER)).toBe(false);
    expect(originAllowed("not an origin", ISSUER)).toBe(false);
  });
});

describe("the session record", () => {
  const sessions = async () => {
    const wb = await workerDb();
    return withWorkspace(drizzle(wb.appPool), workspaceId, async (tx) =>
      tx
        .select()
        .from(mcpSessions)
        .where(eq(mcpSessions.workspaceId, workspaceId)),
    );
  };

  it("records a session against its grant, storing only a digest", async () => {
    await grantWith(["read"]);
    const wb = await workerDb();
    await recordSessionFor(wb.appPool, {
      workspaceId,
      grantId,
      sessionId: "session-abc",
      protocolVersion: "2025-06-18",
      now: new Date(),
    });

    const [row] = await sessions();
    expect(row?.grantId).toBe(grantId);
    expect(row?.protocolVersion).toBe("2025-06-18");
    // Never the identifier itself: a table of live sessions must not be a table
    // of ways to attach to somebody's stream.
    expect(row?.sessionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.sessionHash).not.toContain("session-abc");
  });

  it("is one row however many times a transport re-initialises it", async () => {
    await grantWith(["read"]);
    const wb = await workerDb();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await recordSessionFor(wb.appPool, {
        workspaceId,
        grantId,
        sessionId: "session-abc",
        protocolVersion: "2025-06-18",
        now: new Date(),
      });
    }
    expect(await sessions()).toHaveLength(1);
  });

  it("closes on request, and keeps the row so it can be seen", async () => {
    await grantWith(["read"]);
    const wb = await workerDb();
    await recordSessionFor(wb.appPool, {
      workspaceId,
      grantId,
      sessionId: "session-abc",
      protocolVersion: "2025-06-18",
      now: new Date(),
    });
    await closeSessionFor(wb.appPool, {
      workspaceId,
      sessionId: "session-abc",
      now: new Date(),
    });

    const [row] = await sessions();
    expect(row?.closedAt).not.toBeNull();
  });

  it("finds which workspace a session belongs to before one is known", async () => {
    await grantWith(["read"]);
    const wb = await workerDb();
    await recordSessionFor(wb.appPool, {
      workspaceId,
      grantId,
      sessionId: "session-abc",
      protocolVersion: "2025-06-18",
      now: new Date(),
    });

    const found = await sessionFor(wb.appPool, "session-abc");
    expect(found?.workspaceId).toBe(workspaceId);
    expect(await sessionFor(wb.appPool, "session-nobody-issued")).toBeNull();
  });

  it("goes when its grant goes, because it was for nothing without it", async () => {
    await grantWith(["read"]);
    const wb = await workerDb();
    await recordSessionFor(wb.appPool, {
      workspaceId,
      grantId,
      sessionId: "session-abc",
      protocolVersion: "2025-06-18",
      now: new Date(),
    });

    await wb.admin.query("delete from oauth_grants where id = $1", [grantId]);
    expect(await sessions()).toHaveLength(0);
  });
});
