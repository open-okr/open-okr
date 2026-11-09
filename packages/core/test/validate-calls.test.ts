/**
 * Validation calls (plan D4, TECHNICAL-PLAN §14 "validation endpoints").
 *
 * A write checked without committing is the write itself run as a dry run, so
 * these tests hold it to two promises: it answers exactly what the write would,
 * and it keeps nothing, not the row, not the activity, not the audit row and
 * not the outbox row that would have caused a side effect.
 */
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  ACTIONS,
  callAction,
  validateAction,
} from "../src/actions/registry.ts";
import { buildOpenApiDocument } from "../src/api/openapi.ts";
import { REST_ROUTES, validateRequested } from "../src/api/surface.ts";
import { OperationError } from "../src/operations/errors.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const OWNER = "validate-owner";

let workspaceId: string;
let memberId: string;
let spaceId: string;
let cycleId: string;

const context = async () => {
  const wb = await workerDb();
  return {
    pool: wb.appPool,
    workspaceId,
    actor: { kind: "human" as const, userId: OWNER },
  };
};

const call = async (name: string, input: unknown) =>
  callAction(await context(), name as never, input as never);

/** Rows that only a committed write leaves behind. */
const traces = async () => {
  const wb = await workerDb();
  const count = async (sql: string) =>
    Number(
      (await wb.admin.query<{ n: string }>(sql, [workspaceId])).rows[0]?.n,
    );
  return {
    goals: await count(
      "select count(*) as n from goals where workspace_id = $1",
    ),
    activities: await count(
      "select count(*) as n from activities where workspace_id = $1",
    ),
    audit: await count(
      "select count(*) as n from audit_events where workspace_id = $1",
    ),
    outbox: await count(
      "select count(*) as n from outbox where payload->>'workspaceId' = $1",
    ),
  };
};

const goalInput = () => ({
  title: "Become the platform mid-market teams reach for first",
  cycleId,
  spaceId,
  level: "team",
  ownerKind: "space",
  championId: memberId,
  reviewerId: memberId,
  weight: 1,
});

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, 'Owner', $2)",
    [OWNER, "validate-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;
  memberId = provisioned.memberId;
  const spaces = (await call("spaces.list", {})) as { id: string }[];
  spaceId = spaces[0]?.id as string;
  const current = (await call("cycles.current", { mode: "quarterly" })) as {
    id: string;
  };
  cycleId = current.id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a write checked without committing", () => {
  it("answers what the write would return, and keeps nothing", async () => {
    const before = await traces();
    const checked = await validateAction(
      await context(),
      "goals.create",
      goalInput(),
    );

    if (!checked) {
      throw new Error("goals.create has no dry run");
    }
    expect((checked.result as { id: string }).id).toMatch(/^[0-9a-f-]{36}$/);
    // The input comes back parsed, so a caller sees what it would be stored as.
    expect(checked.input).toMatchObject({ title: goalInput().title });
    expect(await traces()).toEqual(before);
  });

  it("then lets the same input commit, so the check and the write agree", async () => {
    await validateAction(await context(), "goals.create", goalInput());
    await call("goals.create", goalInput());
    expect((await traces()).goals).toBe(1);
  });

  it("refuses input the schema refuses, as the write would", async () => {
    await expect(
      validateAction(await context(), "goals.create", {
        ...goalInput(),
        title: "",
      }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("refuses what the write's own checks refuse, and keeps nothing", async () => {
    const before = await traces();
    const missing = "01a03d00-0000-7000-8000-000000000000";
    const refusal = await validateAction(await context(), "goals.create", {
      ...goalInput(),
      cycleId: missing,
    }).catch((error: unknown) => error);
    const written = await call("goals.create", {
      ...goalInput(),
      cycleId: missing,
    }).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(OperationError);
    expect(written).toBeInstanceOf(OperationError);
    expect((refusal as OperationError).code).toBe(
      (written as OperationError).code,
    );
    expect((refusal as OperationError).message).toBe(
      (written as OperationError).message,
    );
    expect(await traces()).toEqual(before);
  });

  it("is not offered for a read, nor for a write not built from one operation", async () => {
    expect(
      await validateAction(await context(), "goals.list" as never, {}),
    ).toBeNull();
    const handWritten = ACTIONS.find(
      (action) => action.safety !== "read" && !action.runsThroughPipeline,
    );
    if (handWritten) {
      expect(
        await validateAction(await context(), handWritten.name as never, {}),
      ).toBeNull();
    }
  });
});

describe("the REST parameter", () => {
  const create = REST_ROUTES.find((route) => route.action === "goals.create");
  const list = REST_ROUTES.find((route) => route.action === "goals.list");

  it("reads true and false, and refuses anything else", () => {
    if (!create) {
      throw new Error("goals.create is not routed");
    }
    const ask = (query: string) =>
      validateRequested(create, new URLSearchParams(query));
    expect(ask("")).toEqual({ kind: "ok", validate: false });
    expect(ask("validate=true")).toEqual({ kind: "ok", validate: true });
    expect(ask("validate=1")).toEqual({ kind: "ok", validate: true });
    expect(ask("validate=false")).toEqual({ kind: "ok", validate: false });
    expect(ask("validate=maybe").kind).toBe("error");
  });

  it("is marked on every write built from one operation, and documented there", () => {
    expect(create?.validatable).toBe(true);
    expect(list?.validatable).toBe(false);

    const document = buildOpenApiDocument() as {
      paths: Record<string, Record<string, { parameters?: unknown[] }>>;
      components: { parameters: Record<string, { name: string }> };
    };
    expect(document.components.parameters.Validate?.name).toBe("validate");
    expect(document.paths["/goals/create"]?.post?.parameters).toEqual([
      { $ref: "#/components/parameters/Validate" },
    ]);
    expect(
      document.paths["/goals/list"]?.get?.parameters ?? [],
    ).not.toContainEqual({ $ref: "#/components/parameters/Validate" });
  });
});
