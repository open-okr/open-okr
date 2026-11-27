/**
 * Check-ins, from a real FlowyTeam into a real workspace (TECHNICAL-PLAN §7.2,
 * P6-T03c).
 *
 * The claim worth proving is that the imported history says something true: the
 * person who wrote each check-in is its author, the day they wrote it is its
 * date, and the measures that moved with it are in its snapshot. A migration
 * that stamped all of them with today under the migrator's name would pass a
 * count-based test and be worthless to the people who have to read it.
 */
import { provisionWorkspaceForUser, type Source } from "@openokr/core";
import { workerDb } from "@openokr/test-support/db";
import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { runFlowyteamImport } from "../src/flowyteam/run.ts";
import { openSource } from "../src/flowyteam/source.ts";
import {
  available,
  SEEDED,
  type SeededSource,
  SKIP_REASON,
  seedSource,
} from "./support/flowyteam-source.ts";

const OWNER = "66666666-6666-4666-8666-666666666666";
const runnable = await available();
if (!runnable) {
  console.warn(`Skipping the FlowyTeam check-in tests. ${SKIP_REASON}`);
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
  return row?.n ?? 0;
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

beforeEach(async () => {
  if (!runnable) {
    return;
  }
  const wb = await workerDb();
  pool = wb.appPool;
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Import Owner", "checkin-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Import Owner",
  });
  workspaceId = provisioned.workspaceId;

  await seeded?.drop();
  await source?.close();
  seeded = await seedSource("checkins");
  source = await openSource({ url: seeded.url });
});

afterAll(async () => {
  await source?.close();
  await seeded?.drop();
  const wb = await workerDb();
  await wb.close();
});

describe.skipIf(!runnable)("importing one company's check-ins", () => {
  it("acceptance: keeps the author and the date the source recorded", async () => {
    await run(true);

    const [checkIn] = await rows<{
      published_at: string;
      author: string;
      status: string;
      confidence: string;
    }>(
      `select c.published_at, m.name as author, c.status, c.confidence
         from check_ins c join workspace_members m on m.id = c.author_member_id
        where c.legacy_id = 'objective_checkins:1'`,
    );
    // The person who wrote it, not the person who ran the import.
    expect(checkIn?.author).toBe("Ada Lovelace");
    // The driver hands back a Date, so compare the day rather than the text.
    expect(new Date(String(checkIn?.published_at)).toISOString()).toContain(
      "2026-02-01",
    );
    // FlowyTeam's 8 out of 10 is 0.8 here, which is on track.
    expect(Number(checkIn?.confidence)).toBeCloseTo(0.8, 5);
    expect(checkIn?.status).toBe("on_track");
  });

  it("puts the measures that moved into the check-in's own snapshot", async () => {
    await run(true);
    const [snapshot] = await rows<{ entries: { keyResultId: string }[] }>(
      `select s.entries from check_in_snapshots s
         join check_ins c on c.id = s.check_in_id
        where c.legacy_id = 'objective_checkins:1'`,
    );
    // Both key results of that objective, because both moved with it.
    expect(snapshot?.entries.length).toBeGreaterThanOrEqual(2);

    const [measure] = await rows<{ current_value: string }>(
      `select current_value from key_results where legacy_id = 'key_results:1'`,
    );
    // 18, from the check-in, not 12 from the record history that ran before it.
    expect(Number(measure?.current_value)).toBe(18);
  });

  it("records the review as an acknowledgement", async () => {
    await run(true);
    const [checkIn] = await rows<{
      acknowledged_by: string | null;
      acknowledged_at: string | null;
    }>(
      `select m.name as acknowledged_by, c.acknowledged_at
         from check_ins c
         left join workspace_members m on m.id = c.acknowledged_by_id
        where c.legacy_id = 'objective_checkins:1'`,
    );
    expect(checkIn?.acknowledged_by).toBe("Grace Hopper");
    expect(new Date(String(checkIn?.acknowledged_at)).toISOString()).toContain(
      "2026-02-02",
    );
  });

  it("names every check-in it could not import, and why", async () => {
    const { report } = await run(true);
    const reasons = domain(report, "check-ins")
      ?.skipped.map((row) => `${row.source}: ${row.reason}`)
      .join(" | ");

    // Written by the person with no address, who is not a member here.
    expect(reasons).toContain("objective_checkins:2");
    expect(reasons).toContain("did not import");
    // No narrative at all.
    expect(reasons).toContain("objective_checkins:3");
    expect(reasons).toContain("says nothing");
    // On an objective that did not import.
    expect(reasons).toContain("objective_checkins:4");

    // Two objective-path rows imported one check-in, and the stand-alone rows
    // add two more.
    expect(domain(report, "check-ins")?.created).toBe(3);
  });

  it("acceptance: reads key result rows that have no objective check-in", async () => {
    const preview = await run(false);
    const checkIns = domain(preview.report, "check-ins");
    // 4 objective rows and 4 stand-alone rows. Two groups would be written.
    expect(checkIns?.read).toBe(8);
    expect(checkIns?.created).toBe(3);
    expect(preview.report.notes.join(" ")).toContain(
      "4 key result check-ins had no objective check-in and were grouped into 2 check-ins, one per objective and period.",
    );
  });

  it("acceptance: one check-in per objective and period, lowest confidence, latest author", async () => {
    const { report } = await run(true);
    const [checkIn] = await rows<{
      author: string;
      confidence: string;
      status: string;
      narrative: string;
      published_at: string;
    }>(
      `select m.name as author, c.confidence, c.status,
              c.narrative::text as narrative, c.published_at
         from check_ins c join workspace_members m on m.id = c.author_member_id
        where c.legacy_id = 'key_result_checkins:5'`,
    );
    // The later row is Grace's, and 4 out of 10 is the lower of 8 and 4.
    expect(checkIn?.author).toBe("Grace Hopper");
    expect(Number(checkIn?.confidence)).toBeCloseTo(0.4, 5);
    expect(checkIn?.status).not.toBe("on_track");
    expect(new Date(String(checkIn?.published_at)).toISOString()).toContain(
      "2026-04-02",
    );
    // Both remarks, each under its key result's title.
    expect(checkIn?.narrative).toContain("Churn: Churn dropped.");
    expect(checkIn?.narrative).toContain("Churn: Churn rose again.");

    // Key result 2 carries the later row's value, not the earlier one's.
    const [snapshot] = await rows<{ entries: { value?: number }[] }>(
      `select s.entries from check_in_snapshots s
         join check_ins c on c.id = s.check_in_id
        where c.legacy_id = 'key_result_checkins:5'`,
    );
    expect(JSON.stringify(snapshot?.entries)).toContain("6");

    const flags = domain(report, "check-ins")?.flags.map(
      (row) => `${row.source}: ${row.reason}`,
    );
    const said = (flags ?? []).join(" | ");
    // Both authors are named, and the earlier row is named as superseded.
    expect(said).toContain("users 1, 2");
    expect(said).toContain("Superseded by key_result_checkins:6");
    expect(said).toContain("Combined with key_result_checkins:6");
  });

  it("acceptance: a group with no remark adds its values to the history and writes no check-in", async () => {
    const { report } = await run(true);
    expect(
      await count(
        `select count(*)::int as n from check_ins
          where legacy_id in ('key_result_checkins:9', 'key_result_checkins:10')`,
      ),
    ).toBe(0);

    const history = await rows<{
      legacy_id: string;
      value: string;
      at: string;
      author: string | null;
    }>(
      `select k.legacy_id, v.value, v.at, m.name as author
         from key_result_values v
         join key_results k on k.id = v.key_result_id
         left join workspace_members m on m.id = v.author_member_id
        where v.source = 'import' order by v.at`,
    );
    expect(history.map((row) => row.legacy_id)).toEqual([
      "key_results:1",
      "key_results:2",
    ]);
    // The source's own dates and values, and no author where the writer did
    // not import.
    expect(new Date(history[0]?.at ?? "").toISOString()).toContain(
      "2026-05-01",
    );
    expect(Number(history[0]?.value)).toBe(30);
    expect(history[0]?.author).toBe("Ada Lovelace");
    expect(new Date(history[1]?.at ?? "").toISOString()).toContain(
      "2026-05-02",
    );
    expect(history[1]?.author).toBeNull();

    // The current value stays where the dated check-in left it.
    const [measure] = await rows<{ current_value: string }>(
      `select current_value from key_results where legacy_id = 'key_results:1'`,
    );
    expect(Number(measure?.current_value)).toBe(18);

    expect(report.notes.join(" ")).toContain(
      "2 key result check-ins had no remark, so their values were added to the key result history instead of a check-in.",
    );
    // Kept out of the check-in tally, which still reads 4 + 4 rows.
    expect(domain(report, "check-ins")?.read).toBe(8);
    expect(
      domain(report, "key result history")?.created,
    ).toBeGreaterThanOrEqual(2);
  });

  it("writes no second copy of a values-only row on a second run", async () => {
    await run(true);
    const { report } = await run(true);
    expect(
      await count(
        `select count(*)::int as n from key_result_values where source = 'import'`,
      ),
    ).toBe(2);
    expect(report.written).toBe(0);
  });

  it("gives a stand-alone row with no dates its own period", async () => {
    await run(true);
    const [checkIn] = await rows<{ author: string; goal: string }>(
      `select m.name as author, g.legacy_id as goal
         from check_ins c
         join workspace_members m on m.id = c.author_member_id
         join goals g on g.id = c.subject_id
        where c.legacy_id = 'key_result_checkins:8'`,
    );
    expect(checkIn).toEqual({ author: "Ada Lovelace", goal: "objectives:2" });
  });

  it("acceptance: skips a row whose key result did not import, by name, and still writes the rest", async () => {
    const { report } = await run(true);
    const reasons = domain(report, "check-ins")
      ?.skipped.map((row) => `${row.source}: ${row.reason}`)
      .join(" | ");
    expect(reasons).toContain("key_result_checkins:7");
    expect(reasons).toContain("Key result 5 did not import");
    expect(
      await count(
        `select count(*)::int as n from check_ins where legacy_id = 'key_result_checkins:5'`,
      ),
    ).toBe(1);
  });

  it("acceptance: a second run writes no second copy of the history", async () => {
    await run(true);
    const { report } = await run(true);

    expect(domain(report, "check-ins")?.created).toBe(0);
    expect(domain(report, "check-ins")?.matched).toBe(3);
    expect(
      await count(
        `select count(*)::int as n from check_ins where legacy_type = 'flowyteam'`,
      ),
    ).toBe(3);
    // And one snapshot per check-in, not two.
    expect(
      await count(`select count(*)::int as n from check_in_snapshots`),
    ).toBe(3);
  });

  it("writes nothing on a dry run", async () => {
    const { report } = await run(false);
    expect(domain(report, "check-ins")?.created).toBe(3);
    expect(await count(`select count(*)::int as n from check_ins`)).toBe(0);
  });
});
