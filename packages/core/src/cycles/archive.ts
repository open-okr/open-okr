import {
  activeOnly,
  cycleIssues,
  cyclePriorScores,
  cycles,
  goals,
  includeDeleted,
  keyResults,
  newId,
  performanceSnapshots,
} from "@openokr/db";
import {
  portfolioVerdictOf,
  type ResolvedThresholds,
  round2,
  type ScoreBand,
  scoreBand,
} from "@openokr/method";
import { eq, inArray, isNull } from "drizzle-orm";
import { OperationError, type OperationTx } from "../operations/operation.ts";

/**
 * Closing a cycle and opening the next one (METHOD.md §8.9, TECHNICAL-PLAN §4.6,
 * P3-T15).
 *
 * Two operations that are deliberately separate. Archiving records what
 * happened; the feed-forward decides what the next cycle inherits. A team may
 * archive without having opened the next cycle yet, and running the two
 * together would make the second impossible.
 *
 * Both are idempotent. A facilitator who clicks twice, or a job that retries,
 * must not double the trend or the issue list.
 */

interface Scored {
  readonly goalId: string;
  readonly spaceId: string | null;
  readonly championId: string | null;
  readonly score: number;
}

/** Every scored key result in the cycle, with the goal that owns it. */
async function loadScores(
  tx: OperationTx,
  workspaceId: string,
  cycleId: string,
): Promise<Scored[]> {
  const rows = await tx
    .select({
      goalId: goals.id,
      spaceId: goals.spaceId,
      championId: goals.championId,
      score: keyResults.score,
    })
    .from(keyResults)
    .innerJoin(goals, eq(goals.id, keyResults.goalId))
    .where(
      activeOnly(
        keyResults,
        eq(keyResults.workspaceId, workspaceId),
        eq(goals.cycleId, cycleId),
      ),
    );

  // An unscored key result is left out rather than counted as zero. §8 scores
  // at the review, and a key result nobody reached is not a key result that
  // failed: averaging in a zero for it would report a worse cycle than happened.
  return rows
    .filter((row) => row.score !== null)
    .map((row) => ({
      goalId: row.goalId,
      spaceId: row.spaceId,
      championId: row.championId,
      score: Number(row.score),
    }));
}

interface Buckets {
  readonly fully_achieved: number;
  readonly strong: number;
  readonly partial: number;
  readonly little: number;
}

function bucketsOf(
  scores: readonly number[],
  thresholds: ResolvedThresholds,
): Buckets {
  const counts: Record<ScoreBand, number> = {
    fully_achieved: 0,
    strong: 0,
    partial: 0,
    little: 0,
  };
  for (const score of scores) {
    counts[scoreBand(score, thresholds)] += 1;
  }
  return counts;
}

export interface ArchiveResult {
  readonly snapshots: number;
  /** The workspace-wide result, or null when nothing in the cycle was scored. */
  readonly resultValue: number | null;
  readonly verdict: string | null;
}

/**
 * §8.9's archive: one snapshot per owner, written when a cycle closes.
 *
 * Three scopes, because three different people ask the question. The workspace
 * gets the portfolio verdict §3.4 defines, a space gets its own, and a champion
 * gets theirs. A member with goals in two spaces appears once, under their own
 * scope, which is the honest answer to "how did I do".
 */
export async function archiveCycleInTx(
  tx: OperationTx,
  workspaceId: string,
  cycleId: string,
  thresholds: ResolvedThresholds,
  now: Date = new Date(),
): Promise<ArchiveResult> {
  const [cycle] = await tx
    .select({ id: cycles.id, status: cycles.status })
    .from(cycles)
    .where(
      activeOnly(
        cycles,
        eq(cycles.workspaceId, workspaceId),
        eq(cycles.id, cycleId),
      ),
    )
    .limit(1);
  if (!cycle) {
    throw new OperationError("not_found", "No such cycle.");
  }

  const scored = await loadScores(tx, workspaceId, cycleId);

  const scopes: {
    ownerKind: "workspace" | "space" | "member";
    spaceId: string | null;
    memberId: string | null;
    scores: number[];
  }[] = [
    {
      ownerKind: "workspace",
      spaceId: null,
      memberId: null,
      scores: scored.map((row) => row.score),
    },
  ];

  const bySpace = new Map<string, number[]>();
  const byMember = new Map<string, number[]>();
  for (const row of scored) {
    if (row.spaceId) {
      const list = bySpace.get(row.spaceId);
      if (list) {
        list.push(row.score);
      } else {
        bySpace.set(row.spaceId, [row.score]);
      }
    }
    if (row.championId) {
      const list = byMember.get(row.championId);
      if (list) {
        list.push(row.score);
      } else {
        byMember.set(row.championId, [row.score]);
      }
    }
  }
  for (const [spaceId, scores] of bySpace) {
    scopes.push({ ownerKind: "space", spaceId, memberId: null, scores });
  }
  for (const [memberId, scores] of byMember) {
    scopes.push({ ownerKind: "member", spaceId: null, memberId, scores });
  }

  let snapshots = 0;
  for (const scope of scopes) {
    const average =
      scope.scores.length === 0
        ? null
        : round2(
            scope.scores.reduce((total, score) => total + score, 0) /
              scope.scores.length,
          );
    const buckets = bucketsOf(scope.scores, thresholds);
    const verdict =
      average === null ? null : portfolioVerdictOf(average, thresholds);

    const figures = {
      resultValue: average === null ? null : String(average),
      fullyAchievedCount: buckets.fully_achieved,
      strongCount: buckets.strong,
      partialCount: buckets.partial,
      littleCount: buckets.little,
      verdict,
    };

    // Read then write, not `on conflict`. The unique index coalesces the two
    // nullable owner columns, because two nulls read as distinct to a unique
    // index, and Postgres cannot infer an arbiter from an expression index
    // through a column list. Safe here in a way it was not for the KPI grid at
    // P3-T12: archiving is one facilitator closing one cycle, not two people
    // typing into the same cell, and the index still refuses a real duplicate.
    // `includeDeleted` on purpose, not `activeOnly`. The unique index does not
    // exclude soft-deleted rows either, so a deleted snapshot still occupies
    // the owner's slot: skipping it here would find nothing, insert, and hit
    // the index. Finding it and reviving it is the only path that works.
    const [existing] = await tx
      .select({ id: performanceSnapshots.id })
      .from(performanceSnapshots)
      .where(
        includeDeleted(
          performanceSnapshots,
          eq(performanceSnapshots.workspaceId, workspaceId),
          eq(performanceSnapshots.cycleId, cycleId),
          eq(performanceSnapshots.ownerKind, scope.ownerKind),
          scope.spaceId === null
            ? isNull(performanceSnapshots.spaceId)
            : eq(performanceSnapshots.spaceId, scope.spaceId),
          scope.memberId === null
            ? isNull(performanceSnapshots.memberId)
            : eq(performanceSnapshots.memberId, scope.memberId),
        ),
      )
      .limit(1);

    if (existing) {
      // openokr:allow-mutation: the calling Operation's own transaction.
      await tx
        .update(performanceSnapshots)
        .set({ ...figures, updatedAt: now, deletedAt: null })
        .where(
          // Same reason: this is the revival, so it has to reach a deleted row.
          includeDeleted(
            performanceSnapshots,
            eq(performanceSnapshots.id, existing.id),
          ),
        );
    } else {
      // openokr:allow-mutation: same transaction.
      await tx.insert(performanceSnapshots).values({
        id: newId(),
        workspaceId,
        cycleId,
        ownerKind: scope.ownerKind,
        spaceId: scope.spaceId,
        memberId: scope.memberId,
        ...figures,
      });
    }
    snapshots += 1;
  }

  const workspaceScope = scopes[0];
  const average =
    workspaceScope && workspaceScope.scores.length > 0
      ? round2(
          workspaceScope.scores.reduce((total, score) => total + score, 0) /
            workspaceScope.scores.length,
        )
      : null;

  return {
    snapshots,
    resultValue: average,
    verdict: average === null ? null : portfolioVerdictOf(average, thresholds),
  };
}

export interface FeedForwardResult {
  readonly priorScores: number;
  readonly issues: number;
  readonly frameCarried: boolean;
  /** Rows of §8.9's mapping this build cannot fill, each naming its task. */
  readonly waiting: readonly string[];
}

/**
 * §8.9's feed-forward: what the next cycle inherits when this one closes.
 *
 * Idempotent by checking what is already there rather than by deleting and
 * rewriting: a facilitator may have edited an issue after the first run, and a
 * rewrite would throw that away.
 */
export async function feedForwardInTx(
  tx: OperationTx,
  workspaceId: string,
  fromCycleId: string,
  toCycleId: string,
  now: Date = new Date(),
): Promise<FeedForwardResult> {
  if (fromCycleId === toCycleId) {
    throw new OperationError(
      "forbidden",
      "A cycle cannot feed itself. Name the cycle that is closing and the one that is opening.",
    );
  }

  const [source] = await tx
    .select({ id: cycles.id, frameId: cycles.frameId })
    .from(cycles)
    .where(
      activeOnly(
        cycles,
        eq(cycles.workspaceId, workspaceId),
        eq(cycles.id, fromCycleId),
      ),
    )
    .limit(1);
  const [target] = await tx
    .select({ id: cycles.id, frameId: cycles.frameId })
    .from(cycles)
    .where(
      activeOnly(
        cycles,
        eq(cycles.workspaceId, workspaceId),
        eq(cycles.id, toCycleId),
      ),
    )
    .limit(1);
  if (!source || !target) {
    throw new OperationError("not_found", "No such cycle.");
  }

  const written = await tx
    .select({
      id: keyResults.id,
      title: keyResults.title,
      score: keyResults.score,
      carryForward: keyResults.carryForward,
    })
    .from(keyResults)
    .innerJoin(goals, eq(goals.id, keyResults.goalId))
    .where(
      activeOnly(
        keyResults,
        eq(keyResults.workspaceId, workspaceId),
        eq(goals.cycleId, fromCycleId),
      ),
    );

  const existingScores = await tx
    .select({ sourceKeyResultId: cyclePriorScores.sourceKeyResultId })
    .from(cyclePriorScores)
    .where(
      activeOnly(
        cyclePriorScores,
        eq(cyclePriorScores.workspaceId, workspaceId),
        eq(cyclePriorScores.cycleId, toCycleId),
      ),
    );
  const alreadyScored = new Set(
    existingScores
      .map((row) => row.sourceKeyResultId)
      .filter((id): id is string => id !== null),
  );

  let priorScores = 0;
  let position = alreadyScored.size;
  for (const row of written) {
    if (alreadyScored.has(row.id)) {
      continue;
    }
    // openokr:allow-mutation: same transaction.
    await tx.insert(cyclePriorScores).values({
      id: newId(),
      workspaceId,
      cycleId: toCycleId,
      sourceKeyResultId: row.id,
      text: row.title,
      score: row.score,
      position,
    });
    position += 1;
    priorScores += 1;
  }

  // §8.9: carried work re-enters as an issue at impact four. It has to survive
  // the next prioritisation on its merits; it does not get a free pass.
  const carried = written.filter((row) => row.carryForward);
  const existingIssues =
    carried.length === 0
      ? []
      : await tx
          .select({ text: cycleIssues.text })
          .from(cycleIssues)
          .where(
            activeOnly(
              cycleIssues,
              eq(cycleIssues.workspaceId, workspaceId),
              eq(cycleIssues.cycleId, toCycleId),
              eq(cycleIssues.source, "carry_forward"),
              inArray(
                cycleIssues.text,
                carried.map((row) => row.title),
              ),
            ),
          );
  const alreadyCarried = new Set(existingIssues.map((row) => row.text));

  let issues = 0;
  for (const row of carried) {
    if (alreadyCarried.has(row.title)) {
      continue;
    }
    // openokr:allow-mutation: same transaction.
    await tx.insert(cycleIssues).values({
      id: newId(),
      workspaceId,
      cycleId: toCycleId,
      text: row.title,
      impact: 4,
      source: "carry_forward",
    });
    issues += 1;
  }

  // The annual frame carries forward as a reference. The focus flags clear
  // themselves: `cycle_focus_key_results` is per cycle, so a new cycle starts
  // with none and there is nothing to unset.
  let frameCarried = false;
  if (source.frameId && target.frameId !== source.frameId) {
    // openokr:allow-mutation: same transaction.
    await tx
      .update(cycles)
      .set({ frameId: source.frameId, updatedAt: now })
      .where(
        activeOnly(
          cycles,
          eq(cycles.workspaceId, workspaceId),
          eq(cycles.id, toCycleId),
        ),
      );
    frameCarried = true;
  }

  return {
    priorScores,
    issues,
    frameCarried,
    // Two of §8.9's five rows cannot be filled by this build, and saying so is
    // the point: a mapping that silently skipped them would look complete.
    waiting: [
      "learnings and the retrospective into the input pack (P4-T11 owns learnings)",
      "the lowest process-health statement as a process priority (P4-T11 owns the survey)",
    ],
  };
}
