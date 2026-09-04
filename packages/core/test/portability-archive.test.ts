/**
 * An archive of a real workspace (TECHNICAL-PLAN §7.3, P6-T05a).
 *
 * The acceptance criterion is what only a real database can settle: that the
 * archive holds every table the policy list exports and no row from any it
 * excludes. The rest follows: the checksum catches a changed byte, the seal
 * catches a wrong key, and the manifest's counts match what is actually in
 * the file.
 */
import { randomBytes } from "node:crypto";
import { withWorkspace } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import {
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
  ArchiveError,
  readArchive,
  writeArchive,
} from "../src/portability/archive.ts";
import { exportWorkspace } from "../src/portability/export.ts";
import { EXCLUDED_TABLES } from "../src/portability/policy.ts";
import { newRootKey, parseKeyRing } from "../src/secrets/key-ring.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const OWNER = "33333333-3333-4333-8333-333333333333";

let pool: Pool;
let workspaceId: string;
const ring = parseKeyRing({ current: newRootKey() });

/** A blob store with a few bytes in it and one key that is not there. */
class Bytes {
  readonly #objects = new Map<string, Buffer>();

  put(key: string, body: Buffer): void {
    this.#objects.set(key, body);
  }

  async get(key: string): Promise<Buffer> {
    const found = this.#objects.get(key);
    if (!found) {
      throw new Error(`no object at ${key}`);
    }
    return found;
  }
}

beforeEach(async () => {
  const wb = await workerDb();
  pool = wb.appPool;
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Archive Owner", "archive-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Archive Owner",
  });
  workspaceId = provisioned.workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

/**
 * One archive, built on a transaction with the tenant setting applied.
 *
 * `withWorkspace` here rather than a pool, because that is how the action
 * calls it: row-level security is transaction-local, so a select outside one
 * reads nothing.
 */
async function exported(storage?: Bytes) {
  const db = drizzle(pool);
  return withWorkspace(db, workspaceId, (tx) =>
    exportWorkspace({
      tx,
      workspaceId,
      ring,
      instance: "test-instance",
      ...(storage ? { storage } : {}),
    }),
  );
}

describe("exporting a workspace", () => {
  it("acceptance: carries the workspace and nothing on the exclusion list", async () => {
    const result = await exported();
    const opened = readArchive(ring, result.bytes);

    expect(opened.manifest.format).toBe(ARCHIVE_FORMAT);
    expect(opened.manifest.version).toBe(ARCHIVE_VERSION);
    expect(opened.manifest.workspace.id).toBe(workspaceId);
    expect(opened.manifest.instance).toBe("test-instance");
    // A provisioned workspace has a schema version, not "none".
    expect(opened.manifest.schemaVersion).toMatch(/^\d{4}_/);

    const carried = new Set(
      opened.records
        .filter((record) => record.r === "row")
        .map((record) => (record.r === "row" ? record.t : "")),
    );
    // The workspace row itself, its members, its spaces and its access model.
    expect(carried).toContain("workspaces");
    expect(carried).toContain("workspace_members");
    expect(carried).toContain("access_contexts");
    expect(carried).toContain("access_bindings");

    // And not one row from any excluded table, checked by name so a failure
    // says which policy line was broken.
    const leaked = [...carried].filter((table) =>
      (EXCLUDED_TABLES as readonly string[]).includes(table),
    );
    expect(leaked).toEqual([]);
  });

  it("counts in the manifest what the archive actually holds", async () => {
    const opened = readArchive(ring, (await exported()).bytes);

    const actual = new Map<string, number>();
    for (const record of opened.records) {
      if (record.r !== "row") {
        continue;
      }
      actual.set(record.t, (actual.get(record.t) ?? 0) + 1);
    }
    const wrong: string[] = [];
    for (const [table, count] of Object.entries(opened.manifest.counts)) {
      if ((actual.get(table) ?? 0) !== count) {
        wrong.push(
          `${table}: manifest ${count}, archive ${actual.get(table) ?? 0}`,
        );
      }
    }
    expect(wrong).toEqual([]);
  });

  it("carries a blob's bytes and names one whose object is gone", async () => {
    const store = new Bytes();
    const contents = randomBytes(64);

    const prepared = await callAction(
      { pool, workspaceId, actor: { kind: "human", userId: OWNER } },
      "blobs.prepareUpload",
      {
        filename: "brief.pdf",
        contentType: "application/pdf",
        declaredSize: contents.byteLength,
      },
    );
    store.put(prepared.storageKey, contents);
    await callAction(
      { pool, workspaceId, actor: { kind: "human", userId: OWNER } },
      "blobs.claimUpload",
      {
        blobId: prepared.blobId,
        actualSize: contents.byteLength,
        digest: "not-checked-here",
      },
    );

    // A second blob whose bytes were never written, which is what a storage
    // failure or a hand-deleted object looks like.
    const orphan = await callAction(
      { pool, workspaceId, actor: { kind: "human", userId: OWNER } },
      "blobs.prepareUpload",
      {
        filename: "gone.pdf",
        contentType: "application/pdf",
        declaredSize: 10,
      },
    );
    await callAction(
      { pool, workspaceId, actor: { kind: "human", userId: OWNER } },
      "blobs.claimUpload",
      { blobId: orphan.blobId, actualSize: 10, digest: "also-not-checked" },
    );

    const result = await exported(store);
    const opened = readArchive(ring, result.bytes);

    const blobs = opened.records.filter((record) => record.r === "blob");
    expect(blobs).toHaveLength(1);
    expect(
      Buffer.from(blobs[0]?.r === "blob" ? blobs[0].b : "", "base64").equals(
        contents,
      ),
    ).toBe(true);
    expect(opened.manifest.blobs).toEqual({
      count: 1,
      bytes: contents.byteLength,
    });

    // The one that could not be read is named rather than silently dropped.
    expect(result.missingBlobs.map((blob) => blob.filename)).toEqual([
      "gone.pdf",
    ]);
  });

  it("carries the rows but no bytes when no storage is given", async () => {
    const opened = readArchive(ring, (await exported()).bytes);
    expect(opened.records.filter((record) => record.r === "blob")).toEqual([]);
    expect(opened.manifest.blobs.count).toBe(0);
  });

  it("refuses to open an archive with one byte changed", async () => {
    const result = await exported();
    const tampered = Buffer.from(result.bytes);
    // Past the header line, so the digest rather than the JSON is what fails.
    const start = tampered.indexOf(0x0a) + 1;
    tampered[start + 5] = (tampered[start + 5] ?? 0) ^ 0xff;

    expect(() => readArchive(ring, tampered)).toThrow(ArchiveError);
    expect(() => readArchive(ring, tampered)).toThrow(
      /do not match the digest/,
    );
  });

  it("refuses to open an archive sealed under a key this instance does not hold", async () => {
    const result = await exported();
    const stranger = parseKeyRing({ current: newRootKey() });
    expect(() => readArchive(stranger, result.bytes)).toThrow(/does not hold/);
  });

  it("refuses a truncated archive", async () => {
    const result = await exported();
    expect(() =>
      readArchive(ring, result.bytes.subarray(0, result.bytes.length - 20)),
    ).toThrow(/truncated or something was appended/);
  });

  it("refuses a file that is not an archive at all", () => {
    expect(() => readArchive(ring, Buffer.from("hello\nworld"))).toThrow(
      /not readable JSON/,
    );
    expect(() => readArchive(ring, Buffer.from("no newline here"))).toThrow(
      /no header line/,
    );
  });

  it("refuses a format version it does not read", async () => {
    const result = await exported();
    const newline = result.bytes.indexOf(0x0a);
    const header = JSON.parse(result.bytes.subarray(0, newline).toString());
    const future = Buffer.concat([
      Buffer.from(`${JSON.stringify({ ...header, version: 99 })}\n`),
      result.bytes.subarray(newline + 1),
    ]);
    expect(() => readArchive(ring, future)).toThrow(/format version 99/);
  });
});

describe("the archive writer's own rules", () => {
  it("refuses a run of records with no manifest first", () => {
    expect(() => writeArchive(ring, [{ r: "end", rows: 0, blobs: 0 }])).toThrow(
      /begins with its manifest/,
    );
  });

  it("refuses a run of records with no end record", () => {
    expect(() =>
      writeArchive(ring, [
        {
          r: "manifest",
          manifest: {
            format: ARCHIVE_FORMAT,
            version: ARCHIVE_VERSION,
            createdAt: new Date().toISOString(),
            schemaVersion: "none",
            instance: "x",
            workspace: { id: OWNER, slug: "s", name: "n" },
            counts: {},
            blobs: { count: 0, bytes: 0 },
            tables: [],
            deferredColumns: [],
          },
        },
      ]),
    ).toThrow(/ends with an end record/);
  });
});

/**
 * The action, which is the only path a person actually takes.
 *
 * It proves the two things the module tests above cannot: that the archive is
 * built on the Operation's own transaction, and that taking a copy of a
 * company's whole OKR history leaves an audit row naming who took it.
 */
describe("workspace.exportArchive", () => {
  const context = () => ({
    pool,
    workspaceId,
    actor: { kind: "human" as const, userId: OWNER },
    ring,
  });

  it("acceptance: returns a sealed archive that opens, and records the run", async () => {
    const result = await callAction(context(), "workspace.exportArchive", {
      includeFiles: false,
    });

    expect(result.filename).toMatch(/^workspace-.+-\d{4}-\d{2}-\d{2}\.okr$/);
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.digest).toMatch(/^[0-9a-f]{64}$/);

    const opened = readArchive(
      ring,
      Buffer.from(result.archiveBase64, "base64"),
    );
    expect(opened.manifest.workspace.id).toBe(workspaceId);
    expect(result.counts).toEqual(opened.manifest.counts);

    const wb = await workerDb();
    const [run] = (
      await wb.admin.query<{
        kind: string;
        state: string;
        filename: string;
        row_count: number;
      }>(
        "select kind, state, filename, row_count from export_runs where id = $1",
        [result.runId],
      )
    ).rows;
    expect(run?.kind).toBe("archive");
    // Ready, not queued: the file is in the answer and nothing is coming later.
    expect(run?.state).toBe("ready");
    expect(run?.filename).toBe(result.filename);
    expect(Number(run?.row_count)).toBeGreaterThan(0);
  });

  it("writes an audit row naming who took the copy", async () => {
    const result = await callAction(context(), "workspace.exportArchive", {
      includeFiles: false,
    });

    const wb = await workerDb();
    const [audit] = (
      await wb.admin.query<{
        action: string;
        payload: Record<string, unknown>;
      }>(
        `select action, payload from audit_events
          where action = 'workspace.exportArchive'
          order by at desc limit 1`,
      )
    ).rows;
    expect(audit?.action).toBe("workspace.exportArchive");
    expect(audit?.payload.digest).toBe(result.digest);
    expect(audit?.payload.filename).toBe(result.filename);
  });

  it("refuses when the instance holds no encryption key", async () => {
    await expect(
      callAction(
        {
          pool,
          workspaceId,
          actor: { kind: "human" as const, userId: OWNER },
        },
        "workspace.exportArchive",
        { includeFiles: false },
      ),
    ).rejects.toThrow(/OPENOKR_ENCRYPTION_KEY/);
  });

  it("carries no file bytes when asked not to", async () => {
    const result = await callAction(context(), "workspace.exportArchive", {
      includeFiles: false,
    });
    expect(result.blobs.count).toBe(0);
  });
});
