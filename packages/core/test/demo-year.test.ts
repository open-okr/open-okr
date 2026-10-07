/**
 * The public demo tells the Northwind year (P9-T22c-e-c).
 *
 * The acceptance: given today's date, when the seed builds the Northwind
 * year, then every step dated before today is true, nothing dated after it
 * exists, and every person in it can sign in. Built as of the real today,
 * as `pnpm db:seed` and the nightly reset build it, and prepared as
 * `pnpm demo:prepare` prepares it.
 */
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuth } from "../src/auth/auth.ts";
import {
  DEMO_PERSONA_PASSWORD,
  DEMO_PERSONAS,
  prepareDemoPersonas,
} from "../src/demo/personas.ts";
import { buildNorthwindYear } from "../src/demo/year/build.ts";
import { isoDay, toReal } from "../src/demo/year/calendar.ts";
import { YEAR_PEOPLE } from "../src/demo/year/people.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const OWNER = "demo-year-owner";
const BASE_URL = "http://localhost:3000";
const SECRET = "a-test-secret-of-sufficient-length-for-signing";
const today = isoDay(new Date());
const realYear = Number(today.slice(0, 4));

let workspaceId: string;
let auth: ReturnType<typeof createAuth>;
let prepared: Awaited<ReturnType<typeof prepareDemoPersonas>>;

const rows = async <T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> => {
  const wb = await workerDb();
  return (await wb.admin.query<T>(sql, [workspaceId, ...params])).rows;
};

beforeAll(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Elena Marsh", "demo-year-owner@example.com"],
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, {
      id: OWNER,
      name: "Elena Marsh",
    })
  ).workspaceId;
  await buildNorthwindYear({
    pool: wb.appPool,
    workspaceId,
    adminUserId: OWNER,
  });
  auth = createAuth({
    pool: wb.appPool,
    secret: SECRET,
    baseUrl: BASE_URL,
    rateLimit: { enabled: false },
  });
  prepared = await prepareDemoPersonas({
    pool: wb.appPool,
    workspaceId,
    adminUserId: OWNER,
    auth,
  });
}, 900_000);

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the year as of today (P9-T22c-e-c)", () => {
  it("writes nothing dated after today", async () => {
    const [later] = await rows<{ checkIns: string; sessions: string }>(
      `select
         (select count(*) from check_ins where workspace_id = $1
            and published_at::date > $2::date) as "checkIns",
         (select count(*) from okr_sessions where workspace_id = $1
            and ended_at is not null and scheduled_for::date > $2::date) as sessions`,
      [today],
    );
    expect(Number(later?.checkIns)).toBe(0);
    expect(Number(later?.sessions)).toBe(0);
  });

  it("has everybody who has arrived by today, and nobody who has not", async () => {
    const members = await rows<{ name: string }>(
      "select name from workspace_members where workspace_id = $1 and deleted_at is null",
    );
    const names = members.map((one) => one.name);
    for (const person of YEAR_PEOPLE) {
      if (person.name === "") {
        continue;
      }
      expect(names.includes(person.name), person.name).toBe(
        toReal(person.arrives, realYear) <= today,
      );
    }
  });
});

describe("the demo prepared on it", () => {
  /** The personas who are members by today, and so can be given an account. */
  const arrived = () =>
    DEMO_PERSONAS.filter((persona) => {
      const person = YEAR_PEOPLE.find((one) => one.name === persona.name);
      return person !== undefined && toReal(person.arrives, realYear) <= today;
    });

  it("gives every person in the year who has arrived an account", () => {
    expect(prepared.personas.map((one) => one.email).sort()).toEqual(
      arrived()
        .map((one) => one.email)
        .sort(),
    );
  });

  it("lets each of them sign in", async () => {
    for (const persona of arrived()) {
      const response = await auth.api.signInEmail({
        body: { email: persona.email, password: DEMO_PERSONA_PASSWORD },
        asResponse: true,
      });
      expect(response.status, persona.email).toBe(200);
    }
  });
});
