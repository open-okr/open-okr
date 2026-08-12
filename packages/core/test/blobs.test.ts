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
