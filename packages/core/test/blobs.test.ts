import { withWorkspace } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import {
  discardOrphanedBlob,
  findOrphanedBlobs,
} from "../src/blobs/provisioning.ts";
import { MAX_BLOB_BYTES } from "../src/blobs/validation.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Files and blobs (P2-T05 test plan, TECHNICAL-PLAN §4.9).
 *
 * Upload, claim and read back. Oversized and blocked types are rejected.
 * Crossing the quota fires exactly one warning, with a hard stop only at the
 * quota itself. Orphans are reaped.
 */

const OWNER = "blobs-owner";

let workspaceId: string;

const context = () => ({
  workspaceId,
  actor: { kind: "human" as const, userId: OWNER },
});

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Blobs Owner", "blobs-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Blobs Owner",
  });
  workspaceId = provisioned.workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

async function setQuota(bytes: number) {
  const wb = await workerDb();
  await wb.admin.query(
    `update workspaces set settings = jsonb_set(settings, '{storageQuotaBytes}', $2::jsonb) where id = $1`,
    [workspaceId, JSON.stringify(bytes)],
  );
}

describe("prepare, upload, claim", () => {
  it("prepares, claims, and the row is readable back with its content type", async () => {
    const wb = await workerDb();
    const prepared = await callAction(
      { pool: wb.appPool, ...context() },
      "blobs.prepareUpload",
      {
        filename: "report.pdf",
        contentType: "application/pdf",
        declaredSize: 1000,
      },
    );
    expect(prepared.storageKey).toContain(workspaceId);

    const claimed = await callAction(
      { pool: wb.appPool, ...context() },
      "blobs.claimUpload",
      {
        blobId: prepared.blobId,
        actualSize: 1000,
        digest: "abc123",
      },
    );
    expect(claimed.status).toBe("ok");

    const downloaded = await callAction(
      { pool: wb.appPool, ...context() },
      "blobs.getForDownload",
      { blobId: prepared.blobId },
    );
    expect(downloaded.storageKey).toBe(prepared.storageKey);
    expect(downloaded.contentType).toBe("application/pdf");
    expect(downloaded.filename).toBe("report.pdf");
  });

  it("rejects a blocked content type", async () => {
    const wb = await workerDb();
    await expect(
      callAction({ pool: wb.appPool, ...context() }, "blobs.prepareUpload", {
        filename: "script.exe",
        contentType: "application/x-msdownload",
        declaredSize: 1000,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("rejects a file over the size ceiling", async () => {
    const wb = await workerDb();
    await expect(
      callAction({ pool: wb.appPool, ...context() }, "blobs.prepareUpload", {
        filename: "huge.pdf",
        contentType: "application/pdf",
        declaredSize: MAX_BLOB_BYTES + 1,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("only the uploader (or a member with access) can read a blob back", async () => {
    const wb = await workerDb();
    const prepared = await callAction(
      { pool: wb.appPool, ...context() },
      "blobs.prepareUpload",
      { filename: "a.pdf", contentType: "application/pdf", declaredSize: 10 },
    );
    await callAction({ pool: wb.appPool, ...context() }, "blobs.claimUpload", {
      blobId: prepared.blobId,
      actualSize: 10,
      digest: "x",
    });

    await wb.admin.query(
      "insert into users (id, name, email) values ($1, $2, $3)",
      ["stranger", "Stranger", "stranger@example.com"],
    );
    await wb.admin.query(
      `insert into workspace_members (id, workspace_id, name, kind, status)
       values (gen_random_uuid(), $1, 'Stranger', 'human', 'active')`,
      [workspaceId],
    );
    // No user_id link for the stranger's member row, so getForDownload
    // cannot resolve a member for them at all — not-found either way.
    await expect(
      callAction(
        {
          pool: wb.appPool,
          workspaceId,
          actor: { kind: "human", userId: "stranger" },
        },
        "blobs.getForDownload",
        { blobId: prepared.blobId },
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("the storage quota", () => {
  it("fires exactly one warning on the upload that crosses ninety percent", async () => {
    const wb = await workerDb();
    await setQuota(1000);

    // 85%: no warning yet.
    const first = await callAction(
      { pool: wb.appPool, ...context() },
      "blobs.prepareUpload",
      { filename: "a.pdf", contentType: "application/pdf", declaredSize: 850 },
    );
    const firstClaim = await callAction(
      { pool: wb.appPool, ...context() },
      "blobs.claimUpload",
      { blobId: first.blobId, actualSize: 850, digest: "a" },
    );
    expect(firstClaim.warningCrossed).toBe(false);

    // Crosses to 95%: warns once.
    const second = await callAction(
      { pool: wb.appPool, ...context() },
      "blobs.prepareUpload",
      { filename: "b.pdf", contentType: "application/pdf", declaredSize: 100 },
    );
    const secondClaim = await callAction(
      { pool: wb.appPool, ...context() },
      "blobs.claimUpload",
      { blobId: second.blobId, actualSize: 100, digest: "b" },
    );
    expect(secondClaim.warningCrossed).toBe(true);

    // A further small upload, still under the quota, does not warn again.
    const third = await callAction(
      { pool: wb.appPool, ...context() },
      "blobs.prepareUpload",
      { filename: "c.pdf", contentType: "application/pdf", declaredSize: 10 },
    );
    const thirdClaim = await callAction(
      { pool: wb.appPool, ...context() },
      "blobs.claimUpload",
      { blobId: third.blobId, actualSize: 10, digest: "c" },
    );
    expect(thirdClaim.warningCrossed).toBe(false);
  });

  it("stops hard only once the upload itself would exceed the quota", async () => {
    const wb = await workerDb();
    await setQuota(1000);

    await expect(
      callAction({ pool: wb.appPool, ...context() }, "blobs.prepareUpload", {
        filename: "toobig.pdf",
        contentType: "application/pdf",
        declaredSize: 1001,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });

    // Exactly at the quota is allowed; it is "exceeds", not "reaches", that stops.
    const atLimit = await callAction(
      { pool: wb.appPool, ...context() },
      "blobs.prepareUpload",
      {
        filename: "exact.pdf",
        contentType: "application/pdf",
        declaredSize: 1000,
      },
    );
    await expect(
      callAction({ pool: wb.appPool, ...context() }, "blobs.claimUpload", {
        blobId: atLimit.blobId,
        actualSize: 1000,
        digest: "d",
      }),
    ).resolves.toMatchObject({ status: "ok" });
  });
});

describe("orphan cleanup", () => {
  it("finds a pending upload past its age cutoff, and discarding removes it from later scans", async () => {
    const wb = await workerDb();
    const prepared = await callAction(
      { pool: wb.appPool, ...context() },
      "blobs.prepareUpload",
      {
        filename: "abandoned.pdf",
        contentType: "application/pdf",
        declaredSize: 10,
      },
    );

    await wb.admin.query(
      "update blobs set created_at = now() - interval '2 hours' where id = $1",
      [prepared.blobId],
    );

    const db = drizzle(wb.appPool);
    const orphans = await withWorkspace(db, workspaceId, (tx) =>
      findOrphanedBlobs(tx, workspaceId, 60),
    );
    expect(orphans.map((o) => o.id)).toContain(prepared.blobId);

    await withWorkspace(db, workspaceId, (tx) =>
      discardOrphanedBlob(tx, workspaceId, prepared.blobId),
    );

    const rows = await wb.admin.query(
      "select deleted_at from blobs where id = $1",
      [prepared.blobId],
    );
    expect(rows.rows[0].deleted_at).not.toBeNull();

    const afterDiscard = await withWorkspace(db, workspaceId, (tx) =>
      findOrphanedBlobs(tx, workspaceId, 60),
    );
    expect(afterDiscard.map((o) => o.id)).not.toContain(prepared.blobId);
  });

  it("does not flag a recent pending upload as an orphan", async () => {
    const wb = await workerDb();
    const prepared = await callAction(
      { pool: wb.appPool, ...context() },
      "blobs.prepareUpload",
      {
        filename: "fresh.pdf",
        contentType: "application/pdf",
        declaredSize: 10,
      },
    );

    const db = drizzle(wb.appPool);
    const orphans = await withWorkspace(db, workspaceId, (tx) =>
      findOrphanedBlobs(tx, workspaceId, 60),
    );
    expect(orphans.map((o) => o.id)).not.toContain(prepared.blobId);
  });
});

describe("blobs.reapOrphans (P6-G01c)", () => {
  /** A storage port that records what it was asked to remove. */
  function recordingStorage() {
    const deleted: string[] = [];
    return {
      deleted,
      port: {
        get: async () => Buffer.alloc(0),
        delete: async (key: string) => {
          deleted.push(key);
        },
      },
    };
  }

  async function prepare(filename: string): Promise<string> {
    const wb = await workerDb();
    const prepared = await callAction(
      { pool: wb.appPool, ...context() },
      "blobs.prepareUpload",
      { filename, contentType: "application/pdf", declaredSize: 10 },
    );
    return prepared.blobId;
  }

  it("takes the bytes with the row", async () => {
    const wb = await workerDb();
    const storage = recordingStorage();
    const blobId = await prepare("abandoned.pdf");
    const key = (
      await wb.admin.query("select storage_key from blobs where id = $1", [
        blobId,
      ])
    ).rows[0].storage_key as string;

    await wb.admin.query(
      "update blobs set created_at = now() - interval '2 days' where id = $1",
      [blobId],
    );

    const result = await callAction(
      { pool: wb.appPool, ...context(), storage: storage.port },
      "blobs.reapOrphans",
      {},
    );

    expect(result).toEqual({ discarded: 1, bytesLeft: 0 });
    expect(storage.deleted).toEqual([key]);

    const row = await wb.admin.query(
      "select deleted_at from blobs where id = $1",
      [blobId],
    );
    expect(row.rows[0].deleted_at).not.toBeNull();
  });

  it("leaves a recent prepare alone, at the workspace's own window", async () => {
    const wb = await workerDb();
    const storage = recordingStorage();
    const blobId = await prepare("still-uploading.pdf");
    // An hour old, and the default window is a day.
    await wb.admin.query(
      "update blobs set created_at = now() - interval '1 hour' where id = $1",
      [blobId],
    );

    const result = await callAction(
      { pool: wb.appPool, ...context(), storage: storage.port },
      "blobs.reapOrphans",
      {},
    );
    expect(result.discarded).toBe(0);
    expect(storage.deleted).toEqual([]);
  });

  it("never touches an upload that was claimed", async () => {
    const wb = await workerDb();
    const storage = recordingStorage();
    const blobId = await prepare("real.pdf");
    await callAction({ pool: wb.appPool, ...context() }, "blobs.claimUpload", {
      blobId,
      actualSize: 10,
      digest: "claimed-for-real",
    });
    await wb.admin.query(
      "update blobs set created_at = now() - interval '30 days' where id = $1",
      [blobId],
    );

    const result = await callAction(
      { pool: wb.appPool, ...context(), storage: storage.port },
      "blobs.reapOrphans",
      {},
    );
    expect(result.discarded).toBe(0);

    const row = await wb.admin.query(
      "select deleted_at from blobs where id = $1",
      [blobId],
    );
    expect(row.rows[0].deleted_at).toBeNull();
  });

  it("discards the row and counts the bytes it could not remove", async () => {
    const wb = await workerDb();
    const blobId = await prepare("never-uploaded.pdf");
    await wb.admin.query(
      "update blobs set created_at = now() - interval '2 days' where id = $1",
      [blobId],
    );

    // An object that was never uploaded is the ordinary reason a prepare goes
    // unclaimed. Leaving the row behind would mean trying the same dead key
    // every day for good.
    const result = await callAction(
      {
        pool: wb.appPool,
        ...context(),
        storage: {
          get: async () => Buffer.alloc(0),
          delete: async () => {
            throw new Error("no such object");
          },
        },
      },
      "blobs.reapOrphans",
      {},
    );

    expect(result).toEqual({ discarded: 1, bytesLeft: 1 });
    const row = await wb.admin.query(
      "select deleted_at from blobs where id = $1",
      [blobId],
    );
    expect(row.rows[0].deleted_at).not.toBeNull();
  });

  it("writes an activity row naming what it cleared", async () => {
    const wb = await workerDb();
    const storage = recordingStorage();
    const blobId = await prepare("abandoned.pdf");
    await wb.admin.query(
      "update blobs set created_at = now() - interval '2 days' where id = $1",
      [blobId],
    );
    await callAction(
      { pool: wb.appPool, ...context(), storage: storage.port },
      "blobs.reapOrphans",
      {},
    );

    const rows = await wb.admin.query(
      "select payload from activities where kind = 'blob.reaped'",
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].payload).toMatchObject({ discarded: 1, bytesLeft: 0 });
  });
});
