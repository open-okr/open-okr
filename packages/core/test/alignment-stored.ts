import { workerDb } from "@openokr/test-support/db";
import { expect } from "vitest";
import { callAction } from "../src/actions/registry.ts";

/**
 * Stored equals computed (design `alignment-engine.md` §10, D7, plan 0.7.0
 * D2).
 *
 * A projection goes wrong quietly: the row stays, and nothing says it stopped
 * matching the rows it was computed from. So every stored score in the
 * workspace is held to what `alignment.read` computes from the graph, and
 * every scope that has goals must have a row, because every structural write
 * stores one. Shared by `alignment-scores.test.ts` and the alignment suite.
 */

export interface StoredScore {
  readonly cycle_id: string;
  readonly scope: "workspace" | "space";
  readonly scope_id: string | null;
  readonly score: number | null;
  readonly breakdown: {
    readonly measured: number;
    readonly withParent: number;
    readonly standingAlone: number;
    readonly unaligned: number;
    readonly anchored: boolean;
  };
  readonly computed_at: Date;
}

async function storedScores(workspaceId: string): Promise<StoredScore[]> {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<StoredScore>(
    `select cycle_id, scope, scope_id, score, breakdown, computed_at
       from alignment_scores where workspace_id = $1`,
    [workspaceId],
  );
  return rows;
}

export async function storedScore(
  workspaceId: string,
  cycleId: string,
  spaceId?: string,
): Promise<StoredScore | undefined> {
  return (await storedScores(workspaceId)).find(
    (row) =>
      row.cycle_id === cycleId &&
      row.scope === (spaceId ? "space" : "workspace") &&
      row.scope_id === (spaceId ?? null),
  );
}

/**
 * Every stored row agrees with the live computation, and no scope with goals
 * is missing one. `userId` reads as a member who sees every goal: the score
 * counts goals a reader cannot see, and so does this.
 */
export async function expectStoredEqualsComputed(
  workspaceId: string,
  userId: string,
): Promise<void> {
  const wb = await workerDb();
  const context = {
    pool: wb.appPool,
    workspaceId,
    actor: { kind: "human" as const, userId },
  };

  const { rows: scopes } = await wb.admin.query<{
    cycle_id: string;
    space_id: string | null;
  }>(
    `select distinct cycle_id, null::uuid as space_id from goals
      where workspace_id = $1 and deleted_at is null and cycle_id is not null
     union
     select distinct cycle_id, space_id from goals
      where workspace_id = $1 and deleted_at is null and cycle_id is not null
        and space_id is not null`,
    [workspaceId],
  );
  const stored = await storedScores(workspaceId);
  for (const scope of scopes) {
    const found = stored.find(
      (row) =>
        row.cycle_id === scope.cycle_id && row.scope_id === scope.space_id,
    );
    expect(
      found,
      `a stored score for cycle ${scope.cycle_id}, space ${scope.space_id}`,
    ).toBeDefined();
  }

  for (const row of stored) {
    const where = `${row.scope} ${row.scope_id ?? ""} in ${row.cycle_id}`;
    const scope = row.scope_id ? { spaceId: row.scope_id } : {};
    const live = await callAction(context, "alignment.read", {
      cycleId: row.cycle_id,
      includeDismissed: false,
      ...scope,
    });
    expect(row.score, where).toBe(live.score);
    expect(row.breakdown.measured, where).toBe(live.measured);
    expect(row.breakdown.withParent + row.breakdown.standingAlone, where).toBe(
      live.counted,
    );
    expect(row.breakdown.unaligned, where).toBe(live.measured - live.counted);
    expect(row.breakdown.anchored, where).toBe(live.anchored);

    const read = await callAction(context, "alignment.score", {
      cycleId: row.cycle_id,
      ...scope,
    });
    expect(read.score, where).toBe(live.score);
    expect(read.band, where).toBe(live.band);
    expect(read.computedAt, where).not.toBeNull();
  }
}
