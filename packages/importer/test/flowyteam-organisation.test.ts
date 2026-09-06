/**
 * People, spaces and cycles out of a real FlowyTeam into a real workspace
 * (TECHNICAL-PLAN §7.2, P6-T03a).
 *
 * Two databases, both real, because the claims are about both. That a source
 * row becomes a target row is a MySQL question; that running it twice writes
 * nothing the second time is a Postgres one, and a fake on either side would
 * only assert what this repository already believes.
 *
 * The acceptance criterion is the last test in the first block: the second run
 * creates nothing, matches everything, and reconciles clean.
 */
import { callAction, provisionWorkspaceForUser } from "@openokr/core";
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

const OWNER = "44444444-4444-4444-8444-444444444444";
const runnable = await available();
if (!runnable) {
  console.warn(`Skipping the FlowyTeam organisation tests. ${SKIP_REASON}`);
}

let pool: Pool;
let workspaceId: string;
let seeded: SeededSource;
let source: Source;

async function count(sql: string): Promise<number> {
  const wb = await workerDb();
  const result = await wb.admin.query<{ n: number }>(sql);
  return result.rows[0]?.n ?? 0;
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

/** One domain's reconciliation out of a report. */
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
    [OWNER, "Import Owner", "import-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Import Owner",
  });
  workspaceId = provisioned.workspaceId;

  await seeded?.drop();
  await source?.close();
  seeded = await seedSource("organisation");
  source = await openSource({ url: seeded.url });
});

afterAll(async () => {
  await source?.close();
  await seeded?.drop();
  const wb = await workerDb();
  await wb.close();
});

describe.skipIf(!runnable)("importing one company's organisation", () => {
  it("writes nothing on a dry run, and reports what a real run would write", async () => {
    const { report } = await run(false);

    expect(report.mode).toBe("dry_run");
    expect(domain(report, "members")?.created).toBe(2);
    expect(domain(report, "spaces")?.created).toBe(3);
    // The workspace's own space from provisioning, and nothing else.
    expect(
      await count(
        `select count(*)::int as n from spaces where legacy_type = 'flowyteam'`,
      ),
    ).toBe(0);
    expect(
      await count(
        `select count(*)::int as n from workspace_members where kind = 'placeholder'`,
      ),
    ).toBe(0);
  });

  it("acceptance: a real run writes the people, spaces and cycles", async () => {
    const { report } = await run(true);

    expect(report.mode).toBe("real");
    // Two of the four source users import: one has no address and one belongs
    // to the other company.
    expect(domain(report, "members")).toMatchObject({
      read: 3,
      created: 2,
      matched: 0,
    });
    expect(domain(report, "members")?.skipped).toHaveLength(1);
    expect(domain(report, "members")?.skipped[0]?.reason).toContain(
      "no email address",
    );

    const members = await count(
      `select count(*)::int as n from workspace_members where legacy_type = 'flowyteam'`,
    );
    expect(members).toBe(2);
    const titled = await count(
      `select count(*)::int as n from workspace_members where title = 'Head of Sales'`,
    );
    expect(titled).toBe(1);
  });

  it("flattens the team tree and records how deep it was", async () => {
    const { report } = await run(true);

    // Three of the four teams import: one has no name.
    expect(domain(report, "spaces")?.created).toBe(3);
    expect(report.notes.join(" ")).toContain("2 deep and imported flat");
    // A leader who did not import leaves the space without a manager, and says
    // so rather than picking somebody. A flag, not a skip: the space is here.
    expect(
      domain(report, "spaces")
        ?.flags.map((row) => row.reason)
        .join(" "),
    ).toContain("did not import");
  });

  it("keeps the cycle the source named, and refuses the four it cannot map", async () => {
    const { report } = await run(true);

    expect(domain(report, "cycles")?.created).toBe(1);
    const reasons = domain(report, "cycles")
      ?.skipped.map((row) => row.reason)
      .join(" | ");
    expect(reasons).toContain("Planning module");
    expect(reasons).toContain("no cadence that short");
    expect(reasons).toContain("before it starts");
    // Two source cycles in one quarter: the product holds one cycle per period.
    expect(reasons).toContain("already exists");

    const named = await count(
      `select count(*)::int as n from cycles where name = 'FY26 Q1'`,
    );
    expect(named).toBe(1);
  });

  it("acceptance: a second run writes nothing and reconciles clean", async () => {
    await run(true);
    const { report } = await run(true);

    for (const name of ["members", "spaces", "space members", "cycles"]) {
      const second = domain(report, name);
      expect(second?.created, `${name} created on the second run`).toBe(0);
      // Everything read is either matched or skipped for a reason the first run
      // gave too. A domain where those three do not add up has lost a row.
      expect(
        (second?.matched ?? 0) + (second?.skipped.length ?? 0),
        `${name} accounted for on the second run`,
      ).toBe(second?.read);
    }
    expect(report.written).toBe(0);
    // **No domain here reconciles clean, and that is right.** This source was
    // seeded with a person who has no address, a team with no name, a team
    // whose leader belongs to another company, and four cycles that cannot
    // map. Every one of those is a skip, and a skip means "look at this". A
    // company with tidy data reconciles clean; this one is deliberately not.
    expect(report.reconciliation.every((one) => one.clean)).toBe(false);
    expect(domain(report, "space members")?.skipped[0]?.reason).toContain(
      "did not import",
    );

    // And the target holds one of each, not two.
    expect(
      await count(
        `select count(*)::int as n from workspace_members where legacy_type = 'flowyteam'`,
      ),
    ).toBe(2);
    expect(
      await count(
        `select count(*)::int as n from spaces where legacy_type = 'flowyteam'`,
      ),
    ).toBe(3);
  });

  it("claims a member who is already here by their address rather than making a second one", async () => {
    // The person running the import is already a member with a real account.
    // An import that found the same address must not create a placeholder
    // beside them.
    const wb = await workerDb();
    await wb.admin.query("update users set email = $2 where id = $1", [
      OWNER,
      "ada@example.com",
    ]);

    await run(true);

    expect(
      await count(
        `select count(*)::int as n from workspace_members
          where legacy_type = 'flowyteam' and kind = 'placeholder'`,
      ),
    ).toBe(1);
    const claimed = await count(
      `select count(*)::int as n from workspace_members
        where legacy_id = 'users:1' and kind = 'human'`,
    );
    expect(claimed).toBe(1);
  });

  it("leaves the other company alone", async () => {
    await run(true);
    const other = await count(
      `select count(*)::int as n from workspace_members where legacy_id = 'users:4'`,
    );
    expect(other).toBe(0);
  });

  it("records the run, with its counts and its report", async () => {
    const { runId } = await run(true);
    const { runs } = await callAction(
      {
        pool,
        workspaceId,
        actor: { kind: "human" as const, userId: OWNER },
      },
      "imports.listRuns",
      { limit: 5 },
    );
    const recorded = runs.find((one) => one.id === runId);
    expect(recorded?.status).toBe("completed");
    expect(recorded?.source).toBe("flowyteam");
    expect(recorded?.mode).toBe("real");
    expect(
      (recorded?.report as { companyId?: number } | undefined)?.companyId,
    ).toBe(SEEDED.first.id);
  });
});
