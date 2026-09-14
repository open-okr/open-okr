import { newId } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { describe, expect, it } from "vitest";
import { bulkInsert, inTenantTransaction } from "../src/perf/bulk.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The batched insert the performance dataset is built with (P7-T01a).
 *
 * Three things are worth proving about it, and only the first is obvious.
 * It has to write every row when the count crosses a batch boundary, because
 * an off-by-one in the loop would produce a dataset quietly short of the
 * figure the budget table names. It has to write *through* row-level security
 * rather than around it, because a seeder that reached past the tenant floor
 * would be the one program here proving nothing about whether the floor
 * works. And its transaction has to leave nothing behind on the pooled
 * connection, because the next caller to borrow it would inherit another
 * workspace's tenant setting.
 */

async function newWorkspace(): Promise<{ workspaceId: string }> {
  const wb = await workerDb();
  const userId = newId();
  // `users` sits outside the tenant floor and `workspace_members` has a
  // foreign key into it, so the person exists before the workspace does.
  await wb.appPool.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [userId, "Bulk", `${userId.slice(0, 13)}@example.com`],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: userId,
    name: `Bulk ${userId.slice(0, 8)}`,
  });
  return { workspaceId: provisioned.workspaceId };
}

const CONTEXT_COLUMNS = [
  { name: "id", type: "uuid" },
  { name: "workspace_id", type: "uuid" },
  { name: "resource_type", type: "text" },
  { name: "resource_id", type: "uuid" },
] as const;

function contextRows(workspaceId: string, count: number) {
  return Array.from({ length: count }, () => [
    newId(),
    workspaceId,
    "goal",
    newId(),
  ]);
}

async function countContexts(
  workspaceId: string,
  resourceType: string,
): Promise<number> {
  const wb = await workerDb();
  return inTenantTransaction(wb.appPool, workspaceId, async (client) => {
    const result = await client.query<{ n: string }>(
      "select count(*)::text as n from access_contexts where workspace_id = $1 and resource_type = $2",
      [workspaceId, resourceType],
    );
    return Number(result.rows[0]?.n ?? "0");
  });
}

describe("bulkInsert", () => {
  it("writes every row when the count crosses several batches", async () => {
    const wb = await workerDb();
    const { workspaceId } = await newWorkspace();
    const before = await countContexts(workspaceId, "goal");

    // 250 rows at a batch of 100 is three statements, the last one short.
    // A loop that dropped the remainder, or one that re-sent the first
    // batch, both fail here and fail differently.
    const written = await inTenantTransaction(
      wb.appPool,
      workspaceId,
      (client) =>
        bulkInsert(
          client,
          "access_contexts",
          CONTEXT_COLUMNS,
          contextRows(workspaceId, 250),
          100,
        ),
    );

    expect(written).toBe(250);
    expect(await countContexts(workspaceId, "goal")).toBe(before + 250);
  });

  it("writes nothing, and asks nothing of the server, for an empty list", async () => {
    const wb = await workerDb();
    const { workspaceId } = await newWorkspace();

    const written = await inTenantTransaction(
      wb.appPool,
      workspaceId,
      (client) => bulkInsert(client, "access_contexts", CONTEXT_COLUMNS, []),
    );

    expect(written).toBe(0);
  });

  it("is refused by the tenant floor when the rows name another workspace", async () => {
    const wb = await workerDb();
    const mine = await newWorkspace();
    const theirs = await newWorkspace();

    // The setting says one workspace and the rows say another. Forced
    // row-level security is what has to refuse this, not the seeder's own
    // good manners.
    await expect(
      inTenantTransaction(wb.appPool, mine.workspaceId, (client) =>
        bulkInsert(
          client,
          "access_contexts",
          CONTEXT_COLUMNS,
          contextRows(theirs.workspaceId, 5),
        ),
      ),
    ).rejects.toThrow();

    expect(await countContexts(theirs.workspaceId, "goal")).toBe(0);
  });
});

describe("inTenantTransaction", () => {
  it("rolls back the whole batch when the body throws", async () => {
    const wb = await workerDb();
    const { workspaceId } = await newWorkspace();

    await expect(
      inTenantTransaction(wb.appPool, workspaceId, async (client) => {
        await bulkInsert(
          client,
          "access_contexts",
          CONTEXT_COLUMNS,
          contextRows(workspaceId, 10),
        );
        throw new Error("deliberate");
      }),
    ).rejects.toThrow("deliberate");

    expect(await countContexts(workspaceId, "goal")).toBe(0);
  });

  it("leaves no tenant setting on the connection it borrowed", async () => {
    const wb = await workerDb();
    const { workspaceId } = await newWorkspace();

    await inTenantTransaction(wb.appPool, workspaceId, async (client) => {
      const inside = await client.query<{ value: string }>(
        "select current_setting('app.workspace_id', true) as value",
      );
      expect(inside.rows[0]?.value).toBe(workspaceId);
    });

    // `SET LOCAL` dies with the transaction. Were it a plain `SET`, the next
    // borrower of this pooled connection would inherit the workspace and read
    // somebody else's rows through a policy that thought it was theirs.
    const client = await wb.appPool.connect();
    try {
      const after = await client.query<{ value: string | null }>(
        "select current_setting('app.workspace_id', true) as value",
      );
      expect(after.rows[0]?.value ?? "").not.toBe(workspaceId);
    } finally {
      client.release();
    }
  });
});
