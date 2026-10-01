import { createHash } from "node:crypto";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import {
  BLOB_SCAN_TOPIC,
  resolveClamdSettings,
  runScanJob,
  type ScanFile,
} from "../src/blobs/scan.ts";
import {
  type ImageProcessing,
  ImageRefusedError,
  storeUpload,
} from "../src/blobs/upload.ts";
import { thumbnailKeyFor } from "../src/blobs/validation.ts";
import { dispatchOutbox } from "../src/outbox/handlers.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * An upload through the pipeline, with the image and scan ports faked
 * (completeness review M-24, P2-T05, TECHNICAL-PLAN §8.2).
 *
 * The drivers are proved against sharp and a fake clamd in
 * `packages/adapters`. What is proved here is the order and what each step
 * leaves behind: the stored bytes are the re-encoded ones, the thumbnail sits
 * at the key the claim records, a refused image reserves nothing, and with a
 * scanner configured nothing is served until the verdict is in.
 */

const OWNER = "upload-owner";

let workspaceId: string;

const context = async () => {
  const wb = await workerDb();
  return {
    pool: wb.appPool,
    workspaceId,
    actor: { kind: "human" as const, userId: OWNER },
  };
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Upload Owner", "upload-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Upload Owner",
  });
  workspaceId = provisioned.workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

/** A storage port that keeps what it was given. */
function memoryStorage() {
  const objects = new Map<string, { body: Buffer; contentType?: string }>();
  return {
    objects,
    port: {
      async put(
        key: string,
        body: Buffer,
        options?: { readonly contentType?: string },
      ) {
        objects.set(key, {
          body,
          ...(options?.contentType ? { contentType: options.contentType } : {}),
        });
        return { key, size: body.byteLength };
      },
    },
  };
}

const RE_ENCODED = Buffer.from("pixels this instance drew");
const THUMBNAIL = Buffer.from("a small webp");

/** An image port that re-encodes everything into the same fixed bytes. */
function fakeImages(): ImageProcessing & { calls: number } {
  const port = {
    calls: 0,
    async process(_body: Buffer, options: { readonly contentType: string }) {
      port.calls += 1;
      return {
        kind: "processed" as const,
        image: {
          body: RE_ENCODED,
          contentType: options.contentType,
          width: 640,
          height: 480,
        },
        thumbnail: {
          body: THUMBNAIL,
          contentType: "image/webp",
          width: 320,
          height: 240,
        },
      };
    },
  };
  return port;
}

async function blobRow(blobId: string) {
  const wb = await workerDb();
  const result = await wb.admin.query<{
    status: string;
    filesize: string;
    digest: string;
    storage_key: string;
    thumbnail_key: string | null;
    width: number | null;
    height: number | null;
  }>(
    `select status, filesize, digest, storage_key, thumbnail_key, width, height
       from blobs where id = $1`,
    [blobId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error(`no blob ${blobId}`);
  }
  return row;
}

async function configureScanner() {
  const wb = await workerDb();
  await wb.admin.query(
    `insert into system_settings (key, value, source) values ('scan.clamd.host', '"clamd.internal"', 'admin')`,
  );
}

describe("storing an upload", () => {
  it("stores the re-encoded image and its thumbnail, and the claim records both", async () => {
    const storage = memoryStorage();
    const images = fakeImages();
    const original = Buffer.from("the bytes the browser sent, EXIF and all");

    const stored = await storeUpload(
      await context(),
      { storage: storage.port, images },
      { filename: "holiday.jpg", contentType: "image/jpeg", bytes: original },
    );

    expect(stored.status).toBe("ok");
    expect(images.calls).toBe(1);

    const row = await blobRow(stored.blobId);
    expect(row.status).toBe("ok");
    // What was written, not what arrived.
    expect(Number(row.filesize)).toBe(RE_ENCODED.byteLength);
    expect(row.digest).toBe(
      createHash("sha256").update(RE_ENCODED).digest("hex"),
    );
    expect([row.width, row.height]).toEqual([640, 480]);
    expect(row.thumbnail_key).toBe(thumbnailKeyFor(row.storage_key));

    expect(storage.objects.get(row.storage_key)?.body.equals(RE_ENCODED)).toBe(
      true,
    );
    expect(storage.objects.has(row.storage_key)).toBe(true);
    const thumbnail = storage.objects.get(row.thumbnail_key as string);
    expect(thumbnail?.body.equals(THUMBNAIL)).toBe(true);
    expect(thumbnail?.contentType).toBe("image/webp");
    // Nothing kept the original.
    expect(
      [...storage.objects.values()].some((one) => one.body.equals(original)),
    ).toBe(false);

    const preview = await callAction(await context(), "blobs.getForDownload", {
      blobId: stored.blobId,
      variant: "thumbnail",
    });
    expect(preview).toEqual({
      storageKey: row.thumbnail_key,
      filename: "holiday.jpg",
      contentType: "image/webp",
    });
  });

  it("passes a file that is not an image straight through, with no preview", async () => {
    const storage = memoryStorage();
    const images = fakeImages();
    const pdf = Buffer.from("%PDF-1.7 minutes of the weekly session");

    const stored = await storeUpload(
      await context(),
      { storage: storage.port, images },
      { filename: "minutes.pdf", contentType: "application/pdf", bytes: pdf },
    );

    expect(images.calls).toBe(0);
    const row = await blobRow(stored.blobId);
    expect(row.thumbnail_key).toBeNull();
    expect(storage.objects.size).toBe(1);
    expect(storage.objects.get(row.storage_key)?.body.equals(pdf)).toBe(true);

    await expect(
      callAction(await context(), "blobs.getForDownload", {
        blobId: stored.blobId,
        variant: "thumbnail",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("refuses an image the processor cannot read, and reserves nothing", async () => {
    const storage = memoryStorage();
    const images: ImageProcessing = {
      async process() {
        return { kind: "unreadable", reason: "not_an_image" };
      },
    };

    const refusal = storeUpload(
      await context(),
      { storage: storage.port, images },
      {
        filename: "photo.png",
        contentType: "image/png",
        bytes: Buffer.from("<html>not a picture</html>"),
      },
    );
    await expect(refusal).rejects.toBeInstanceOf(ImageRefusedError);
    await expect(refusal).rejects.toMatchObject({
      code: "forbidden",
      reason: "not_an_image",
    });

    const wb = await workerDb();
    const blobs = await wb.admin.query("select id from blobs");
    expect(blobs.rows).toHaveLength(0);
    expect(storage.objects.size).toBe(0);
  });

  it("refuses a blocked type before the image port is asked anything", async () => {
    const images = fakeImages();
    await expect(
      storeUpload(
        await context(),
        { storage: memoryStorage().port, images },
        {
          filename: "drawing.svg",
          contentType: "image/svg+xml",
          bytes: Buffer.from("<svg/>"),
        },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(images.calls).toBe(0);
  });

  it("ignores a thumbnail claim made up by a caller: the key is always derived", async () => {
    const ctx = await context();
    const prepared = await callAction(ctx, "blobs.prepareUpload", {
      filename: "a.png",
      contentType: "image/png",
      declaredSize: 10,
    });
    // The input has no way to name a key, so the worst a caller can do is say
    // a thumbnail exists; the key still sits under this blob's own prefix.
    await callAction(ctx, "blobs.claimUpload", {
      blobId: prepared.blobId,
      actualSize: 10,
      digest: "d",
      thumbnail: true,
    });
    const row = await blobRow(prepared.blobId);
    expect(row.thumbnail_key).toBe(`${prepared.storageKey}.thumb.webp`);
    expect(row.thumbnail_key?.startsWith(`${workspaceId}/`)).toBe(true);
  });
});

describe("with a virus scanner configured", () => {
  async function heldUpload() {
    await configureScanner();
    const storage = memoryStorage();
    const stored = await storeUpload(
      await context(),
      { storage: storage.port, images: fakeImages() },
      {
        filename: "brief.pdf",
        contentType: "application/pdf",
        bytes: Buffer.from("%PDF-1.7 the brief"),
      },
    );
    return { storage, stored };
  }

  const getFileFrom =
    (storage: ReturnType<typeof memoryStorage>) => async (key: string) =>
      storage.objects.get(key)?.body ?? null;

  it("holds the file and enqueues exactly one scan in the claim's transaction", async () => {
    const { stored } = await heldUpload();
    expect(stored.status).toBe("scanning");
    expect((await blobRow(stored.blobId)).status).toBe("scanning");

    const wb = await workerDb();
    const outbox = await wb.admin.query<{ payload: Record<string, unknown> }>(
      "select payload from outbox where topic = $1",
      [BLOB_SCAN_TOPIC],
    );
    expect(outbox.rows.map((row) => row.payload)).toEqual([
      { workspaceId, blobId: stored.blobId },
    ]);
  });

  it("serves nothing while the scan is pending", async () => {
    const { stored } = await heldUpload();
    await expect(
      callAction(await context(), "blobs.getForDownload", {
        blobId: stored.blobId,
      }),
    ).rejects.toMatchObject({
      code: "forbidden",
      message: expect.stringMatching(/being checked for viruses/),
    });
  });

  it("releases a clean file, and records the verdict with its audit row", async () => {
    const { storage, stored } = await heldUpload();
    const scanned: Buffer[] = [];
    const scanFile: ScanFile = async (body) => {
      scanned.push(body);
      return { verdict: "clean" };
    };

    const result = await runScanJob(
      { workspaceId, blobId: stored.blobId },
      {
        pool: (await workerDb()).appPool,
        getFile: getFileFrom(storage),
        scanFile,
      },
    );

    expect(result).toEqual({ kind: "released" });
    expect(scanned[0]?.toString()).toBe("%PDF-1.7 the brief");
    expect((await blobRow(stored.blobId)).status).toBe("ok");
    await expect(
      callAction(await context(), "blobs.getForDownload", {
        blobId: stored.blobId,
      }),
    ).resolves.toMatchObject({ filename: "brief.pdf" });

    const wb = await workerDb();
    const audit = await wb.admin.query<{
      actor_kind: string;
      payload: Record<string, unknown>;
    }>(
      "select actor_kind, payload from audit_events where action = 'blobs.recordScan'",
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.actor_kind).toBe("system");
    expect(audit.rows[0]?.payload).toMatchObject({
      verdict: "clean",
      status: "ok",
    });
  });

  it("quarantines a file the scanner flags, naming the signature on the audit row only", async () => {
    const { storage, stored } = await heldUpload();
    const result = await runScanJob(
      { workspaceId, blobId: stored.blobId },
      {
        pool: (await workerDb()).appPool,
        getFile: getFileFrom(storage),
        scanFile: async () => ({
          verdict: "found",
          signature: "Pretend.Test-Signature",
        }),
      },
    );

    expect(result).toEqual({ kind: "quarantined", verdict: "found" });
    expect((await blobRow(stored.blobId)).status).toBe("quarantined");
    await expect(
      callAction(await context(), "blobs.getForDownload", {
        blobId: stored.blobId,
      }),
    ).rejects.toMatchObject({
      code: "forbidden",
      message: expect.stringMatching(/held this file back/),
    });

    const wb = await workerDb();
    const audit = await wb.admin.query<{ payload: Record<string, unknown> }>(
      "select payload from audit_events where action = 'blobs.recordScan'",
    );
    expect(audit.rows[0]?.payload).toMatchObject({
      verdict: "found",
      status: "quarantined",
      signature: "Pretend.Test-Signature",
    });
    const activity = await wb.admin.query<{ payload: Record<string, unknown> }>(
      "select payload from activities where kind = 'blob.scanned'",
    );
    expect(activity.rows[0]?.payload).toEqual({ verdict: "found" });
  });

  it("keeps a file held when the scanner cannot be reached, so the relay retries", async () => {
    const { storage, stored } = await heldUpload();
    await expect(
      runScanJob(
        { workspaceId, blobId: stored.blobId },
        {
          pool: (await workerDb()).appPool,
          getFile: getFileFrom(storage),
          scanFile: async () => {
            throw new Error("connect ECONNREFUSED 10.0.0.9:3310");
          },
        },
      ),
    ).rejects.toThrow(/ECONNREFUSED/);
    expect((await blobRow(stored.blobId)).status).toBe("scanning");
  });

  it("quarantines a file whose bytes are gone, rather than calling it clean", async () => {
    const { stored } = await heldUpload();
    const scanFile = vi.fn<ScanFile>();
    const result = await runScanJob(
      { workspaceId, blobId: stored.blobId },
      {
        pool: (await workerDb()).appPool,
        getFile: async () => null,
        scanFile,
      },
    );
    expect(result).toEqual({ kind: "quarantined", verdict: "missing" });
    expect(scanFile).not.toHaveBeenCalled();
  });

  it("does nothing on a redelivery once the verdict is in", async () => {
    const { storage, stored } = await heldUpload();
    const deps = {
      pool: (await workerDb()).appPool,
      getFile: getFileFrom(storage),
      scanFile: vi.fn<ScanFile>(async () => ({ verdict: "clean" as const })),
    };
    await runScanJob({ workspaceId, blobId: stored.blobId }, deps);
    const again = await runScanJob(
      { workspaceId, blobId: stored.blobId },
      deps,
    );
    expect(again).toEqual({
      kind: "skipped",
      reason: "the file is already ok",
    });
    expect(deps.scanFile).toHaveBeenCalledTimes(1);
  });

  it("the relay's handler refuses to release a file when no scanner is configured where it runs", async () => {
    const { storage, stored } = await heldUpload();
    const delivery = {
      topic: BLOB_SCAN_TOPIC,
      payload: { workspaceId, blobId: stored.blobId },
      idempotencyKey: `${BLOB_SCAN_TOPIC}:${stored.blobId}`,
      attempts: 1,
    };
    const pool = (await workerDb()).appPool;

    await expect(
      dispatchOutbox(delivery, {
        pool,
        getFile: getFileFrom(storage),
        scanner: async () => null,
      }),
    ).rejects.toThrow(/no scanner is configured/);
    expect((await blobRow(stored.blobId)).status).toBe("scanning");

    await dispatchOutbox(delivery, {
      pool,
      getFile: getFileFrom(storage),
      scanner: async () => async () => ({ verdict: "clean" }),
    });
    expect((await blobRow(stored.blobId)).status).toBe("ok");
  });
});

describe("an abandoned image", () => {
  it("is reaped with the thumbnail its upload may have written", async () => {
    // The thumbnail goes into storage between prepare and claim, so an upload
    // that stopped there leaves two objects and only one is named on the row.
    const ctx = await context();
    const prepared = await callAction(ctx, "blobs.prepareUpload", {
      filename: "half-done.png",
      contentType: "image/png",
      declaredSize: 10,
    });
    const wb = await workerDb();
    await wb.admin.query(
      "update blobs set created_at = now() - interval '2 days' where id = $1",
      [prepared.blobId],
    );
    const deleted: string[] = [];
    const result = await callAction(
      {
        ...ctx,
        storage: {
          get: async () => Buffer.alloc(0),
          delete: async (key: string) => {
            deleted.push(key);
          },
        },
      },
      "blobs.reapOrphans",
      {},
    );

    expect(result).toEqual({ discarded: 1, bytesLeft: 0 });
    expect(deleted.sort()).toEqual(
      [prepared.storageKey, thumbnailKeyFor(prepared.storageKey)].sort(),
    );
  });
});

describe("the scanner setting", () => {
  const nothingStored = async () => undefined;

  it("is off with nothing set, which is every instance nobody configured", async () => {
    await expect(resolveClamdSettings(nothingStored, {})).resolves.toBeNull();
    // A Compose file that interpolates an unset variable produces a blank.
    await expect(
      resolveClamdSettings(nothingStored, { OPENOKR_CLAMD_HOST: "  " }),
    ).resolves.toBeNull();
  });

  it("reads the environment, with clamd's own port as the default", async () => {
    await expect(
      resolveClamdSettings(nothingStored, { OPENOKR_CLAMD_HOST: "clamav" }),
    ).resolves.toEqual({ host: "clamav", port: 3310 });
    await expect(
      resolveClamdSettings(nothingStored, {
        OPENOKR_CLAMD_HOST: "clamav",
        OPENOKR_CLAMD_PORT: "3311",
      }),
    ).resolves.toEqual({ host: "clamav", port: 3311 });
  });

  it("lets a stored value win over the environment", async () => {
    const stored = async (key: string) =>
      key === "scan.clamd.host" ? "clamd.internal" : undefined;
    await expect(
      resolveClamdSettings(stored, { OPENOKR_CLAMD_HOST: "clamav" }),
    ).resolves.toEqual({ host: "clamd.internal", port: 3310 });
  });

  it("claims straight to ok when no scanner is configured", async () => {
    const stored = await storeUpload(
      await context(),
      { storage: memoryStorage().port, images: fakeImages() },
      {
        filename: "notes.txt",
        contentType: "text/plain",
        bytes: Buffer.from("plain notes"),
      },
    );
    expect(stored.status).toBe("ok");
    const wb = await workerDb();
    const outbox = await wb.admin.query(
      "select 1 from outbox where topic = $1",
      [BLOB_SCAN_TOPIC],
    );
    expect(outbox.rows).toHaveLength(0);
  });
});
