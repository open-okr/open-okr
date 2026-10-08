import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The levels a cycle uses (P9-T07a-c, METHOD v2 §2.7).
 *
 * "A change applies to cycles that start after it: a running or closed cycle
 * keeps the levels it began with, so no objective is ever left at a level
 * that no longer exists." A cycle is given the practice's levels when it is
 * created, a change reaches only the cycles that have not started, an
 * objective at a level its cycle does not use is refused from every surface,
 * and a level an objective already has is always offered.
 */

const OWNER = "levels-owner";

let workspaceId: string;
let ownerMemberId: string;
let runningId: string;
let futureId: string;

async function call<T>(action: string, input: unknown): Promise<T> {
  return (await callAction(
    {
      pool: (await workerDb()).appPool,
      workspaceId,
      actor: { kind: "human" as const, userId: OWNER },
    },
    action as never,
    input as never,
  )) as T;
}

const levelsOf = async (cycleId: string) =>
  (await call<{ levels: string[] }>("cycles.levelsInUse", { cycleId })).levels;

const objective = (cycleId: string, level: string) =>
  call<{ id: string }>("goals.create", {
    title: "Make onboarding the reason teams stay",
    cycleId,
    level,
    ownerKind: "workspace",
    championId: ownerMemberId,
  });

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Levels Owner", "levels-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Levels Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
  // Provisioning makes the current quarter, which has started.
  runningId = (
    await call<{ id: string }>("cycles.current", {
      mode: "quarterly",
    })
  ).id;
  futureId = (
    await call<{ id: string }>("cycles.create", {
      on: `${new Date().getUTCFullYear() + 2}-05-15`,
      mode: "quarterly",
    })
  ).id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the levels a cycle begins with", () => {
  it("are the practice's levels when it is created", async () => {
    expect(await levelsOf(futureId)).toEqual(["company", "department", "team"]);
  });

  it("acceptance: turning individual OKRs on reaches the next quarter and not the running one", async () => {
    await call("practice.update", { overrides: { "levels.individual": "on" } });
    expect(await levelsOf(runningId)).toEqual([
      "company",
      "department",
      "team",
    ]);
    expect(await levelsOf(futureId)).toEqual([
      "company",
      "department",
      "team",
      "individual",
    ]);
  });

  it("a profile that changes the levels reaches the cycles that have not started too", async () => {
    // Google-style uses company, team and individual.
    await call("practice.applyProfile", { profile: "googleStyle" });
    expect(await levelsOf(futureId)).toEqual(["company", "team", "individual"]);
    expect(await levelsOf(runningId)).toEqual([
      "company",
      "department",
      "team",
    ]);
  });
});

describe("an objective at a level its cycle does not use", () => {
  it("is refused with the reason, and allowed where the cycle uses it", async () => {
    await call("practice.update", { overrides: { "levels.individual": "on" } });
    await expect(objective(runningId, "individual")).rejects.toThrow(
      /has no place in it/,
    );
    await expect(objective(futureId, "individual")).resolves.toBeTruthy();
  });

  it("keeps a level an objective already has, after the level is turned off", async () => {
    await objective(futureId, "department");
    await call("practice.update", {
      overrides: { "levels.department": "off" },
    });
    // Turned off for cycles that have not started, and this one has not; the
    // department objective in it still has its level offered.
    expect(await levelsOf(futureId)).toEqual(["company", "department", "team"]);
  });
});
