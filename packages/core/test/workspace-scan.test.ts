import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createWorkspace } from "../src/workspaces/provisioning.ts";
import { listLiveWorkspaces } from "../src/workspaces/scan.ts";

/**
 * The scheduler's list of tenants, read as the restricted application role
 * (completeness review H-02).
 *
 * The scheduler used to list workspaces with a bare pool query. That returned
 * every workspace on the Compose install, which connected as a superuser, and
 * none at all under the application role this suite connects as. So a
 * scheduler on a correctly configured instance would have started and then run
 * for nobody, and nothing would have said so.
 */

const user = async (id: string) => {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [id, `Person ${id}`, `${id}@example.com`],
  );
  return { id, name: `Person ${id}` };
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("listLiveWorkspaces", () => {
  it("finds every workspace under the application role", async () => {
    const wb = await workerDb();
    const first = await createWorkspace(wb.appPool, {
      user: await user("scan-1"),
    });
    const second = await createWorkspace(wb.appPool, {
      user: await user("scan-2"),
    });

    // The bare query the scheduler used to run, as proof of the defect.
    const bare = await wb.appPool.query("select id from workspaces");
    expect(bare.rows).toEqual([]);

    const listed = await listLiveWorkspaces(wb.appPool);
    expect(listed.map((row) => row.id).sort()).toEqual(
      [first.workspaceId, second.workspaceId].sort(),
    );
    for (const row of listed) {
      expect(row.slug).toBeTruthy();
      expect(row.timezone).toBeTruthy();
    }
  });

  it("leaves out a workspace that was deleted", async () => {
    const wb = await workerDb();
    const kept = await createWorkspace(wb.appPool, {
      user: await user("scan-3"),
    });
    const gone = await createWorkspace(wb.appPool, {
      user: await user("scan-4"),
    });
    await wb.admin.query(
      "update workspaces set deleted_at = now() where id = $1",
      [gone.workspaceId],
    );

    const listed = await listLiveWorkspaces(wb.appPool);
    expect(listed.map((row) => row.id)).toEqual([kept.workspaceId]);
  });
});
