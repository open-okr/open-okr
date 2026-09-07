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

    expect(domain(report, "check-ins")?.created).toBe(1);
  });

  it("acceptance: a second run writes no second copy of the history", async () => {
    await run(true);
    const { report } = await run(true);

    expect(domain(report, "check-ins")?.created).toBe(0);
    expect(domain(report, "check-ins")?.matched).toBe(1);
    expect(
      await count(
        `select count(*)::int as n from check_ins where legacy_type = 'flowyteam'`,
      ),
    ).toBe(1);
    // And one snapshot, not two.
    expect(
      await count(`select count(*)::int as n from check_in_snapshots`),
    ).toBe(1);
  });

  it("writes nothing on a dry run", async () => {
    const { report } = await run(false);
    expect(domain(report, "check-ins")?.created).toBe(1);
    expect(await count(`select count(*)::int as n from check_ins`)).toBe(0);
  });
});
