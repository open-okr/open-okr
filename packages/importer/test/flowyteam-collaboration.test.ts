/**
 * Task comments and watchers, from a real FlowyTeam into a real workspace
 * (TECHNICAL-PLAN §7.2, P6-T04b).
 *
 * Three claims worth a real database. That a comment carrying a script tag
 * lands with the script gone and the words kept, which is the untrusted-content
 * rule proved at the write boundary rather than in the converter's own unit
 * tests. That a reply keeps its parent, which needs both comments written and
 * the second pass run. And that a watcher whose member is a placeholder is
 * reported rather than counted as a subscription that does not exist.
 */
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

const OWNER = "77777777-7777-4777-7777-777777777777";
const runnable = await available();
if (!runnable) {
  console.warn(`Skipping the FlowyTeam collaboration tests. ${SKIP_REASON}`);
}

let pool: Pool;
let workspaceId: string;
let seeded: SeededSource;
let source: Source;

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

async function run(write: boolean) {
  return runFlowyteamImport({
    pool,
    workspaceId,
    userId: OWNER,
    url: seeded.url,
    companyId: SEEDED.first.id,
    source,
    write,
  });
}

const domain = (
  report: Awaited<ReturnType<typeof run>>["report"],
  name: string,
) => report.reconciliation.find((one) => one.domain === name);

/** Every string in a stored body, so a test can say what a reader sees. */
const wordsOf = (body: unknown): string => JSON.stringify(body);

beforeEach(async () => {
  if (!runnable) {
    return;
  }
  const wb = await workerDb();
  pool = wb.appPool;
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Import Owner", "collab-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Import Owner",
  });
  workspaceId = provisioned.workspaceId;

  await seeded?.drop();
  await source?.close();
  seeded = await seedSource("collaboration");
  source = await openSource({ url: seeded.url });
});

afterAll(async () => {
  await source?.close();
  await seeded?.drop();
  const wb = await workerDb();
  await wb.close();
});

describe.skipIf(!runnable)("importing one company's conversation", () => {
  it("acceptance: every comment renders as its author wrote it", async () => {
    await run(true);

    const stored = await rows<{
      legacy_id: string;
      body: unknown;
      author: string;
      created_at: Date;
      edited_at: Date | null;
    }>(
      `select c.legacy_id, c.body, m.name as author,
              c.created_at, c.edited_at
         from comments c join workspace_members m on m.id = c.author_member_id
        where c.legacy_type = 'flowyteam' and c.subject_type = 'task'
        order by c.legacy_id`,
    );

    const first = stored.find((row) => row.legacy_id === "task_comments:1");
    expect(wordsOf(first?.body)).toContain("Ring them on");
    expect(wordsOf(first?.body)).toContain('"bold"');
    // The author is the person who wrote it in the source, not the migrator.
    expect(first?.author).toBe("Ada Lovelace");
    // And the date is the source's, not today.
    expect(first?.created_at.toISOString()).toBe("2026-02-01T09:00:00.000Z");
  });

  it("keeps the words and loses the script", async () => {
    await run(true);
    const [row] = await rows<{ body: unknown }>(
      "select body from comments where legacy_id = 'task_comments:2'",
    );
    expect(wordsOf(row?.body)).toContain("Done");
    expect(wordsOf(row?.body)).toContain("already");
    expect(wordsOf(row?.body)).not.toContain("alert");
  });

  it("keeps an http link and refuses a javascript: one, keeping its words", async () => {
    await run(true);
    const [row] = await rows<{ body: unknown }>(
      "select body from comments where legacy_id = 'task_comments:3'",
    );
    const body = wordsOf(row?.body);
    expect(body).toContain("https://example.com/a");
    expect(body).toContain("this");
    expect(body).not.toContain("javascript");
  });

  it("records an edit the source knows about", async () => {
    await run(true);
    const [row] = await rows<{ edited_at: Date | null }>(
      "select edited_at from comments where legacy_id = 'task_comments:2'",
    );
    expect(row?.edited_at?.toISOString()).toBe("2026-02-02T11:00:00.000Z");
  });

  it("a reply keeps its parent", async () => {
    await run(true);
    const [reply] = await rows<{ parent: string | null }>(
      `select parent.legacy_id as parent
         from comments child
         left join comments parent on parent.id = child.parent_id
        where child.legacy_id = 'task_comments:5'`,
    );
    expect(reply?.parent).toBe("task_comments:1");
  });

  it("a reply whose parent never imported is flagged and still imported", async () => {
    const { report } = await run(true);
    const [row] = await rows<{ parent_id: string | null }>(
      "select parent_id from comments where legacy_id = 'task_comments:6'",
    );
    expect(row?.parent_id).toBeNull();
    expect(
      domain(report, "comments")?.flags.map((flag) => flag.source),
    ).toContain("task_comments:6");
  });

  it("flags an inline image rather than storing the data URI", async () => {
    const { report } = await run(true);
    const [row] = await rows<{ body: unknown }>(
      "select body from comments where legacy_id = 'task_comments:4'",
    );
    expect(wordsOf(row?.body)).toContain("Look");
    expect(wordsOf(row?.body)).not.toContain("base64");
    const flags = domain(report, "comments")?.flags ?? [];
    expect(flags.some((flag) => flag.source === "task_comments:4")).toBe(true);
    expect(report.notes.join(" ")).toContain("inline images");
  });

  it("skips an empty comment and a comment on a task that did not import", async () => {
    const { report } = await run(true);
    const skipped = domain(report, "comments")?.skipped ?? [];
    expect(skipped.map((one) => one.source)).toContain("task_comments:7");
    expect(skipped.map((one) => one.source)).toContain("task_comments:8");
    expect(
      skipped.find((one) => one.source === "task_comments:8")?.reason,
    ).toContain("did not import");
  });

  /**
   * The finding this test exists to pin down. Every member an import creates
   * is a placeholder, and §7.2 excludes a placeholder from subscribing, so a
   * first run restores no watch at all. Each is a named skip and the domain
   * says so in one line, rather than reporting writes that did not happen.
   */
  it("names every watch it could not restore rather than claiming a write", async () => {
    const { report } = await run(true);

    const subscribed = await count(
      `select count(*)::int as n
         from subscriptions s
         join subscription_lists l on l.id = s.list_id
        where l.subject_type = 'task' and s.canceled = false`,
    );
    expect(subscribed).toBe(0);

    const watchers = domain(report, "watchers");
    expect(watchers?.read).toBe(5);
    expect(watchers?.created).toBe(0);
    // Task 4's project never imported, employee 99 never imported, and the
    // remaining three name placeholders.
    expect(watchers?.skipped).toHaveLength(5);
    expect(watchers?.clean).toBe(false);
    expect(
      watchers?.flags.some((flag) =>
        flag.reason.includes("placeholder until somebody claims"),
      ),
    ).toBe(true);
  });

  it("a re-run writes no second copy", async () => {
    await run(true);
    const before = await count(
      "select count(*)::int as n from comments where legacy_type = 'flowyteam'",
    );
    const subsBefore = await count(
      "select count(*)::int as n from subscriptions",
    );

    const { report } = await run(true);
    expect(
      await count(
        "select count(*)::int as n from comments where legacy_type = 'flowyteam'",
      ),
    ).toBe(before);
    expect(await count("select count(*)::int as n from subscriptions")).toBe(
      subsBefore,
    );
    expect(domain(report, "comments")?.created).toBe(0);
  });

  it("a dry run writes nothing and predicts what a real run does", async () => {
    const dry = await run(false);
    expect(
      await count(
        "select count(*)::int as n from comments where legacy_type = 'flowyteam'",
      ),
    ).toBe(0);

    const real = await run(true);
    expect(domain(dry.report, "comments")?.created).toBe(
      domain(real.report, "comments")?.created,
    );
    expect(domain(dry.report, "comments")?.skipped).toHaveLength(
      (domain(real.report, "comments")?.skipped ?? []).length,
    );
  });

  it("says in the report that files are not here yet", async () => {
    const { report } = await run(false);
    expect(report.notes.join(" ")).toContain("Task files are not imported yet");
  });
});
