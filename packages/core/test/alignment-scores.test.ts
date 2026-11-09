import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { fillAlignmentScores } from "../src/alignment/fill.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";
import { expectStoredEqualsComputed, storedScore } from "./alignment-stored.ts";

/**
 * The stored alignment score (design `alignment-engine.md` §10, plan 0.7.0
 * D2).
 *
 * `recomputeAlignment` stores the latest score per scope per cycle in the
 * writing transaction, and `alignment.score` reads that one row instead of
 * the graph. The band is read from the cycle's thresholds when the row is
 * read, never stored. A scope with no row yet is computed on read and not
 * stored; the hourly fill stores it. What only rows can settle is checked
 * here: that every structural write stores the live answer, that a parent
 * deleted in one cycle moves the cycles hanging from it, the band, access,
 * the read fallback and the fill.
 */

const OWNER = "scores-owner";

let workspaceId: string;
let cycleId: string;
let ownerMemberId: string;
let spaceA: string;
let spaceB: string;

const context = (userId = OWNER) => ({
  workspaceId,
  actor: { kind: "human" as const, userId },
});

const call = async (
  name: string,
  input: Record<string, unknown>,
  userId = OWNER,
) => {
  const wb = await workerDb();
  return callAction(
    { pool: wb.appPool, ...context(userId) },
    name as never,
    input as never,
  ) as Promise<Record<string, unknown>>;
};

const richText = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

async function makeGoal(input: {
  title: string;
  level: "company" | "department" | "team" | "individual";
  spaceId?: string;
  parentGoalId?: string;
  parentKeyResultId?: string;
  cycle?: string;
}): Promise<string> {
  const goal = await call("goals.create", {
    title: input.title,
    cycleId: input.cycle ?? cycleId,
    level: input.level,
    ownerKind: input.spaceId ? "space" : "workspace",
    ...(input.spaceId ? { spaceId: input.spaceId } : {}),
    ...(input.parentGoalId ? { parentGoalId: input.parentGoalId } : {}),
    ...(input.parentKeyResultId
      ? { parentKeyResultId: input.parentKeyResultId }
      : {}),
    championId: ownerMemberId,
    reviewerId: ownerMemberId,
    weight: 1,
  });
  await call("goals.addKeyResult", {
    goalId: goal.id,
    title: `${input.title}: measure`,
    direction: "increase",
    indicatorType: "leading",
    baselineValue: 0,
    targetValue: 100,
    weight: 1,
  });
  return goal.id as string;
}

const score = (spaceId?: string, userId = OWNER, cycle = cycleId) =>
  call(
    "alignment.score",
    { cycleId: cycle, ...(spaceId ? { spaceId } : {}) },
    userId,
  ) as Promise<{
    score: number | null;
    band: string | null;
    breakdown: {
      measured: number;
      withParent: number;
      standingAlone: number;
      unaligned: number;
      anchored: boolean;
    };
    computedAt: string | null;
  }>;

const held = () => expectStoredEqualsComputed(workspaceId, OWNER);

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Owner", "scores-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
  const current = await call("cycles.current", { mode: "quarterly" });
  cycleId = current.id as string;
  spaceA = (await call("spaces.create", { name: "Revenue" })).id as string;
  spaceB = (await call("spaces.create", { name: "Product" })).id as string;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the score a write stores", () => {
  it("acceptance: re-parenting the fourth goal stores 100 in that write, and the read computes 100", async () => {
    const company = await makeGoal({
      title: "Win the market",
      level: "company",
    });
    const d1 = await makeGoal({
      title: "Revenue",
      level: "department",
      spaceId: spaceA,
      parentGoalId: company,
    });
    await makeGoal({
      title: "Product",
      level: "department",
      spaceId: spaceB,
      parentGoalId: company,
    });
    await makeGoal({
      title: "Close deals",
      level: "team",
      spaceId: spaceA,
      parentGoalId: d1,
    });
    const fourth = await makeGoal({
      title: "Hire",
      level: "team",
      spaceId: spaceA,
    });

    const before = await storedScore(workspaceId, cycleId);
    expect(before?.score).toBe(75);
    expect(before?.breakdown).toEqual({
      measured: 4,
      withParent: 3,
      standingAlone: 0,
      unaligned: 1,
      anchored: true,
    });

    await call("goals.update", { id: fourth, parentGoalId: d1 });

    const after = await storedScore(workspaceId, cycleId);
    expect(after?.score).toBe(100);
    expect(after?.computed_at.getTime()).toBeGreaterThanOrEqual(
      before?.computed_at.getTime() ?? 0,
    );
    const live = await call("alignment.read", {
      cycleId,
      includeDismissed: false,
    });
    expect(live.score).toBe(100);
    const read = await score();
    expect(read).toMatchObject({ score: 100, band: "healthy" });
    expect(read.computedAt).not.toBeNull();
    await held();
  });

  it("is stored by every structural write and always equals the live answer (§7)", async () => {
    const company = await makeGoal({
      title: "Win the market",
      level: "company",
    });
    await held();
    const d1 = await makeGoal({
      title: "Revenue",
      level: "department",
      spaceId: spaceA,
      parentGoalId: company,
    });
    await held();
    const team = await makeGoal({
      title: "Close deals",
      level: "team",
      spaceId: spaceA,
    });
    await held();

    // A reason to stand alone counts, and the breakdown says which way.
    await call("goals.update", { id: team, standaloneReason: "Statutory" });
    await held();
    expect(
      (await storedScore(workspaceId, cycleId, spaceA))?.breakdown,
    ).toEqual({
      measured: 2,
      withParent: 1,
      standingAlone: 1,
      unaligned: 0,
      anchored: true,
    });
    // A parent replaces the reason.
    await call("goals.update", { id: team, parentGoalId: d1 });
    await held();

    const d2 = await makeGoal({
      title: "Product",
      level: "department",
      spaceId: spaceB,
    });
    await held();

    const link = await call("goals.addDependency", {
      fromGoalId: d1,
      toGoalId: d2,
    });
    await held();
    await call("goals.removeDependency", { id: link.id });
    await held();

    const keyResult = (
      (await call("goals.read", { id: d1 })) as {
        keyResults: { id: string }[];
      }
    ).keyResults[0]?.id as string;
    await call("goals.addKeyResultDependency", {
      keyResultId: keyResult,
      providerSpaceId: spaceB,
    });
    await held();

    await call("goals.close", {
      id: team,
      successStatus: "achieved",
      closeDecision: "achieved",
      retrospectiveBody: richText("Done."),
    });
    await held();
    await call("goals.reopen", { id: team });
    await held();

    await call("goals.moveToSpace", { id: team, spaceId: spaceB });
    await held();

    // The delete stores too. It is the one §7 write that did not recompute
    // before D2, which nobody could see while every read computed live.
    await call("goals.delete", { id: d2 });
    await held();
    expect(
      (await storedScore(workspaceId, cycleId, spaceB))?.breakdown,
    ).toEqual({
      measured: 1,
      withParent: 1,
      standingAlone: 0,
      unaligned: 0,
      anchored: true,
    });
    await call("goals.restore", { id: d2 });
    await held();
  });

  it("follows a parent deleted in another cycle into the cycle hanging from it", async () => {
    // An annual company objective, with this quarter's goals hung under it
    // and under its key result (§5.1). Deleting it unaligns them, in a cycle
    // the delete itself does not belong to.
    const year = await call("cycles.create", {
      on: `${new Date().getUTCFullYear()}-06-30`,
      mode: "annual",
    });
    const annual = await makeGoal({
      title: "Lead the market",
      level: "company",
      cycle: year.id as string,
    });
    const annualKeyResult = (
      (await call("goals.read", { id: annual })) as {
        keyResults: { id: string }[];
      }
    ).keyResults[0]?.id as string;
    await makeGoal({
      title: "Revenue",
      level: "department",
      spaceId: spaceA,
      parentGoalId: annual,
    });
    await makeGoal({
      title: "Product",
      level: "department",
      spaceId: spaceB,
      parentKeyResultId: annualKeyResult,
    });
    expect((await storedScore(workspaceId, cycleId))?.score).toBe(100);
    await held();

    await call("goals.removeKeyResult", { id: annualKeyResult });
    expect((await storedScore(workspaceId, cycleId))?.score).toBe(50);
    await held();
    await call("goals.restoreKeyResult", { id: annualKeyResult });
    expect((await storedScore(workspaceId, cycleId))?.score).toBe(100);
    await held();

    await call("goals.delete", { id: annual });
    const orphaned = await storedScore(workspaceId, cycleId);
    expect(orphaned?.score).toBe(0);
    expect(orphaned?.breakdown.anchored).toBe(false);
    await held();
    await call("goals.restore", { id: annual });
    expect((await storedScore(workspaceId, cycleId))?.score).toBe(100);
    await held();

    // A level is what anchors: an annual objective that stops being a
    // company one stops anchoring the quarter hanging from it.
    await call("goals.update", { id: annual, level: "department" });
    expect((await storedScore(workspaceId, cycleId))?.breakdown.anchored).toBe(
      false,
    );
    await held();
  });
});

describe("reading the stored score", () => {
  async function seventyFive(): Promise<void> {
    const company = await makeGoal({
      title: "Win the market",
      level: "company",
    });
    const d1 = await makeGoal({
      title: "Revenue",
      level: "department",
      spaceId: spaceA,
      parentGoalId: company,
    });
    await makeGoal({
      title: "Product",
      level: "department",
      spaceId: spaceB,
      parentGoalId: company,
    });
    await makeGoal({
      title: "Close deals",
      level: "team",
      spaceId: spaceA,
      parentGoalId: d1,
    });
    await makeGoal({ title: "Hire", level: "team", spaceId: spaceA });
  }

  it("acceptance: reads the band from the current thresholds, with no recompute", async () => {
    await seventyFive();
    const stored = await storedScore(workspaceId, cycleId);
    expect((await score()).band).toBe("gap");

    await call("rhythm.update", {
      overrides: { "alignment.watchThreshold": 70 },
    });

    expect(await score()).toMatchObject({ score: 75, band: "watch" });
    // Nothing was recomputed: the row is the one the last write left.
    expect((await storedScore(workspaceId, cycleId))?.computed_at).toEqual(
      stored?.computed_at,
    );
    // And the live read agrees, so stored still equals computed.
    await held();
  });

  it("computes a scope with no stored row, and stores nothing", async () => {
    await seventyFive();
    const wb = await workerDb();
    await wb.admin.query(
      "delete from alignment_scores where workspace_id = $1",
      [workspaceId],
    );

    const read = await score();
    expect(read).toMatchObject({
      score: 75,
      band: "gap",
      breakdown: {
        measured: 4,
        withParent: 3,
        standingAlone: 0,
        unaligned: 1,
        anchored: true,
      },
      computedAt: null,
    });
    expect(await storedScore(workspaceId, cycleId)).toBeUndefined();
  });

  it("has no score for a cycle with no goals", async () => {
    expect(await score()).toMatchObject({
      score: null,
      band: null,
      computedAt: null,
    });
  });

  it("acceptance: answers not found for a space the reader cannot see", async () => {
    await seventyFive();
    // A guest of one space, through the invitation a guest actually receives.
    const wb = await workerDb();
    const guest = "scores-guest";
    const email = "scores-guest@partner.example";
    await wb.admin.query(
      "insert into users (id, name, email) values ($1, $2, $3)",
      [guest, "Guest", email],
    );
    const link = await call("invitations.createPersonalLink", {
      email,
      guestSpaceId: spaceA,
    });
    await call("invitations.acceptLink", { token: link.token }, guest);

    await expect(score(spaceB, guest)).rejects.toThrow(/No such space/);
    expect((await score(spaceA, guest)).score).toBe(
      (await score(spaceA)).score,
    );
    // The workspace's score is a fact about the cycle, readable by any
    // member, as `alignment.read` has always given it to the Work Map.
    expect((await score(undefined, guest)).score).toBe(75);
  });
});

describe("filling the scopes no write has stored", () => {
  it("fills every cycle and space with goals through the recompute, once", async () => {
    const company = await makeGoal({
      title: "Win the market",
      level: "company",
    });
    await makeGoal({
      title: "Revenue",
      level: "department",
      spaceId: spaceA,
      parentGoalId: company,
    });
    await makeGoal({ title: "Product", level: "department", spaceId: spaceB });
    // A cycle with nothing in it gets no row: there is nothing to score.
    await call("cycles.create", {
      on: `${new Date().getUTCFullYear()}-06-30`,
      mode: "annual",
    });

    const wb = await workerDb();
    await wb.admin.query(
      "delete from alignment_scores where workspace_id = $1",
      [workspaceId],
    );

    const first = await fillAlignmentScores(wb.appPool);
    expect(first).toEqual({ workspaces: 1, filled: 3 });
    await held();
    const { rows } = await wb.admin.query<{ n: number }>(
      "select count(*)::int as n from alignment_scores where workspace_id = $1",
      [workspaceId],
    );
    expect(rows[0]?.n).toBe(3);

    const second = await fillAlignmentScores(wb.appPool);
    expect(second).toEqual({ workspaces: 1, filled: 0 });
  });

  it("leaves a row a write already stored", async () => {
    await makeGoal({ title: "Win the market", level: "company" });
    await makeGoal({ title: "Hire", level: "team", spaceId: spaceA });
    const before = await storedScore(workspaceId, cycleId);

    const wb = await workerDb();
    expect(await fillAlignmentScores(wb.appPool)).toEqual({
      workspaces: 1,
      filled: 0,
    });
    expect((await storedScore(workspaceId, cycleId))?.computed_at).toEqual(
      before?.computed_at,
    );
  });
});
