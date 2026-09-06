/**
 * Files, from a real FlowyTeam into a real workspace (TECHNICAL-PLAN §7.2,
 * P6-T04c).
 *
 * Four claims worth a real database and a real directory. That a local file
 * with `--files-root` given arrives as a blob whose digest matches the bytes on
 * disk. That the same file without the flag is a named report line and never a
 * blob with nothing behind it. That an external address becomes a link in the
 * task's description rather than a failed download. And that a comment holding
 * a base64 image gains an attachment and loses the data URI, which is the
 * second phase of the reference rewrite.
 */

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStorage } from "@openokr/adapters";
import { provisionWorkspaceForUser } from "@openokr/core";
import { workerDb } from "@openokr/test-support/db";
import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { runFlowyteamImport } from "../src/flowyteam/run.ts";
import { openSource, type Source } from "../src/flowyteam/source.ts";
import {
  available,
  SEEDED,
  type SeededSource,
  SKIP_REASON,
  seedSource,
} from "./support/flowyteam-source.ts";

const OWNER = "66666666-6666-4666-6666-666666666666";
const runnable = await available();
if (!runnable) {
  console.warn(`Skipping the FlowyTeam file tests. ${SKIP_REASON}`);
}

/** The bytes the fixture's one findable file holds. */
const BRIEF = Buffer.from("%PDF-1.4 a brief\n", "utf8");
const BRIEF_DIGEST = createHash("sha256").update(BRIEF).digest("hex");

let pool: Pool;
let workspaceId: string;
let seeded: SeededSource;
let source: Source;
/** Where the fake FlowyTeam server keeps its uploads. */
let filesRoot: string;
/** Where this instance keeps its own bytes. */
let storageRoot: string;

async function rows<T extends Record<string, unknown>>(
  sql: string,
): Promise<T[]> {
  const wb = await workerDb();
  const result = await wb.admin.query<T>(sql);
  return result.rows;
}

async function count(sql: string): Promise<number> {
  const [row] = await rows<{ n: number }>(sql);
  return Number(row?.n ?? 0);
}

function storage() {
  return new LocalDiskStorage({
    root: storageRoot,
    signingSecret: "not-used-on-this-path",
  });
}

async function run(
  write: boolean,
  options: { readonly withFilesRoot?: boolean } = {},
) {
  return runFlowyteamImport({
    pool,
    workspaceId,
    userId: OWNER,
    url: seeded.url,
    companyId: SEEDED.first.id,
    source,
    write,
    storage: storage(),
    ...(options.withFilesRoot === false ? {} : { filesRoot }),
  });
}

const domain = (
  report: Awaited<ReturnType<typeof run>>["report"],
  name: string,
) => report.reconciliation.find((one) => one.domain === name);

beforeEach(async () => {
  if (!runnable) {
    return;
  }
  const wb = await workerDb();
  pool = wb.appPool;
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Import Owner", "files-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Import Owner",
  });
  workspaceId = provisioned.workspaceId;

  await seeded?.drop();
  await source?.close();
  seeded = await seedSource("files");
  source = await openSource({ url: seeded.url });

  // A fake source server: one of the fixture's two local files is on disk,
  // in the layout a Laravel install uses, and the other is not.
  filesRoot = await mkdtemp(join(tmpdir(), "openokr-flowy-files-"));
  await mkdir(join(filesRoot, "storage", "app", "task-files"), {
    recursive: true,
  });
  await writeFile(
    join(filesRoot, "storage", "app", "task-files", "aaaa1111.pdf"),
    BRIEF,
  );
  await writeFile(
    join(filesRoot, "storage", "app", "task-files", "cccc3333.zip"),
    Buffer.from("PK not allowed here", "utf8"),
  );
  storageRoot = await mkdtemp(join(tmpdir(), "openokr-blobs-"));
});

afterAll(async () => {
  await source?.close();
  await seeded?.drop();
  if (filesRoot) {
    await rm(filesRoot, { recursive: true, force: true });
  }
  if (storageRoot) {
    await rm(storageRoot, { recursive: true, force: true });
  }
  const wb = await workerDb();
  await wb.close();
});

describe.skipIf(!runnable)("importing one company's files", () => {
  it("acceptance: a local file arrives as a blob whose digest matches", async () => {
    await run(true);

    const [blob] = await rows<{
      filename: string;
      content_type: string;
      filesize: string;
      digest: string;
      status: string;
      storage_key: string;
      author: string;
    }>(
      `select b.filename, b.content_type, b.filesize, b.digest, b.status,
              b.storage_key, m.name as author
         from blobs b join workspace_members m on m.id = b.author_member_id
        where b.legacy_id = 'task_files:1'`,
    );
    expect(blob?.filename).toBe("brief.pdf");
    expect(blob?.content_type).toBe("application/pdf");
    expect(Number(blob?.filesize)).toBe(BRIEF.byteLength);
    expect(blob?.digest).toBe(BRIEF_DIGEST);
    // Claimed, not left pending: the bytes were written before the claim.
    expect(blob?.status).toBe("ok");
    // The uploader in the source, not the person running the import.
    expect(blob?.author).toBe("Ada Lovelace");

    // And the bytes really are in this instance's own store.
    const stored = await storage().get(blob?.storage_key as string);
    expect(stored.equals(BRIEF)).toBe(true);
  });

  it("hangs the blob on the task it belonged to", async () => {
    await run(true);
    const [attached] = await rows<{ task: string }>(
      `select t.title as task
         from attachments a
         join blobs b on b.id = a.blob_id
         join tasks t on t.id = a.subject_id
        where b.legacy_id = 'task_files:1' and a.subject_type = 'task'`,
    );
    expect(attached?.task).toBe("Call back");
  });

  it("names a file whose bytes are not under the root, and writes no blob", async () => {
    const { report } = await run(true);
    expect(
      await count(
        "select count(*)::int as n from blobs where legacy_id = 'task_files:2'",
      ),
    ).toBe(0);
    const skipped = domain(report, "files")?.skipped ?? [];
    const line = skipped.find((one) => one.source === "task_files:2");
    expect(line?.reason).toContain("was not under --files-root");
    expect(line?.reason).toContain("paths");
  });

  it("names every local file when no root is given, and writes none", async () => {
    const { report } = await run(true, { withFilesRoot: false });
    // No blob for a file on the source's disk. An inline image is a different
    // case and still imports: its bytes are in MySQL, not on that disk.
    expect(
      await count(
        "select count(*)::int as n from blobs where legacy_id like 'task_files:%'",
      ),
    ).toBe(0);
    expect(
      await count(
        "select count(*)::int as n from blobs where legacy_id like 'task_files_inline:%'",
      ),
    ).toBe(1);
    const skipped = domain(report, "files")?.skipped ?? [];
    expect(
      skipped.find((one) => one.source === "task_files:1")?.reason,
    ).toContain("--files-root");
    expect(report.notes.join(" ")).toContain(
      "a read-only MySQL connection cannot reach them",
    );
  });

  it("an external address becomes a link and not a download", async () => {
    const { report } = await run(true);
    const [task] = await rows<{ description: unknown }>(
      "select description from tasks where legacy_id = 'tasks:1'",
    );
    const body = JSON.stringify(task?.description);
    expect(body).toContain("https://drive.google.com/file/d/abc/view");
    expect(body).toContain('"link"');
    expect(body).toContain("Files");
    // The original description survives the append.
    expect(body).toContain("Ring them on Monday");
    expect(report.notes.join(" ")).toContain("addresses somewhere else");
  });

  it("names a file whose type this product will not hold", async () => {
    const { report } = await run(true);
    const skipped = domain(report, "files")?.skipped ?? [];
    const line = skipped.find((one) => one.source === "task_files:5");
    expect(line?.reason.toLowerCase()).toMatch(/type|allow/);
    expect(
      await count(
        "select count(*)::int as n from blobs where legacy_id = 'task_files:5'",
      ),
    ).toBe(0);
  });

  it("skips a file whose task did not import", async () => {
    const { report } = await run(true);
    expect(
      (domain(report, "files")?.skipped ?? []).map((one) => one.source),
    ).toContain("task_files:6");
  });

  it("a comment that held a base64 image gains an attachment and loses the data URI", async () => {
    const { report } = await run(true);

    const [comment] = await rows<{ body: unknown; edited_at: Date | null }>(
      "select body, edited_at from comments where legacy_id = 'task_comments:4'",
    );
    const body = JSON.stringify(comment?.body);
    expect(body).not.toContain("base64");
    expect(body).toContain('"attachment"');
    expect(body).toContain("Look");
    // Nobody edited this comment; the import finished what it started.
    expect(comment?.edited_at).toBeNull();

    const [blob] = await rows<{ content_type: string; status: string }>(
      "select content_type, status from blobs where legacy_id = 'task_files_inline:4:0'",
    );
    expect(blob?.content_type).toBe("image/png");
    expect(blob?.status).toBe("ok");
    expect(report.notes.join(" ")).toContain(
      "second phase of the reference rewrite",
    );
  });

  it("a re-run writes no second copy", async () => {
    await run(true);
    const blobsBefore = await count(
      "select count(*)::int as n from blobs where legacy_type = 'flowyteam'",
    );
    const attachedBefore = await count(
      "select count(*)::int as n from attachments",
    );
    const [before] = await rows<{ description: unknown }>(
      "select description from tasks where legacy_id = 'tasks:1'",
    );

    const { report } = await run(true);
    expect(
      await count(
        "select count(*)::int as n from blobs where legacy_type = 'flowyteam'",
      ),
    ).toBe(blobsBefore);
    expect(await count("select count(*)::int as n from attachments")).toBe(
      attachedBefore,
    );
    expect(domain(report, "files")?.created).toBe(0);
    expect(domain(report, "comment images")?.created).toBe(0);

    // And the link section is not appended a second time.
    const [after] = await rows<{ description: unknown }>(
      "select description from tasks where legacy_id = 'tasks:1'",
    );
    expect(JSON.stringify(after?.description)).toBe(
      JSON.stringify(before?.description),
    );
  });

  it("a dry run writes nothing", async () => {
    await run(false);
    expect(
      await count(
        "select count(*)::int as n from blobs where legacy_type = 'flowyteam'",
      ),
    ).toBe(0);
    expect(await count("select count(*)::int as n from attachments")).toBe(0);
  });
});
