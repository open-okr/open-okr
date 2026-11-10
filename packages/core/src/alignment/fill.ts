/**
 * Stores the alignment scores no write has stored yet (design
 * `alignment-engine.md` §10, plan 0.7.0 D2).
 *
 * Every structural write stores its scope's score, so a missing row means a
 * scope nothing has written to since 0.7.0: on an upgraded instance, every
 * cycle planned before it. `alignment.score` computes such a scope on read,
 * so nobody sees a wrong answer while it waits; this is what stores it, run
 * hourly by the scheduler and by `pnpm alignment:fill`.
 *
 * **Through `recomputeAlignment`, never a copy of the share.** The share is a
 * METHOD.md §5.2 rule and lives in `packages/method` alone, which is why this
 * is not a data change: `packages/db` cannot reach either package, and a
 * data change that repeated the rule in SQL would be the second copy the
 * repository forbids.
 *
 * **One workspace at a time, inside its own tenant setting**, as
 * `measureAllWorkspaces` counts. Each scope is its own transaction, so a
 * large cycle does not hold the others back, and a scope a concurrent write
 * stored first keeps that write's row (`keepStored`).
 */
import {
  activeOnly,
  alignmentScores,
  cycles,
  goals,
  withWorkspace,
} from "@openokr/db";
import type { AlignmentScope } from "@openokr/method";
import { and, eq, exists, isNotNull, isNull, notExists } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { OperationTx } from "../operations/operation.ts";
import { listLiveWorkspaces } from "../workspaces/scan.ts";
import { recomputeAlignment } from "./service.ts";

export interface FillResult {
  /** Workspaces looked at. */
  readonly workspaces: number;
  /** Scopes stored, across all of them. */
  readonly filled: number;
}

interface MissingScope {
  readonly cycleId: string;
  readonly scope: AlignmentScope;
}

export async function fillAlignmentScores(
  pool: Pool,
  options: {
    /** Only these workspaces, as `pnpm db:seed:large` asks for its own. */
    readonly workspaceIds?: readonly string[];
  } = {},
): Promise<FillResult> {
  const ids =
    options.workspaceIds ??
    (await listLiveWorkspaces(pool)).map((workspace) => workspace.id);
  const db = drizzle(pool);
  let filled = 0;
  for (const workspaceId of ids) {
    const missing = await withWorkspace(db, workspaceId, (tx) =>
      missingScopes(tx as OperationTx, workspaceId),
    );
    for (const { cycleId, scope } of missing) {
      await withWorkspace(db, workspaceId, (tx) =>
        recomputeAlignment(
          tx as OperationTx,
          { workspaceId, cycleId, scope },
          { keepStored: true },
        ),
      );
      filled++;
    }
  }
  return { workspaces: ids.length, filled };
}

/**
 * Each live cycle with goals that has no workspace row, and each space with
 * goals in it that has no row of its own. A scope with no goals has nothing to
 * store: `alignment.score` reads it as no score, which is what it is.
 */
async function missingScopes(
  tx: OperationTx,
  workspaceId: string,
): Promise<MissingScope[]> {
  const liveCycle = exists(
    tx
      .select({ id: cycles.id })
      .from(cycles)
      .where(activeOnly(cycles, eq(cycles.id, goals.cycleId))),
  );
  const stored = (scope: "workspace" | "space") =>
    tx
      .select({ id: alignmentScores.id })
      .from(alignmentScores)
      .where(
        and(
          eq(alignmentScores.workspaceId, workspaceId),
          eq(alignmentScores.cycleId, goals.cycleId),
          eq(alignmentScores.scope, scope),
          scope === "workspace"
            ? isNull(alignmentScores.scopeId)
            : eq(alignmentScores.scopeId, goals.spaceId),
        ),
      );

  const workspaceScopes = await tx
    .selectDistinct({ cycleId: goals.cycleId })
    // openokr:allow-raw-read: a scheduled fill has no acting member, and it
    // reads only which cycles hold goals. The score counts every goal whoever
    // can see it, as every structural write does.
    .from(goals)
    .where(
      activeOnly(
        goals,
        eq(goals.workspaceId, workspaceId),
        isNotNull(goals.cycleId),
        liveCycle,
        notExists(stored("workspace")),
      ),
    );
  const spaceScopes = await tx
    .selectDistinct({ cycleId: goals.cycleId, spaceId: goals.spaceId })
    // openokr:allow-raw-read: as above, which spaces hold goals in a cycle.
    .from(goals)
    .where(
      activeOnly(
        goals,
        eq(goals.workspaceId, workspaceId),
        isNotNull(goals.cycleId),
        isNotNull(goals.spaceId),
        liveCycle,
        notExists(stored("space")),
      ),
    );

  return [
    ...workspaceScopes.flatMap((row) =>
      row.cycleId
        ? [{ cycleId: row.cycleId, scope: { kind: "workspace" as const } }]
        : [],
    ),
    ...spaceScopes.flatMap((row) =>
      row.cycleId && row.spaceId
        ? [
            {
              cycleId: row.cycleId,
              scope: { kind: "space" as const, spaceId: row.spaceId },
            },
          ]
        : [],
    ),
  ];
}
