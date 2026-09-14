import { newId, withWorkspace } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { beforeAll, describe, expect, it } from "vitest";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import { getAccessScoped, visibleResourceIds } from "../src/access/reads.ts";
import { OperationError } from "../src/operations/errors.ts";
import { inTenantTransaction } from "../src/perf/bulk.ts";
import { buildLargeDataset } from "../src/perf/large-dataset.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The set-shaped access filter (P7-T01b).
 *
 * **The only thing worth testing here is that it agrees with the getter.** It
 * exists to replace a per-row `getAccessScoped` loop in three list actions, so
 * a difference between the two is a permission change smuggled in as a
 * performance fix. Every case below computes the answer both ways and compares
 * them, rather than asserting a set this file worked out for itself.
 */

let workspaceId: string;
let goalIds: string[];
let championId: string;
let strangerId: string;

beforeAll(async () => {
  const wb = await workerDb();
  const userId = newId();
  await wb.appPool.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [userId, "Visible", `${userId.slice(0, 13)}@example.com`],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: userId,
    name: `Visible ${userId.slice(0, 8)}`,
  });
  workspaceId = provisioned.workspaceId;
  await buildLargeDataset({
    pool: wb.appPool,
    workspaceId,
    counts: {
      spaces: 3,
      members: 6,
      cycles: 2,
      goals: 12,
      keyResults: 6,
      initiatives: 3,
      tasks: 10,
    },
    batchSize: 20,
    nodeEnv: "test",
  });

  const rows = await inTenantTransaction(
    wb.appPool,
    workspaceId,
    async (client) => {
      const goals = await client.query<{ id: string; champion_id: string }>(
        "select id, champion_id from goals where workspace_id = $1 order by created_at",
        [workspaceId],
      );
      // A member the seeder made but who champions nothing in this sample.
      const stranger = await client.query<{ id: string }>(
        `select id from workspace_members
          where workspace_id = $1 and kind = 'human' and deleted_at is null
            and id <> all($2::uuid[])
          limit 1`,
        [workspaceId, goals.rows.map((row) => row.champion_id)],
      );
      return { goals: goals.rows, stranger: stranger.rows[0]?.id };
    },
  );
  goalIds = rows.goals.map((row) => row.id);
  championId = rows.goals[0]?.champion_id as string;
  strangerId = rows.stranger ?? championId;
});

/** The same answer, computed the slow way the list actions used to. */
async function throughTheGetter(
  memberId: string,
  ids: readonly string[],
  requires: number,
): Promise<Set<string>> {
  const wb = await workerDb();
  return withWorkspace(wb.db, workspaceId, async (tx) => {
    const visible = new Set<string>();
    for (const id of ids) {
      try {
        await getAccessScoped(tx, {
          workspaceId,
          memberId,
          resourceType: "goal",
          resourceId: id,
          requires: requires as never,
        });
        visible.add(id);
      } catch (error) {
        if (error instanceof OperationError && error.code === "not_found") {
          continue;
        }
        throw error;
      }
    }
    return visible;
  });
}

async function throughTheSet(
  memberId: string,
  ids: readonly string[],
  requires: number,
): Promise<Set<string>> {
  const wb = await workerDb();
  return withWorkspace(wb.db, workspaceId, (tx) =>
    visibleResourceIds(tx, {
      workspaceId,
      memberId,
      resourceType: "goal",
      ids,
      requires,
    }),
  );
}

describe("visibleResourceIds agrees with getAccessScoped", () => {
  it("at view, where the workspace tier makes everything visible", async () => {
    const slow = await throughTheGetter(
      championId,
      goalIds,
      ACCESS_LEVELS.view,
    );
    const fast = await throughTheSet(championId, goalIds, ACCESS_LEVELS.view);
    expect([...fast].sort()).toEqual([...slow].sort());
    expect(fast.size).toBe(goalIds.length);
  });

  it("at full, where only the champion's own goals survive", async () => {
    // The level that separates them: `workspace_standard` gives view to every
    // goal and `full` only to the ones this member champions. A filter that
    // ignored the level would return all twelve here.
    const slow = await throughTheGetter(
      championId,
      goalIds,
      ACCESS_LEVELS.full,
    );
    const fast = await throughTheSet(championId, goalIds, ACCESS_LEVELS.full);
    expect([...fast].sort()).toEqual([...slow].sort());
    expect(fast.size).toBeGreaterThan(0);
    expect(fast.size).toBeLessThan(goalIds.length);
  });

  it("for a member who champions none of them", async () => {
    const slow = await throughTheGetter(
      strangerId,
      goalIds,
      ACCESS_LEVELS.full,
    );
    const fast = await throughTheSet(strangerId, goalIds, ACCESS_LEVELS.full);
    expect([...fast].sort()).toEqual([...slow].sort());
  });

  it("for ids that have no context at all", async () => {
    // The set-shaped form of the getter's not-found: absent from the answer
    // rather than raising.
    const strangers = [newId(), newId()];
    const slow = await throughTheGetter(
      championId,
      strangers,
      ACCESS_LEVELS.view,
    );
    const fast = await throughTheSet(championId, strangers, ACCESS_LEVELS.view);
    expect(fast.size).toBe(0);
    expect(slow.size).toBe(0);
  });

  it("for a member who is not in the workspace", async () => {
    const nobody = newId();
    const slow = await throughTheGetter(nobody, goalIds, ACCESS_LEVELS.view);
    const fast = await throughTheSet(nobody, goalIds, ACCESS_LEVELS.view);
    expect(fast.size).toBe(0);
    expect(slow.size).toBe(0);
  });

  it("asks nothing of the server for an empty list", async () => {
    const fast = await throughTheSet(championId, [], ACCESS_LEVELS.view);
    expect(fast.size).toBe(0);
  });
});
