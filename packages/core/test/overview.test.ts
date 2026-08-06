import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import { callAction, getAction } from "../src/actions/registry.ts";
import { OperationError } from "../src/operations/operation.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * `workspace.overview`, the registry's first read action (P1-T08).
 *
 * The proving dashboard reads through this rather than querying tables, so
 * this is where "one permission decision, everywhere" is tested for reads:
 * the same refusals the write path gives, and the same not-found answer for
 * anybody who should not know the workspace exists.
 */

const USER = "overview-user";

let workspaceId: string;
let memberId: string;

const seedUser = async (id: string, email: string) => {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [id, id, email],
  );
};

const overview = async (userId = USER) => {
  const wb = await workerDb();
  return callAction(
    {
      pool: wb.appPool,
      workspaceId,
      actor: { kind: "human", userId },
    },
    "workspace.overview",
    {},
  );
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await seedUser(USER, "overview@example.com");
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: USER,
    name: "Ada Lovelace",
  });
  workspaceId = provisioned.workspaceId;
  memberId = provisioned.memberId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the contract", () => {
  it("is declared as a read that needs no more than view", () => {
    const action = getAction("workspace.overview");
    expect(action?.safety).toBe("read");
    expect(action?.access).toBe(ACCESS_LEVELS.view);
  });

  it("does not claim to run through the pipeline, because reads do not", () => {
    expect(getAction("workspace.overview")?.runsThroughPipeline).toBe(false);
  });
});

describe("what a member sees", () => {
  it("returns the workspace and the member asking", async () => {
    const result = await overview();

    expect(result.workspace).toMatchObject({
      id: workspaceId,
      name: "Ada Lovelace's workspace",
      slug: "ada-lovelaces-workspace",
      state: "active",
    });
    expect(result.member).toMatchObject({
      id: memberId,
      name: "Ada Lovelace",
      kind: "human",
      status: "active",
    });
  });

  it("carries the workspace's resolved settings, so the page proves provisioning", async () => {
    const result = await overview();
    expect(result.workspace.timezone).toBeTruthy();
  });

  it("matches its declared output schema", async () => {
    // The schema is what REST, OpenAPI and the MCP catalogue will project, so
    // a handler that drifts from it breaks six surfaces at once.
    const action = getAction("workspace.overview");
    const result = await overview();
    expect(action?.output.safeParse(result).success).toBe(true);
  });
});

describe("what somebody else sees", () => {
  it("refuses a person who is not a member", async () => {
    await seedUser("outsider", "outsider@example.com");
    await expect(overview("outsider")).rejects.toThrow(OperationError);
  });

  it("says not-found rather than forbidden, so the workspace is not an oracle", async () => {
    await seedUser("outsider", "outsider@example.com");
    const failure = await overview("outsider").then(
      () => undefined,
      (error: unknown) => error as OperationError,
    );
    expect(failure?.code).toBe("not_found");
  });

  it("refuses a suspended member the same way", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set status = 'suspended', suspended_at = now() where id = $1",
      [memberId],
    );
    const failure = await overview().then(
      () => undefined,
      (error: unknown) => error as OperationError,
    );
    expect(failure?.code).toBe("not_found");
  });

  it("writes nothing at all, being a read", async () => {
    const wb = await workerDb();
    const before = await wb.admin.query(
      "select (select count(*) from audit_events)::int as a, (select count(*) from activities)::int as b",
    );
    await overview();
    const after = await wb.admin.query(
      "select (select count(*) from audit_events)::int as a, (select count(*) from activities)::int as b",
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});
