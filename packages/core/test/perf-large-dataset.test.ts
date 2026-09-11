import { newId, withWorkspace } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { describe, expect, it } from "vitest";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import { resolveMemberAccessLevel } from "../src/access/reads.ts";
import { inTenantTransaction } from "../src/perf/bulk.ts";
import { buildLargeDataset } from "../src/perf/large-dataset.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The performance dataset (P7-T01a, TECHNICAL-PLAN §13.1).
 *
 * Built at a few dozen rows rather than at §13.1's figures: what is being
 * proved is the *shape*, and the shape does not change between twelve goals
 * and a hundred thousand. The figures themselves are a command-line argument.
 *
 * **The assertion that matters is the access one.** A seeder that wrote goals
 * and skipped their contexts and bindings would produce a workspace that looks
 * full in `count(*)` and is empty through `getAccessScoped`, so every list
 * budget measured on it would come back green while measuring nothing. That is
 * the failure this file exists to catch, and it is why the level a champion
 * resolves to is asserted rather than the number of binding rows.
 */

const SMALL = {
  spaces: 3,
  members: 5,
  cycles: 2,
  goals: 12,
  keyResults: 8,
  initiatives: 4,
  tasks: 30,
} as const;

async function emptyWorkspace(): Promise<string> {
  const wb = await workerDb();
  const userId = newId();
  await wb.appPool.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [userId, "Perf", `${userId.slice(0, 13)}@example.com`],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: userId,
    name: `Perf ${userId.slice(0, 8)}`,
  });
  return provisioned.workspaceId;
}

async function countRows(workspaceId: string, table: string): Promise<number> {
  const wb = await workerDb();
  return inTenantTransaction(wb.appPool, workspaceId, async (client) => {
    const result = await client.query<{ n: string }>(
      `select count(*)::text as n from "${table}" where workspace_id = $1 and deleted_at is null`,
      [workspaceId],
    );
    return Number(result.rows[0]?.n ?? "0");
  });
}

describe("buildLargeDataset", () => {
  it("writes the counts it was asked for, and reports them", async () => {
    const wb = await workerDb();
    const workspaceId = await emptyWorkspace();

    const report = await buildLargeDataset({
      pool: wb.appPool,
      workspaceId,
      counts: SMALL,
      batchSize: 5,
    });

    expect(await countRows(workspaceId, "goals")).toBe(SMALL.goals);
    expect(await countRows(workspaceId, "key_results")).toBe(SMALL.keyResults);
    expect(await countRows(workspaceId, "initiatives")).toBe(SMALL.initiatives);
    expect(await countRows(workspaceId, "tasks")).toBe(SMALL.tasks);
    // The report is what the command prints, so it has to agree with the
    // database rather than with the arguments it was given.
    expect(report.rows.goals).toBe(SMALL.goals);
    expect(report.rows.tasks).toBe(SMALL.tasks);
  });

  it("gives every goal a context and the four bindings a real one gets", async () => {
    const wb = await workerDb();
    const workspaceId = await emptyWorkspace();

    await buildLargeDataset({
      pool: wb.appPool,
      workspaceId,
      counts: SMALL,
      batchSize: 5,
    });

    const shape = await inTenantTransaction(
      wb.appPool,
      workspaceId,
      async (client) => {
        const contexts = await client.query<{ n: string }>(
          "select count(*)::text as n from access_contexts where workspace_id = $1 and resource_type = 'goal'",
          [workspaceId],
        );
        const orphans = await client.query<{ n: string }>(
          `select count(*)::text as n from goals g
             where g.workspace_id = $1
               and not exists (
                 select 1 from access_contexts c
                  where c.workspace_id = g.workspace_id
                    and c.resource_type = 'goal'
                    and c.resource_id = g.id)`,
          [workspaceId],
        );
        const perContext = await client.query<{ bindings: string }>(
          `select count(*)::text as bindings from access_bindings b
             join access_contexts c on c.id = b.context_id
            where b.workspace_id = $1 and c.resource_type = 'goal'
            group by b.context_id`,
          [workspaceId],
        );
        return {
          contexts: Number(contexts.rows[0]?.n ?? "0"),
          orphans: Number(orphans.rows[0]?.n ?? "0"),
          bindingCounts: perContext.rows.map((row) => Number(row.bindings)),
        };
      },
    );

    expect(shape.contexts).toBe(SMALL.goals);
    expect(shape.orphans).toBe(0);
    expect(shape.bindingCounts).toHaveLength(SMALL.goals);
    // Four each: workspace_standard view, the space edit, the champion, the
    // reviewer. Not "at least one", because three of the four are what make
    // the review inbox and the space filters return anything.
    expect(new Set(shape.bindingCounts)).toEqual(new Set([4]));
  });

  it("produces goals a seeded member can actually reach", async () => {
    const wb = await workerDb();
    const workspaceId = await emptyWorkspace();

    await buildLargeDataset({
      pool: wb.appPool,
      workspaceId,
      counts: SMALL,
      batchSize: 5,
    });

    const goal = await inTenantTransaction(
      wb.appPool,
      workspaceId,
      async (client) => {
        const result = await client.query<{
          context_id: string;
          champion_id: string;
          reviewer_id: string;
        }>(
          `select c.id as context_id, g.champion_id, g.reviewer_id
             from goals g
             join access_contexts c
               on c.resource_id = g.id and c.resource_type = 'goal'
            where g.workspace_id = $1
            limit 1`,
          [workspaceId],
        );
        return result.rows[0];
      },
    );
    if (!goal) {
      throw new Error("The dataset wrote no goals.");
    }

    // Resolved through the product's own function, not through a query this
    // test wrote. A binding row that exists but does not resolve is exactly
    // the bug worth catching, and only this call can see it. `withWorkspace`
    // rather than an Operation, because nothing here writes and an Operation
    // owes an activity row it would have nothing to say in.
    const levels = await withWorkspace(wb.db, workspaceId, async (tx) => ({
      champion: await resolveMemberAccessLevel(tx, {
        workspaceId,
        memberId: goal.champion_id,
        contextId: goal.context_id,
      }),
      reviewer: await resolveMemberAccessLevel(tx, {
        workspaceId,
        memberId: goal.reviewer_id,
        contextId: goal.context_id,
      }),
    }));

    expect(levels.champion).toBe(ACCESS_LEVELS.full);
    expect(levels.reviewer).toBeGreaterThanOrEqual(ACCESS_LEVELS.edit);
  });

  it("refuses a workspace that already holds goals", async () => {
    const wb = await workerDb();
    const workspaceId = await emptyWorkspace();

    await buildLargeDataset({
      pool: wb.appPool,
      workspaceId,
      counts: SMALL,
      batchSize: 5,
    });

    // Not idempotent and does not pretend to be: a second run would double
    // the dataset and every number measured against it would be measuring
    // something else.
    await expect(
      buildLargeDataset({
        pool: wb.appPool,
        workspaceId,
        counts: SMALL,
        batchSize: 5,
      }),
    ).rejects.toThrow(/already holds/);

    expect(await countRows(workspaceId, "goals")).toBe(SMALL.goals);
  });

  it("refuses a production instance, and refuses it before touching anything", async () => {
    const wb = await workerDb();
    const workspaceId = await emptyWorkspace();
    // Three: the person who registered, and the Coach and the Champion, which
    // ship with every workspace. Read rather than assumed, so this stays true
    // if provisioning grows another one.
    const membersBefore = await countRows(workspaceId, "workspace_members");

    await expect(
      buildLargeDataset({
        pool: wb.appPool,
        workspaceId,
        counts: SMALL,
        batchSize: 5,
        nodeEnv: "production",
      }),
    ).rejects.toThrow(/refused on a production instance/);

    // Before touching anything, not partway through: the check is the first
    // line of the builder, so a refused run leaves no half-dataset behind.
    expect(await countRows(workspaceId, "goals")).toBe(0);
    expect(await countRows(workspaceId, "workspace_members")).toBe(
      membersBefore,
    );
  });

  it("spreads its keys over time rather than stamping them all now", async () => {
    const wb = await workerDb();
    const workspaceId = await emptyWorkspace();

    await buildLargeDataset({
      pool: wb.appPool,
      workspaceId,
      counts: SMALL,
      batchSize: 5,
      spreadDays: 200,
    });

    const span = await inTenantTransaction(
      wb.appPool,
      workspaceId,
      async (client) => {
        const result = await client.query<{ days: string }>(
          "select extract(epoch from (max(created_at) - min(created_at))) / 86400 as days from tasks where workspace_id = $1",
          [workspaceId],
        );
        return Number(result.rows[0]?.days ?? "0");
      },
    );

    // Index locality is the whole reason for a time-ordered key. A dataset
    // written inside one second measures a B-tree production never has.
    expect(span).toBeGreaterThan(100);
  });
});
