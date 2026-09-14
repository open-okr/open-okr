import { newId } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { describe, expect, it } from "vitest";
import { ACTION_MAP, callAction } from "../src/actions/registry.ts";
import {
  buildLargeDataset,
  type LargeDatasetCounts,
} from "../src/perf/large-dataset.ts";
import {
  countingPool,
  KNOWN_QUERY_PER_ROW,
  LIST_BUDGETS,
} from "../src/perf/query-budget.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The query-count budget on list endpoints (P7-T01a, TECHNICAL-PLAN §13.2).
 *
 * **Two assertions, and the second is the one that earns its keep.** A ceiling
 * catches a list that suddenly issues sixty statements. It does not catch the
 * failure that actually happens: a list issuing one statement per row costs
 * five at a test fixture's handful of rows, passes any sane ceiling, and costs
 * a thousand in production. So each action is measured twice, at a small
 * result set and at one ten times larger, and the count has to be identical.
 * An action whose cost moves with its row count is walking its own results,
 * whatever its absolute number is.
 */

const SMALL = {
  spaces: 2,
  members: 4,
  cycles: 2,
  goals: 5,
  keyResults: 5,
  initiatives: 3,
  tasks: 10,
} as const;

const LARGER = {
  spaces: 2,
  members: 4,
  cycles: 2,
  goals: 50,
  keyResults: 50,
  initiatives: 30,
  tasks: 100,
} as const;

interface Fixture {
  readonly workspaceId: string;
  readonly userId: string;
}

async function filledWorkspace(counts: LargeDatasetCounts): Promise<Fixture> {
  const wb = await workerDb();
  const userId = newId();
  await wb.appPool.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [userId, "Budget", `${userId.slice(0, 13)}@example.com`],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: userId,
    name: `Budget ${userId.slice(0, 8)}`,
  });
  await buildLargeDataset({
    pool: wb.appPool,
    workspaceId: provisioned.workspaceId,
    counts,
    batchSize: 100,
    nodeEnv: "test",
  });
  return { workspaceId: provisioned.workspaceId, userId };
}

/** Runs one action against one fixture and reports what it cost. */
async function cost(
  fixture: Fixture,
  action: string,
  input: Record<string, unknown>,
): Promise<{ queries: number; statements: readonly string[] }> {
  const wb = await workerDb();
  const counter = countingPool(wb.appPool);
  await callAction(
    {
      pool: counter.pool,
      workspaceId: fixture.workspaceId,
      actor: { kind: "human", userId: fixture.userId },
    } as never,
    action as never,
    input as never,
  );
  return { queries: counter.count(), statements: counter.statements() };
}

describe("the list budget itself", () => {
  it("names only actions the registry still has", () => {
    // A renamed action would otherwise leave a budget silently guarding
    // nothing, which is the failure mode every exemption list has.
    const missing = LIST_BUDGETS.map((budget) => budget.action).filter(
      (name) => !Object.keys(ACTION_MAP).includes(name),
    );
    expect(missing).toEqual([]);
  });

  it("covers the lists a person actually opens", () => {
    // Not every list in the registry: the ones on a screen somebody loads.
    // A floor rather than a fixed set, so adding a budget never fails here.
    expect(LIST_BUDGETS.length).toBeGreaterThanOrEqual(8);
  });
});

describe("list endpoints stay inside their query budget", () => {
  for (const budget of LIST_BUDGETS) {
    it(`${budget.action} costs at most ${budget.queries} queries`, async () => {
      const fixture = await filledWorkspace(SMALL);
      const measured = await cost(fixture, budget.action, budget.input);

      expect(
        measured.queries,
        `${budget.action} issued ${measured.queries} statements:\n${measured.statements.join("\n")}`,
      ).toBeLessThanOrEqual(budget.queries);
    });
  }
});

describe("list endpoints do not issue a query per row", () => {
  for (const budget of LIST_BUDGETS.filter(
    (one) => !KNOWN_QUERY_PER_ROW.includes(one.action),
  )) {
    it(`${budget.action} costs the same at ten times the rows`, async () => {
      const small = await filledWorkspace(SMALL);
      const larger = await filledWorkspace(LARGER);

      const atSmall = await cost(small, budget.action, budget.input);
      const atLarger = await cost(larger, budget.action, budget.input);

      expect(
        atLarger.queries,
        `${budget.action} cost ${atSmall.queries} at ${SMALL.goals} goals and ${atLarger.queries} at ${LARGER.goals}. A cost that moves with the row count is an N+1.`,
      ).toBe(atSmall.queries);
    });
  }
});

describe("the known query-per-row list", () => {
  it("is reported, so an empty one is visible rather than silent", () => {
    // P7-T01a found three and P7-T01b fixed all three, so this is [] today.
    // Kept as a reported number rather than an assertion that it stays empty:
    // a future list may legitimately need an entry, and the point of the list
    // is that adding one is a visible decision.
    expect(KNOWN_QUERY_PER_ROW.length).toBeLessThanOrEqual(3);
  });

  for (const action of KNOWN_QUERY_PER_ROW) {
    it(`${action} still grows with its rows, or this entry is stale`, async () => {
      const budget = LIST_BUDGETS.find((one) => one.action === action);
      if (!budget) {
        throw new Error(`${action} is on the known list but has no budget.`);
      }
      const small = await filledWorkspace(SMALL);
      const larger = await filledWorkspace(LARGER);

      const atSmall = await cost(small, action, budget.input);
      const atLarger = await cost(larger, action, budget.input);

      // Deliberately asserting the defect is still there. An exemption that
      // outlives the problem it was written for is how a gate quietly stops
      // gating: fixing this action fails here, and the fix is to delete its
      // entry from KNOWN_QUERY_PER_ROW.
      expect(
        atLarger.queries,
        `${action} no longer costs more at more rows (${atSmall.queries} then ${atLarger.queries}). Remove it from KNOWN_QUERY_PER_ROW.`,
      ).toBeGreaterThan(atSmall.queries);
    });
  }
});
