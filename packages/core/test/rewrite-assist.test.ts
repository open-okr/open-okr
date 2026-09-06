import type { AgentDrafter } from "@openokr/core";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The rewrite assist (METHOD.md §4, P4-T06c).
 *
 * The task's test plan is two sentences: the assist commits nothing until
 * applied, and with AI off the surface explains rather than disappearing. The
 * acceptance criterion is the measurability case.
 *
 * **The interesting test is the dishonest one.** A model asked to fix KR-2 will
 * say it fixed KR-2 whatever it wrote, so the action re-runs §4 over the
 * suggestion and reports what genuinely passes. A stand-in that returns a
 * rewrite fixing nothing is the only way to prove the product is checking
 * rather than believing.
 */

const OWNER = "rewrite-owner";

let workspaceId: string;
let cycleId: string;
let spaceId: string;
let ownerMemberId: string;
let goalId: string;

const context = (drafter?: AgentDrafter) => ({
  workspaceId,
  actor: { kind: "human" as const, userId: OWNER },
  ...(drafter ? { drafter } : {}),
});

/** A drafter that returns exactly the sentence a test hands it. */
const suggesting = (text: string): AgentDrafter => ({
  async rewriteForRule() {
    return text;
  },
  spentUsd: () => 0.001,
});

const addKeyResult = async (title: string) => {
  const wb = await workerDb();
  return (await callAction(
    { pool: wb.appPool, ...context() },
    "goals.addKeyResult",
    {
      goalId,
      title,
      direction: "increase",
      indicatorType: "leading",
      baselineValue: 100,
      targetValue: 300,
      unit: "teams",
      weight: 1,
    },
  )) as { id: string };
};

const assist = async (
  keyResultId: string,
  ruleId: string,
  d?: AgentDrafter,
) => {
  const wb = await workerDb();
  return (await callAction(
    { pool: wb.appPool, ...context(d) },
    "goals.rewriteKeyResult",
    { keyResultId, ruleId },
  )) as {
    text: string;
    nowPassing: string[];
    fixesTheRule: boolean;
  } | null;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Rewrite Owner", "rewrite-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Rewrite Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;

  const spaces = (await callAction(
    { pool: wb.appPool, ...context() },
    "spaces.list",
    {},
  )) as { id: string }[];
  spaceId = spaces[0]?.id as string;
  const current = (await callAction(
    { pool: wb.appPool, ...context() },
    "cycles.current",
    { mode: "quarterly" },
  )) as { id: string };
  cycleId = current.id;

  const goal = (await callAction(
    { pool: wb.appPool, ...context() },
    "goals.create",
    {
      title: "Become the preferred platform for mid-market teams",
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: ownerMemberId,
      reviewerId: ownerMemberId,
      weight: 1,
    },
  )) as { id: string };
  goalId = goal.id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("with no provider", () => {
  it("returns nothing rather than failing, so the surface can explain", async () => {
    const kr = await addKeyResult("Improve onboarding");
    // Null, not an error. A surface that threw would show a failure where the
    // honest answer is "this needs a provider you have not configured".
    expect(await assist(kr.id, "KR-2")).toBeNull();
  });
});

describe("with a provider", () => {
  it("reports the rule as fixed only when §4 agrees", async () => {
    // KR-2 is measurability. "Improve onboarding" carries no number.
    const kr = await addKeyResult("Improve onboarding");

    const honest = await assist(
      kr.id,
      "KR-2",
      suggesting("Cut median onboarding time from 9 days to 2 days"),
    );
    expect(honest?.fixesTheRule).toBe(true);
    expect(honest?.nowPassing).toContain("KR-2");
    expect(honest?.text).toContain("2 days");
  });

  it("refuses to take the model's word when the rewrite fixes nothing", async () => {
    const kr = await addKeyResult("Improve onboarding");

    // A plausible sentence that is no more measurable than the original. A
    // model asked to fix KR-2 would still say it had.
    const empty = await assist(
      kr.id,
      "KR-2",
      suggesting("Substantially improve the onboarding experience"),
    );
    expect(empty?.fixesTheRule).toBe(false);
    expect(empty?.nowPassing).not.toContain("KR-2");
    // The suggestion is still returned. A writer may want it anyway; what the
    // product will not do is claim it satisfied a rule it did not.
    expect(empty?.text).toBe("Substantially improve the onboarding experience");
  });

  it("commits nothing", async () => {
    const kr = await addKeyResult("Improve onboarding");
    await assist(
      kr.id,
      "KR-2",
      suggesting("Cut median onboarding time from 9 days to 2 days"),
    );

    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ title: string }>(
      "select title from key_results where id = $1",
      [kr.id],
    );
    // The whole point of an assist. A version that saved would be an agent
    // writing under somebody else's name.
    expect(rows[0]?.title).toBe("Improve onboarding");
  });

  it("refuses a rule the method package does not define", async () => {
    const kr = await addKeyResult("Improve onboarding");
    await expect(
      assist(kr.id, "KR-99", suggesting("anything")),
    ).rejects.toThrow(/not a check/i);
  });

  it("reports nothing when the drafter has no rewrite capability", async () => {
    const kr = await addKeyResult("Improve onboarding");
    // Every capability is optional: a host may draft check-ins and not
    // rewrite, and a missing capability reads the same as one that declined.
    const noRewrite: AgentDrafter = { spentUsd: () => 0 };
    expect(await assist(kr.id, "KR-2", noRewrite)).toBeNull();
  });

  it("clears the stored verdict once the champion applies it", async () => {
    // What makes the button worth pressing. The apply path is the ordinary
    // edit action, so P4-T02a re-evaluates in the same transaction and the
    // flag the strip is showing goes away by itself. Nothing in P4-T06c
    // writes a quality flag of its own, and this is the test that would fail
    // if something started to.
    const wb = await workerDb();
    const kr = await addKeyResult("Improve onboarding");

    const before = await wb.admin.query<{ quality_flags: string[] }>(
      "select quality_flags from key_results where id = $1",
      [kr.id],
    );
    expect(before.rows[0]?.quality_flags).toContain("KR-2");

    const suggestion = await assist(
      kr.id,
      "KR-2",
      suggesting("Cut median onboarding time from 9 days to 2 days"),
    );
    await callAction(
      { pool: wb.appPool, ...context() },
      "goals.updateKeyResult",
      { id: kr.id, title: suggestion?.text as string },
    );

    const after = await wb.admin.query<{ quality_flags: string[] }>(
      "select quality_flags from key_results where id = $1",
      [kr.id],
    );
    expect(after.rows[0]?.quality_flags).not.toContain("KR-2");
  });
});
