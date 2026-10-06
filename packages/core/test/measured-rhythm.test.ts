import { withWorkspace } from "@openokr/db";
import { resolveThresholds } from "@openokr/method";
import { workerDb } from "@openokr/test-support/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { measuredRhythmInTx } from "../src/sessions/measured-rhythm.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The diagnostic's rhythm, measured (METHOD.md §8.6, P9-T20d).
 *
 * "The share of due check-ins published within tolerance, measured by the
 * product. Holiday periods (§7.4) are not due, so they are not counted." A
 * quarter that has ended, so every check-in has fallen due, with its history
 * written through the action an import uses to keep a check-in's own date.
 */

const OWNER = "measured-owner";

let workspaceId: string;
let spaceId: string;
let memberId: string;
let cycle: { id: string; startsOn: string; endsOn: string };
let goalId: string;

const call = async <T>(action: string, input: unknown): Promise<T> => {
  const wb = await workerDb();
  return (await callAction(
    { pool: wb.appPool, workspaceId, actor: { kind: "human", userId: OWNER } },
    action as never,
    input as never,
  )) as T;
};

const addDays = (on: string, days: number): string =>
  new Date(Date.parse(`${on}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

/** The quarter's Mondays, which is when a weekly check-in falls due. */
const mondays = (): string[] => {
  let on = cycle.startsOn;
  while (new Date(`${on}T00:00:00Z`).getUTCDay() !== 1) {
    on = addDays(on, 1);
  }
  const all: string[] = [];
  for (; on <= cycle.endsOn; on = addDays(on, 7)) {
    all.push(on);
  }
  return all;
};

const publishOn = async (dates: readonly string[]) => {
  for (const [index, on] of dates.entries()) {
    await call("goals.importCheckIn", {
      goalId,
      authorMemberId: memberId,
      status: "on_track",
      confidence: 0.6,
      narrative: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Held." }] },
        ],
      },
      publishedAt: `${on}T10:00:00.000Z`,
      legacy: { type: "csv", id: `measured-${index}` },
    });
  }
};

const measure = async () => {
  const wb = await workerDb();
  return withWorkspace(drizzle(wb.appPool), workspaceId, (tx) =>
    measuredRhythmInTx(tx as never, {
      workspaceId,
      spaceId,
      cycleId: cycle.id,
      asOf: new Date(),
      thresholds: resolveThresholds(),
    }),
  );
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Sara", "measured-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Sara",
  });
  workspaceId = provisioned.workspaceId;
  memberId = provisioned.memberId;
  spaceId = (await call<{ id: string }[]>("spaces.list", {}))[0]?.id as string;
  const ago = new Date(Date.now() - 120 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  cycle = await call("cycles.create", { on: ago, mode: "quarterly" });
  goalId = (
    await call<{ id: string }>("goals.create", {
      title: "Customers reach value in their first week",
      cycleId: cycle.id,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: memberId,
    })
  ).id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the measured rhythm", () => {
  it("counts every Monday due, and the ones published on time", async () => {
    const due = mondays();
    // Every week but the last two.
    await publishOn(due.slice(0, -2));
    const measured = await measure();
    expect(measured.due).toBe(due.length);
    expect(measured.onTime).toBe(due.length - 2);
    expect(measured.share).toBeCloseTo((due.length - 2) / due.length, 10);
  });

  it("does not count a week the space marked as a holiday (§7.4)", async () => {
    const due = mondays();
    const holidayMonday = due[4] as string;
    await call("spaces.setHolidays", {
      id: spaceId,
      holidays: [
        { startsOn: holidayMonday, endsOn: addDays(holidayMonday, 6) },
      ],
    });
    await publishOn(due.filter((on) => on !== holidayMonday));
    const measured = await measure();
    expect(measured.due).toBe(due.length - 1);
    expect(measured.share).toBe(1);
  });

  it("does not count a check-in published past the tolerance for the week it missed", async () => {
    const due = mondays();
    // One check-in, three days after the first Monday: past the tolerance, so
    // the first week is missed. It falls before the second Monday, and a
    // check-in early for its period is on time for it, as the cadence engine
    // has always read one, so it counts once, for the second.
    await publishOn([addDays(due[0] as string, 3)]);
    const measured = await measure();
    expect(measured.due).toBe(due.length);
    expect(measured.onTime).toBe(1);
  });
});
