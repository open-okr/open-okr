import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { runEmbedJob } from "../src/embeddings/worker.ts";
import { dispatchTool } from "../src/index.ts";
import { runIndexJob } from "../src/search/worker.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The two research tools (AI-NATIVE-PLAN.md §8.3, P5-T09c).
 *
 * Acceptance criterion:
 *   Given two workspaces with similar goals, when an agent in one searches for
 *   the other's wording, then nothing from the other workspace appears in any
 *   result.
 *
 * **Two workspaces live here rather than in the end-to-end spec, and that is a
 * stated deviation from the task's test plan.** The plan asked one live run to
 * prove both the under-privileged denial and the absence of cross-tenant data.
 * The end-to-end harness registers one instance account, so a second workspace
 * there is setup code that exists for one assertion. The denial is proved over
 * the real transport in `e2e/s41-mcp-transport.spec.ts`, where only a transport
 * can prove it; the cross-tenant claim is proved here, against a real database,
 * where a second workspace costs three lines. Agung chose the split on 2
 * September 2026.
 *
 * **A member outside a space is not a refusal in this product, so no test
 * pretends it is.** P3-T01's `workspace_standard` binding gives every active
 * member `edit` across the workspace, which is why `embeddings-retrieval.test.ts`
 * proves its access filter through suspension. This file follows it.
 */

const OWNER_A = "research-owner-a";
const OWNER_B = "research-owner-b";
const READER_A = "research-reader-a";

/** The wording both workspaces share, so a leak would be a hit rather than luck. */
const SHARED_WORDING = "mid-market activation";

let workspaceA: string;
let workspaceB: string;
let memberA: string;
let readerMemberA: string;
let memberB: string;
let goalA: string;
let goalB: string;
let keyResultA: string;

const call = async (
  workspaceId: string,
  name: string,
  input: unknown,
  userId: string,
) => {
  const wb = await workerDb();
  return callAction(
    {
      pool: wb.appPool,
      workspaceId,
      actor: { kind: "human" as const, userId },
    },
    name as never,
    input as never,
  );
};

/**
 * Indexes one entity the way the relay would: read the job, run the worker.
 *
 * **Both indexes, because the two tools read different ones.** `search`
 * answers from the full-text index P5-T13 filled, and `fetch` reads the
 * passage the embedding worker stored. One write enqueues an outbox row for
 * each in the real product, and a test that ran only one worker would prove a
 * tool against a store nothing had written. That is exactly what happened
 * between P5-T09c and P5-T13.
 */
const indexEntity = async (
  workspaceId: string,
  entityType: string,
  entityId: string,
) => {
  const wb = await workerDb();
  await runEmbedJob(
    { workspaceId, entityType, entityId },
    { pool: wb.appPool, embed: null },
  );
  return runIndexJob(
    { workspaceId, entityType, entityId },
    { pool: wb.appPool },
  );
};

const run = async (
  name: string,
  input: Record<string, unknown>,
  over: {
    readonly workspaceId?: string;
    readonly userId?: string;
    readonly scopes?: readonly string[];
    readonly instanceUrl?: string;
  } = {},
) => {
  const wb = await workerDb();
  return dispatchTool(
    wb.appPool,
    {
      workspaceId: over.workspaceId ?? workspaceA,
      userId: over.userId ?? OWNER_A,
      scopes: over.scopes ?? ["read"],
      ...(over.instanceUrl ? { instanceUrl: over.instanceUrl } : {}),
    },
    name,
    input,
  );
};

const parsed = (text: string) => JSON.parse(text) as Record<string, unknown>;

/** One workspace with a goal, a key result and both of them indexed. */
async function setUpWorkspace(
  userId: string,
  name: string,
  goalTitle: string,
): Promise<{ workspaceId: string; memberId: string; goalId: string }> {
  const wb = await workerDb();
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: userId,
    name,
  });
  const workspaceId = provisioned.workspaceId;
  const memberId = provisioned.memberId;

  const spaces = (await call(workspaceId, "spaces.list", {}, userId)) as {
    id: string;
  }[];
  const spaceId = spaces[0]?.id as string;
  const cycle = (await call(
    workspaceId,
    "cycles.current",
    { mode: "quarterly" },
    userId,
  )) as { id: string };

  const goal = (await call(
    workspaceId,
    "goals.create",
    {
      title: goalTitle,
      cycleId: cycle.id,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: memberId,
      reviewerId: memberId,
      weight: 1,
    },
    userId,
  )) as { id: string };
  await indexEntity(workspaceId, "goal", goal.id);

  return { workspaceId, memberId, goalId: goal.id };
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    `insert into users (id, name, email)
     values ($1, 'Ada', $2), ($3, 'Bo', $4), ($5, 'Cass', $6)`,
    [
      OWNER_A,
      "research-owner-a@example.com",
      OWNER_B,
      "research-owner-b@example.com",
      READER_A,
      "research-reader-a@example.com",
    ],
  );

  const a = await setUpWorkspace(
    OWNER_A,
    "Ada",
    `Raise ${SHARED_WORDING} to sixty per cent`,
  );
  workspaceA = a.workspaceId;
  memberA = a.memberId;
  goalA = a.goalId;

  const b = await setUpWorkspace(
    OWNER_B,
    "Bo",
    `Raise ${SHARED_WORDING} across the enterprise`,
  );
  workspaceB = b.workspaceId;
  memberB = b.memberId;
  goalB = b.goalId;

  const keyResult = (await call(
    workspaceA,
    "goals.addKeyResult",
    {
      goalId: goalA,
      title: `Weekly ${SHARED_WORDING} rate reaches sixty per cent`,
      direction: "increase",
      indicatorType: "leading",
      baselineValue: 20,
      targetValue: 60,
      unit: "percent",
      weight: 1,
    },
    OWNER_A,
  )) as { id: string };
  keyResultA = keyResult.id;
  await indexEntity(workspaceA, "key_result", keyResultA);

  const reader = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Cass', 'active') returning id`,
    [workspaceA, READER_A],
  );
  readerMemberA = reader.rows[0]?.id as string;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("search, through the same access layer as every other read", () => {
  it("finds what the caller may read, with an address fetch resolves", async () => {
    const outcome = await run("search", { query: SHARED_WORDING });

    expect(outcome.isError).toBe(false);
    const results = parsed(outcome.text).results as Record<string, unknown>[];
    expect(results.length).toBeGreaterThan(0);
    const goalHit = results.find((hit) => hit.id === goalA);
    expect(goalHit).toBeDefined();
    expect(goalHit?.entityType).toBe("goal");
    // A goal has a page, so its address is the one somebody opens. With no
    // instance URL to hand it is the path, which is still an address `fetch`
    // resolves.
    expect(goalHit?.url).toBe(`/goals/${goalA}`);
    expect(String(goalHit?.title)).toContain("sixty per cent");

    const fetched = await run("fetch", { url: String(goalHit?.url) });
    expect(parsed(fetched.text).id).toBe(goalA);
  });

  it("acceptance: nothing from another workspace appears, however alike the wording", async () => {
    const outcome = await run("search", { query: SHARED_WORDING });

    expect(outcome.isError).toBe(false);
    // The whole response, not only the identifiers: an excerpt or a title that
    // leaked the other workspace's wording would be just as much a leak.
    expect(outcome.text).not.toContain(goalB);
    expect(outcome.text).not.toContain(workspaceB);
    expect(outcome.text).not.toContain(memberB);
    expect(outcome.text).toContain(goalA);
  });

  it("gives a suspended member nothing, though the chunk is still indexed", async () => {
    const wb = await workerDb();
    const before = await run("search", {
      query: SHARED_WORDING,
      entityTypes: ["goal"],
    });
    expect((parsed(before.text).results as unknown[]).length).toBe(1);

    await wb.admin.query(
      "update workspace_members set status = 'suspended' where id = $1",
      [memberA],
    );

    const after = await run("search", { query: SHARED_WORDING });
    expect(after.isError).toBe(true);
    expect(after.text).not.toContain(goalA);
  });

  it("narrows to the entity types the caller asked for", async () => {
    const outcome = await run("search", {
      query: SHARED_WORDING,
      entityTypes: ["key_result"],
    });

    const results = parsed(outcome.text).results as Record<string, unknown>[];
    expect(results.map((hit) => hit.id)).toEqual([keyResultA]);
    expect(results[0]?.url).toBe(`openokr://key-result/${keyResultA}`);
  });

  it("answers a member of the other workspace with only their own", async () => {
    const outcome = await run(
      "search",
      { query: SHARED_WORDING },
      {
        workspaceId: workspaceB,
        userId: OWNER_B,
      },
    );

    expect(outcome.text).toContain(goalB);
    expect(outcome.text).not.toContain(goalA);
  });

  it("needs read scope, and says so", async () => {
    const outcome = await run(
      "search",
      { query: SHARED_WORDING },
      {
        scopes: [],
      },
    );
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain("search needs read");
  });

  it("never throws on an input the schema refuses", async () => {
    await expect(run("search", { query: "" })).resolves.toEqual({
      text: "That call could not be completed.",
      isError: true,
    });
  });
});

describe("fetch, which turns an address into content with a citation", () => {
  it("resolves a browser path", async () => {
    const outcome = await run("fetch", { url: `/goals/${goalA}` });

    expect(outcome.isError).toBe(false);
    const body = parsed(outcome.text);
    expect(body.id).toBe(goalA);
    expect(body.entityType).toBe("goal");
    expect(String(body.title)).toContain("sixty per cent");
    // The structured content is the read action's own answer, not a second
    // shape assembled here.
    expect((body.structured as Record<string, unknown>).id).toBe(goalA);
  });

  it("resolves the openokr address for the same thing", async () => {
    const outcome = await run("fetch", { url: `openokr://goal/${goalA}` });
    expect(parsed(outcome.text).id).toBe(goalA);
  });

  it("resolves an absolute instance URL", async () => {
    const outcome = await run("fetch", {
      url: `https://okr.example/goals/${goalA}?tab=history`,
    });
    expect(parsed(outcome.text).id).toBe(goalA);
  });

  it("carries the citation an agent quotes, with the instance in the URL", async () => {
    const outcome = await run(
      "fetch",
      { url: `openokr://goal/${goalA}` },
      {
        instanceUrl: "https://okr.example/",
      },
    );
    expect(parsed(outcome.text).url).toBe(`https://okr.example/goals/${goalA}`);
  });

  it("reads an embeddable thing that has no page of its own", async () => {
    const outcome = await run("fetch", {
      url: `openokr://key-result/${keyResultA}`,
    });

    expect(outcome.isError).toBe(false);
    const body = parsed(outcome.text);
    expect(body.id).toBe(keyResultA);
    expect(body.entityType).toBe("key_result");
    expect(String(body.text)).toContain("sixty per cent");
    expect(body.structured).toBeNull();
  });

  it("answers not-found for an address in another workspace", async () => {
    const foreign = await run("fetch", { url: `/goals/${goalB}` });
    const missing = await run("fetch", {
      url: "/goals/00000000-0000-4000-8000-000000000000",
    });

    expect(foreign.isError).toBe(true);
    expect(foreign.text).not.toContain(workspaceB);
    // The browser's own sentence, unchanged, so a probe cannot tell a goal in
    // somebody else's workspace from a goal that was never there.
    expect(foreign.text).toBe(missing.text);
  });

  it("answers a key result in another workspace exactly as it answers a missing one", async () => {
    const other = (await call(
      workspaceB,
      "goals.addKeyResult",
      {
        goalId: goalB,
        title: `Weekly ${SHARED_WORDING} rate reaches eighty per cent`,
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 20,
        targetValue: 80,
        unit: "percent",
        weight: 1,
      },
      OWNER_B,
    )) as { id: string };

    const foreign = await run("fetch", {
      url: `openokr://key-result/${other.id}`,
    });
    const missing = await run("fetch", {
      url: "openokr://key-result/00000000-0000-4000-8000-000000000000",
    });

    expect(foreign.isError).toBe(true);
    expect(foreign.text).toBe(missing.text);
  });

  it("answers not-found for an address it does not know", async () => {
    const outcome = await run("fetch", { url: "/invoices/42" });
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain("/invoices/42");
  });

  it("answers not-found for an address whose identifier is not one", async () => {
    const outcome = await run("fetch", { url: "openokr://goal/not-a-uuid" });
    expect(outcome.isError).toBe(true);
  });

  it("gives a member who is not in this workspace nothing", async () => {
    const outcome = await run(
      "fetch",
      { url: `/goals/${goalA}` },
      {
        userId: READER_A,
        workspaceId: workspaceB,
      },
    );
    expect(outcome.isError).toBe(true);
    expect(readerMemberA.length).toBeGreaterThan(0);
  });

  it("needs read scope, and says so", async () => {
    const outcome = await run(
      "fetch",
      { url: `/goals/${goalA}` },
      {
        scopes: [],
      },
    );
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain("fetch needs read");
  });
});
