/**
 * The multi-company guard (P6-T02).
 *
 * One FlowyTeam database holds many companies and nothing in the schema stops a
 * query crossing them, so this is the check that keeps somebody else's quarter
 * out of a workspace. Proved against a real server with two companies in it,
 * because a count that ignored `company_id` would pass every fake.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  countCompanies,
  countFor,
  listCompanies,
  requireCompany,
} from "../src/flowyteam/companies.ts";
import { companyAlreadyImported } from "../src/flowyteam/run.ts";
import { openSource, type Source } from "../src/flowyteam/source.ts";
import {
  available,
  SEEDED,
  type SeededSource,
  SKIP_REASON,
  seedSource,
} from "./support/flowyteam-source.ts";

const runnable = await available();
if (!runnable) {
  console.warn(`Skipping the FlowyTeam company tests. ${SKIP_REASON}`);
}

describe.skipIf(!runnable)("choosing the one company", () => {
  let seeded: SeededSource;
  let source: Source;

  beforeAll(async () => {
    seeded = await seedSource("companies");
    source = await openSource({ url: seeded.url });
  });

  afterAll(async () => {
    await source?.close();
    await seeded?.drop();
  });

  it("lists what the source holds", async () => {
    expect(await countCompanies(source)).toBe(2);
    const listed = await listCompanies(source);
    expect(listed.map((company) => company.name)).toEqual([
      SEEDED.first.name,
      SEEDED.second.name,
    ]);
    expect(listed[0]?.timezone).toBe("Asia/Jakarta");
  });

  it("refuses a run with no company, and shows the ones there are", async () => {
    await expect(requireCompany(source, undefined)).rejects.toThrow(
      new RegExp(`--company is required[\\s\\S]*${SEEDED.second.name}`),
    );
  });

  it("refuses a company the source does not have, without listing them all", async () => {
    const refusal = await requireCompany(source, 4242).catch(
      (error: Error) => error.message,
    );
    expect(refusal).toContain("no company 4242");
    expect(refusal).not.toContain(SEEDED.first.name);
  });

  it("acceptance: counts only the chosen company's rows", async () => {
    const first = await countFor(source, SEEDED.first.id, [
      "objectives",
      "key_results",
    ]);
    const second = await countFor(source, SEEDED.second.id, [
      "objectives",
      "key_results",
    ]);
    expect(first).toEqual({ objectives: 8, key_results: 4 });
    expect(second).toEqual({ objectives: 1, key_results: 0 });
  });

  it("will not be talked into counting something that is not a table name", async () => {
    await expect(
      countFor(source, SEEDED.first.id, ["objectives; drop table companies"]),
    ).rejects.toThrow(/is not a table name/);
  });
});

describe("a workspace holds one company", () => {
  const runFor = (companyId: number | null) => ({
    source: "flowyteam" as const,
    status: "completed" as const,
    report: companyId === null ? {} : { companyId },
  });

  it("lets the same company run again", () => {
    expect(companyAlreadyImported([runFor(7), runFor(7)], 7)).toBeNull();
  });

  it("refuses a second company, and names the first", () => {
    expect(companyAlreadyImported([runFor(7)], 9)).toBe(7);
  });

  it("ignores runs that did not finish, and runs from the spreadsheet importer", () => {
    expect(
      companyAlreadyImported(
        [
          { ...runFor(7), status: "failed" },
          { ...runFor(7), source: "csv" },
          runFor(null),
        ],
        9,
      ),
    ).toBeNull();
  });
});
