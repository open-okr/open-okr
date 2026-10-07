import {
  activeOnly,
  cycleIssues,
  cyclePackItems,
  cyclePriorities,
  cyclePriorScores,
  cycles,
  goals,
  includeDeleted,
  keyResults,
  learnings,
  newId,
  okrSessions,
  performanceSnapshots,
  processHealthResponses,
} from "@openokr/db";
import {
  lowestProcessHealthStatement,
  type PortfolioVerdict,
  PROCESS_HEALTH_STATEMENTS,
  portfolioVerdictOf,
  type ResolvedThresholds,
  round2,
  type ScoreBand,
  type ScoreColoursPractice,
  scoreBand,
} from "@openokr/method";
import { asc, count, desc, eq, gt, inArray, isNull, lt, ne } from "drizzle-orm";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import { practiceFromRow } from "../practice/settings.ts";
import {
  CARRIED_DECISIONS,
  carryKeptObjectivesInTx,
  closeDecisionsInTx,
  endRecoveriesInTx,
  moveRecoveriesToDraftsInTx,
} from "./carry.ts";
import { resolveRhythm } from "./rhythm.ts";
import { rulesSnapshot } from "./rules.ts";
import { readRhythmRow } from "./service.ts";
import { evaluateWorkflow, loadCycleForWorkflow } from "./workflow.ts";

/**
 * Closing a cycle and opening the next one (METHOD.md §8.9, TECHNICAL-PLAN §4.6,
 * P3-T15, completeness review M-05).
 *
 * §8.9: "At close, the product feeds the next cycle automatically." So closing
 * is one act, `closeCycleInTx`: it records the archive, marks the cycle closed
 * and feeds the next cycle of the same mode, all in one transaction. Until M-05
 * the archive and the feed-forward were two buttons and nothing ever set a
 * cycle to `closed`, so the inheritance happened only when somebody remembered.
 *
 * **The next cycle often does not exist at close.** §8.10 holds the review
 * before anybody drafts the next cycle, so a cycle created afterwards is fed at
 * creation instead, by `feedFromClosedPredecessorInTx`. Either order ends in
 * the same rows.
 *
 * The archive and the feed-forward stay separate functions, because each is
 * also its own action for a re-run from the API. Both are idempotent: a retry
 * must not double the trend, the issue list or the priorities.
 */

interface Scored {
  readonly goalId: string;
  readonly spaceId: string | null;
  readonly championId: string | null;
  readonly score: number;
  /** Its objective's kind, which decides whether §3.4's verdict reads it. */
  readonly kind: "committed" | "aspirational";
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
      kind: goals.kind,
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
      kind: row.kind,
    }));
}

/**
 * §3.4's verdict on a scope's aspirational scores (P9-T11b-b). Committed key
 * results are judged by the share met rather than an average, because
 * averaging the two hides both; null when nothing aspirational was scored.
 */
function aspirationalVerdict(
  scored: readonly Scored[],
  thresholds: ResolvedThresholds,
): PortfolioVerdict | null {
  const aspirational = scored
    .filter((row) => row.kind === "aspirational")
    .map((row) => row.score);
  if (aspirational.length === 0) {
    return null;
  }
  return portfolioVerdictOf(
    round2(
      aspirational.reduce((total, score) => total + score, 0) /
        aspirational.length,
    ),
    thresholds,
  );
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
  practice: ScoreColoursPractice,
): Buckets {
  const counts: Record<ScoreBand, number> = {
    fully_achieved: 0,
    strong: 0,
    partial: 0,
    little: 0,
  };
  for (const score of scores) {
    counts[scoreBand(score, thresholds, practice)] += 1;
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
  // The archive is what the cycle achieved when it closed. Rewriting it later
  // would let the scorecard drift from the result the review agreed on.
  if (cycle.status === "closed") {
    throw new OperationError(
      "forbidden",
      "This cycle is closed. Its result was recorded when it closed.",
    );
  }

  const scored = await loadScores(tx, workspaceId, cycleId);

  const scopes: {
    ownerKind: "workspace" | "space" | "member";
    spaceId: string | null;
    memberId: string | null;
    rows: Scored[];
    scores: number[];
  }[] = [
    {
      ownerKind: "workspace",
      spaceId: null,
      memberId: null,
      rows: scored,
      scores: scored.map((row) => row.score),
    },
  ];

  const bySpace = new Map<string, Scored[]>();
  const byMember = new Map<string, Scored[]>();
  for (const row of scored) {
    if (row.spaceId) {
      const list = bySpace.get(row.spaceId);
      if (list) {
        list.push(row);
      } else {
        bySpace.set(row.spaceId, [row]);
      }
    }
    if (row.championId) {
      const list = byMember.get(row.championId);
      if (list) {
        list.push(row);
      } else {
        byMember.set(row.championId, [row]);
      }
    }
  }
  for (const [spaceId, rows] of bySpace) {
    scopes.push({
      ownerKind: "space",
      spaceId,
      memberId: null,
      rows,
      scores: rows.map((row) => row.score),
    });
  }
  for (const [memberId, rows] of byMember) {
    scopes.push({
      ownerKind: "member",
      spaceId: null,
      memberId,
      rows,
      scores: rows.map((row) => row.score),
    });
  }

  // The colours the bands are counted in (METHOD.md §3.3, §12, P9-T14a).
  const { practice } = practiceFromRow(await readRhythmRow(tx, workspaceId));

  let snapshots = 0;
  for (const scope of scopes) {
    const average =
      scope.scores.length === 0
        ? null
        : round2(
            scope.scores.reduce((total, score) => total + score, 0) /
              scope.scores.length,
          );
    const buckets = bucketsOf(scope.scores, thresholds, practice);
    // The result is the cycle score over every scored key result (§8.6);
    // the verdict is §3.4's, over the aspirational ones alone.
    const verdict = aspirationalVerdict(scope.rows, thresholds);

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
    verdict: aspirationalVerdict(workspaceScope?.rows ?? [], thresholds),
  };
}

export interface FeedForwardResult {
  readonly priorScores: number;
  readonly issues: number;
  readonly frameCarried: boolean;
  /** Rows of §8.9's mapping this build cannot fill, each naming its task. */
  readonly waiting: readonly string[];
  /**
   * The process-health statement the next cycle holds in Phase 3 as its
   * improvement action, or null when the survey went unanswered (§8.5, §8.9;
   * M-05). Reported whether this run wrote it or an earlier one did.
   */
  readonly processPriority: string | null;
  /** Whether the learnings reached the next cycle's input pack (P4-T12-b). */
  readonly packNote: boolean;
  /** Kept and modified objectives pre-filled as drafts by this run (P9-T20e-b). */
  readonly drafts: number;
  /** Kept objectives not carried because their champion has left, by title. */
  readonly notCarried: readonly string[];
}

/**
 * The review §8.9 feeds from: the latest closed quarterly session on the cycle.
 *
 * Found rather than passed in: §8.10 holds the review before the next cycle is
 * drafted, so by the time anything feeds forward the review is a closed
 * session on the cycle being left behind.
 */
async function findClosedReview(
  tx: OperationTx,
  workspaceId: string,
  cycleId: string,
): Promise<{ readonly id: string } | undefined> {
  const [review] = await tx
    .select({ id: okrSessions.id })
    .from(okrSessions)
    .where(
      activeOnly(
        okrSessions,
        eq(okrSessions.workspaceId, workspaceId),
        eq(okrSessions.cycleId, cycleId),
        eq(okrSessions.kind, "quarterly"),
        eq(okrSessions.state, "closed"),
      ),
    )
    .orderBy(desc(okrSessions.endedAt))
    .limit(1);
  return review;
}

/**
 * §8.5's lowest-scoring statement for a review, or null when nobody answered.
 *
 * A survey nobody answered has no lowest statement, and inventing one would be
 * the product deciding the team's own process problem for it.
 */
async function lowestStatementOf(
  tx: OperationTx,
  workspaceId: string,
  reviewId: string,
): Promise<string | null> {
  const responses = await tx
    .select({
      statementKey: processHealthResponses.statementKey,
      score: processHealthResponses.score,
    })
    .from(processHealthResponses)
    .where(
      activeOnly(
        processHealthResponses,
        eq(processHealthResponses.workspaceId, workspaceId),
        eq(processHealthResponses.sessionId, reviewId),
      ),
    );
  if (responses.length === 0) {
    return null;
  }
  const averages = PROCESS_HEALTH_STATEMENTS.map((_statement, index) => {
    const forStatement = responses.filter(
      (row) => row.statementKey === index + 1,
    );
    return forStatement.length === 0
      ? null
      : forStatement.reduce((sum, row) => sum + row.score, 0) /
          forStatement.length;
  });
  // From `packages/method`, including how a tie is broken: strictly lower, so
  // the earlier statement wins and the answer does not depend on iteration
  // order.
  return lowestProcessHealthStatement(averages)?.statement ?? null;
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
  const { thresholds } = resolveRhythm(await readRhythmRow(tx, workspaceId));
  // §8.9's impact for anything fed forward, as the workspace resolves it
  // (completeness review H-17). It was the literal 4 in three places.
  const carriedImpact = thresholds["quality.carryForwardIssueImpact"];

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
    .select({
      id: cycles.id,
      frameId: cycles.frameId,
      status: cycles.status,
      previousCycleId: cycles.previousCycleId,
    })
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
  // Everything below writes into the target's phases, and a closed cycle's
  // record does not change after its archive.
  if (target.status === "closed") {
    throw new OperationError(
      "forbidden",
      "That cycle is closed. Its record does not change after the archive.",
    );
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

  // §8.9: carried work re-enters as an issue at the carry-forward impact. It has to survive
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
      impact: carriedImpact,
      source: "carry_forward",
    });
    issues += 1;
  }

  /**
   * §8.9's remaining two rows, filled at P4-T12-b.
   *
   * Both were reported in `waiting` because the tables did not exist when
   * P3-T15 wrote this: learnings arrived at P4-T11c-b and the process-health
   * survey at P4-T11b. The `waiting` list is what made their absence visible
   * instead of letting a half-done mapping read as complete, and it is empty now.
   *
   * The review is found rather than passed in, by `findClosedReview`.
   */
  const review = await findClosedReview(tx, workspaceId, fromCycleId);

  // --- carried learnings join carried key results at the same impact ---
  //
  // §8.9's row is "every carry-forward item", and a learning marked to carry is
  // one. It re-enters as an issue for the same reason a key result does: it has
  // to survive the next prioritisation on its merits.
  const carriedLearnings = await tx
    .select({ text: learnings.text })
    .from(learnings)
    .where(
      activeOnly(
        learnings,
        eq(learnings.workspaceId, workspaceId),
        eq(learnings.cycleId, fromCycleId),
        eq(learnings.carryForward, true),
      ),
    );

  for (const learning of carriedLearnings) {
    if (alreadyCarried.has(learning.text)) {
      continue;
    }
    const [duplicate] = await tx
      .select({ id: cycleIssues.id })
      .from(cycleIssues)
      .where(
        activeOnly(
          cycleIssues,
          eq(cycleIssues.workspaceId, workspaceId),
          eq(cycleIssues.cycleId, toCycleId),
          eq(cycleIssues.source, "carry_forward"),
          eq(cycleIssues.text, learning.text),
        ),
      )
      .limit(1);
    if (duplicate) {
      continue;
    }
    // openokr:allow-mutation: same transaction.
    await tx.insert(cycleIssues).values({
      id: newId(),
      workspaceId,
      cycleId: toCycleId,
      text: learning.text,
      impact: carriedImpact,
      source: "carry_forward",
    });
    issues += 1;
  }

  // --- a deferred objective joins them (§8.8, P9-T20e-a) ---
  //
  // "Defer: still worth doing, not next cycle. It goes to the issue list."
  // At the carry-forward impact, like every other carried item, so it has to
  // survive the next prioritisation on its merits. Deferred at stage 9 or
  // from the objective's own page, whichever was decided later (P9-T20e-b).
  const decided = await closeDecisionsInTx(
    tx,
    workspaceId,
    fromCycleId,
    review?.id ?? null,
  );
  const deferred = decided
    .filter((objective) => objective.decision === "defer")
    .map((objective) => ({ text: objective.title }));
  for (const objective of deferred) {
    const [duplicate] = await tx
      .select({ id: cycleIssues.id })
      .from(cycleIssues)
      .where(
        activeOnly(
          cycleIssues,
          eq(cycleIssues.workspaceId, workspaceId),
          eq(cycleIssues.cycleId, toCycleId),
          eq(cycleIssues.source, "carry_forward"),
          eq(cycleIssues.text, objective.text),
        ),
      )
      .limit(1);
    if (duplicate) {
      continue;
    }
    // openokr:allow-mutation: same transaction.
    await tx.insert(cycleIssues).values({
      id: newId(),
      workspaceId,
      cycleId: toCycleId,
      text: objective.text,
      impact: carriedImpact,
      source: "carry_forward",
    });
    issues += 1;
  }

  // --- kept and modified objectives pre-fill Phase 4 (§8.9, P9-T20e-b) ---
  const keptDrafts = await carryKeptObjectivesInTx(tx, {
    workspaceId,
    toCycleId,
    kept: decided,
    thresholds,
    now,
  });
  // A kept recovery goes on in its draft (§6.5, P9-T22c-e-b).
  await moveRecoveriesToDraftsInTx(tx, {
    workspaceId,
    toCycleId,
    decided,
    now,
  });

  // --- the lowest process-health statement, Phase 3's improvement action ---
  //
  // §8.9's table: "The lowest process-health statement | Phase 3, an
  // improvement action", and §8.5: it "becomes an improvement action for the
  // next cycle, with an owner and a date". The owner and the date are stage
  // 11's, where the review records it as an action (P9-T20d); this is where
  // the next cycle's Phase 3 meets it, beside the priorities it is ranked
  // with. From P4-T12-b until M-05 it landed as a Phase 2 issue instead, on a
  // reading of a closing line about carried work that v2 removed.
  //
  // Matched on its text, because a priority has no source column. The text is
  // the canon statement, so a facilitator's own priority cannot collide with it
  // unless it says the same thing, in which case one row is right anyway.
  const lowest = review
    ? await lowestStatementOf(tx, workspaceId, review.id)
    : null;
  if (lowest) {
    const [duplicate] = await tx
      .select({ id: cyclePriorities.id })
      .from(cyclePriorities)
      .where(
        activeOnly(
          cyclePriorities,
          eq(cyclePriorities.workspaceId, workspaceId),
          eq(cyclePriorities.cycleId, toCycleId),
          eq(cyclePriorities.text, lowest),
        ),
      )
      .limit(1);
    if (!duplicate) {
      // Last in the list, the way `workflow.addPriority` places a new one. The
      // facilitator ranks it in Phase 3 like any other.
      const [last] = await tx
        .select({ position: cyclePriorities.position })
        .from(cyclePriorities)
        .where(
          activeOnly(
            cyclePriorities,
            eq(cyclePriorities.workspaceId, workspaceId),
            eq(cyclePriorities.cycleId, toCycleId),
          ),
        )
        .orderBy(desc(cyclePriorities.position))
        .limit(1);
      // openokr:allow-mutation: same transaction.
      await tx.insert(cyclePriorities).values({
        id: newId(),
        workspaceId,
        cycleId: toCycleId,
        text: lowest,
        position: (last?.position ?? -1) + 1,
      });
    }
  }

  // --- learnings and the retrospective into the input pack ---
  //
  // §2.6's item two is "Prior cycle OKRs with scores and retrospective notes",
  // which is where §8.9 sends them. The note is rewritten rather than appended,
  // so running the feed-forward twice leaves one note and not two copies of it.
  let packNote = false;
  if (carriedLearnings.length > 0 || review) {
    const allLearnings = await tx
      .select({ text: learnings.text, carryForward: learnings.carryForward })
      .from(learnings)
      .where(
        activeOnly(
          learnings,
          eq(learnings.workspaceId, workspaceId),
          eq(learnings.cycleId, fromCycleId),
        ),
      )
      .orderBy(learnings.createdAt);

    if (allLearnings.length > 0) {
      const note = allLearnings
        .map(
          (row) => `${row.text}${row.carryForward ? " (carried forward)" : ""}`,
        )
        .join("\n");

      const [existing] = await tx
        .select({ id: cyclePackItems.id })
        .from(cyclePackItems)
        .where(
          activeOnly(
            cyclePackItems,
            eq(cyclePackItems.workspaceId, workspaceId),
            eq(cyclePackItems.cycleId, toCycleId),
            eq(cyclePackItems.itemKey, 2),
          ),
        )
        .limit(1);

      if (existing) {
        // openokr:allow-mutation: same transaction.
        await tx
          .update(cyclePackItems)
          .set({ note, gathered: true, updatedAt: now })
          .where(
            activeOnly(cyclePackItems, eq(cyclePackItems.id, existing.id)),
          );
      } else {
        // openokr:allow-mutation: same transaction.
        await tx.insert(cyclePackItems).values({
          id: newId(),
          workspaceId,
          cycleId: toCycleId,
          itemKey: 2,
          gathered: true,
          note,
        });
      }
      packNote = true;
    }
  }

  // The annual frame carries forward as a reference. The focus flags clear
  // themselves: `cycle_focus_key_results` is per cycle, so a new cycle starts
  // with none and there is nothing to unset.
  const frameCarried = Boolean(
    source.frameId && target.frameId !== source.frameId,
  );
  // `previous_cycle_id` records which cycle fed this one (M-05). It is how a
  // closed cycle knows it already has a successor, so a cycle created later is
  // not fed from the same close twice, and how its phase 7 names where its
  // inheritance went. The first feed wins: a manual re-run from elsewhere adds
  // rows but does not rewrite the lineage.
  const linkLineage = target.previousCycleId === null;
  if (frameCarried || linkLineage) {
    // openokr:allow-mutation: same transaction.
    await tx
      .update(cycles)
      .set({
        ...(frameCarried ? { frameId: source.frameId } : {}),
        ...(linkLineage ? { previousCycleId: fromCycleId } : {}),
        updatedAt: now,
      })
      .where(
        activeOnly(
          cycles,
          eq(cycles.workspaceId, workspaceId),
          eq(cycles.id, toCycleId),
        ),
      );
  }

  return {
    priorScores,
    issues,
    frameCarried,
    /**
     * Empty since P4-T12-b, and kept rather than deleted.
     *
     * Two of §8.9's five rows sat here from P3-T15 until the tables existed:
     * learnings arrived at P4-T11c-b and the process-health survey at P4-T11b.
     * The field is what made their absence visible instead of letting a
     * half-done mapping read as complete, and the next row §8.9 grows will use
     * it the same way.
     */
    waiting: [],
    processPriority: lowest,
    packNote,
    drafts: keptDrafts.drafts,
    notCarried: keptDrafts.notCarried,
  };
}

export interface CloseResult {
  readonly name: string;
  readonly archive: ArchiveResult;
  /** The cycle fed at close, or null when the next one does not exist yet. */
  readonly fedInto: {
    readonly cycleId: string;
    readonly name: string;
    readonly result: FeedForwardResult;
  } | null;
}

/**
 * §8.9's close, as one act: archive, mark closed, feed the next cycle.
 *
 * **Refused until phase 7 is complete** (METHOD.md §2.3: "Every key result
 * scored and the retrospective written"; §2.2: "Phase 7 closes it and feeds the
 * next one"). The refusal names what is missing, in the words the phase rail
 * uses. There is no override: §4.5's publish gates have one, because REQUIREMENTS
 * §3.2 gives them one, and nothing in METHOD or REQUIREMENTS gives phase 7 one.
 * A cycle closed unscored would put a result on the scorecard nobody agreed.
 *
 * **The next cycle is the earliest one of the same mode starting after this one
 * ends.** A quarter feeds the next quarter and a year the next year, never
 * across. When it does not exist yet, or is itself closed, nothing is fed now;
 * `feedFromClosedPredecessorInTx` feeds it when it is created.
 */
export async function closeCycleInTx(
  tx: OperationTx,
  workspaceId: string,
  cycleId: string,
  thresholds: ResolvedThresholds,
  now: Date = new Date(),
): Promise<CloseResult> {
  // **Locked before the status is read.** Two closes arriving together would
  // otherwise both see an open cycle and both feed the next one, and the prior
  // scores have no unique index to refuse the second copy. The second close
  // now waits, then reads `closed` and is refused. The same lock is what
  // `feedFromClosedPredecessorInTx` takes, so a close and the next cycle's
  // creation cannot each miss the other.
  await tx
    .select({ id: cycles.id })
    .from(cycles)
    .where(
      activeOnly(
        cycles,
        eq(cycles.workspaceId, workspaceId),
        eq(cycles.id, cycleId),
      ),
    )
    .for("update");
  const cycle = await loadCycleForWorkflow(tx, workspaceId, cycleId);
  if (!cycle) {
    throw new OperationError("not_found", "No such cycle.");
  }
  if (cycle.status === "closed") {
    throw new OperationError("forbidden", "This cycle is already closed.");
  }

  // Evaluated here rather than read from anything stored, the same reason
  // publication re-evaluates its gates: a cached answer is how a cycle closes
  // on a condition that stopped holding.
  const { phases } = await evaluateWorkflow(tx, workspaceId, cycle, thresholds);
  const review = phases.find((result) => result.phase === 7);
  if (review?.state !== "pass") {
    const reasons = [...(review?.missing ?? []), ...(review?.blocked ?? [])];
    throw new OperationError(
      "forbidden",
      `This cycle cannot close until phase 7 is complete. ${reasons.join(". ")}.`,
    );
  }

  const archive = await archiveCycleInTx(
    tx,
    workspaceId,
    cycleId,
    thresholds,
    now,
  );

  // A recovery the room did not carry ends with the close (§6.5,
  // P9-T22c-e-b), whether or not there is a next cycle to feed. Before the
  // cycle is marked closed, which freezes its objectives.
  const closedReview = await findClosedReview(tx, workspaceId, cycleId);
  await endRecoveriesInTx(tx, {
    workspaceId,
    decided: await closeDecisionsInTx(
      tx,
      workspaceId,
      cycleId,
      closedReview?.id ?? null,
    ),
    now,
  });

  // METHOD.md §12 (P9-T14b): the cycle keeps the rules it was graded under,
  // so a band or a cap moved later does not rewrite its verdicts.
  const { practice: inForce } = practiceFromRow(
    await readRhythmRow(tx, workspaceId),
  );

  // Phase 7 as well as closed, so the cycle opens on the phase that shows
  // how it closed rather than wherever the pointer was left.
  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx
    .update(cycles)
    .set({
      status: "closed",
      phase: 7,
      practiceSnapshot: rulesSnapshot(thresholds, inForce, now),
      updatedAt: now,
    })
    .where(
      activeOnly(
        cycles,
        eq(cycles.workspaceId, workspaceId),
        eq(cycles.id, cycleId),
      ),
    );

  const [next] = await tx
    .select({ id: cycles.id, name: cycles.name, status: cycles.status })
    .from(cycles)
    .where(
      activeOnly(
        cycles,
        eq(cycles.workspaceId, workspaceId),
        eq(cycles.mode, cycle.mode),
        gt(cycles.startsOn, cycle.endsOn),
      ),
    )
    .orderBy(asc(cycles.startsOn))
    .limit(1);
  if (!next || next.status === "closed") {
    return { name: cycle.name, archive, fedInto: null };
  }

  const result = await feedForwardInTx(tx, workspaceId, cycleId, next.id, now);
  return {
    name: cycle.name,
    archive,
    fedInto: { cycleId: next.id, name: next.name, result },
  };
}

/**
 * Feeds a newly created cycle from the closed cycle just before it (M-05).
 *
 * The other half of `closeCycleInTx`: a close that found no next cycle leaves
 * the inheritance waiting, and this is where it lands. Called by the actions
 * that create a cycle, in the same transaction as the insert.
 *
 * **Only the cycle immediately before, only if it is closed, and only if it has
 * fed nothing yet.** Reaching past an open cycle to an older closed one would
 * hand a quarter the inheritance of a quarter two back. A closed cycle that
 * already fed a successor has given its inheritance away, which is what stops
 * a cycle created out of order from being fed twice from one close.
 */
export async function feedFromClosedPredecessorInTx(
  tx: OperationTx,
  workspaceId: string,
  cycleId: string,
  now: Date = new Date(),
): Promise<{
  readonly fromCycleId: string;
  readonly fromName: string;
  readonly result: FeedForwardResult;
} | null> {
  const [cycle] = await tx
    .select({ id: cycles.id, mode: cycles.mode, startsOn: cycles.startsOn })
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
    return null;
  }

  // Locked, for the reason `closeCycleInTx` locks the cycle it closes. Without
  // it a close and this creation running together each miss the other: the
  // close finds no next cycle yet, this finds a cycle not yet closed, and the
  // inheritance lands nowhere. With it, whichever waits reads what the other
  // committed.
  const [previous] = await tx
    .select({ id: cycles.id, name: cycles.name, status: cycles.status })
    .from(cycles)
    .where(
      activeOnly(
        cycles,
        eq(cycles.workspaceId, workspaceId),
        eq(cycles.mode, cycle.mode),
        lt(cycles.endsOn, cycle.startsOn),
      ),
    )
    .orderBy(desc(cycles.startsOn))
    .limit(1)
    .for("update");
  if (previous?.status !== "closed") {
    return null;
  }

  const [successor] = await tx
    .select({ id: cycles.id })
    .from(cycles)
    .where(
      activeOnly(
        cycles,
        eq(cycles.workspaceId, workspaceId),
        eq(cycles.previousCycleId, previous.id),
        ne(cycles.id, cycleId),
      ),
    )
    .limit(1);
  if (successor) {
    return null;
  }

  const result = await feedForwardInTx(
    tx,
    workspaceId,
    previous.id,
    cycleId,
    now,
  );
  return { fromCycleId: previous.id, fromName: previous.name, result };
}

export interface ClosureSummary {
  readonly resultValue: number | null;
  readonly verdict: string | null;
  /** The cycle this one fed, or null while it has not been created. */
  readonly nextCycle: { readonly id: string; readonly name: string } | null;
  readonly priorScores: number;
  readonly carriedIssues: number;
  /** Kept and modified objectives the next cycle holds as drafts (P9-T20e-b). */
  readonly carriedDrafts: number;
  /** Kept objectives it could not carry, their champion having left. */
  readonly notCarried: string[];
  readonly processPriority: string | null;
  readonly packNote: boolean;
}

/**
 * How a closed cycle closed, read back from the rows the close wrote (M-05).
 *
 * Read rather than stored: the snapshot holds the result, `previous_cycle_id`
 * names the successor, and the successor's own phases hold what it received.
 * A second copy of those facts on the closed cycle would be one more thing to
 * keep in step, and the successor may not exist until long after the close.
 *
 * Null for a cycle that is not closed.
 */
export async function readClosureInTx(
  tx: OperationTx,
  workspaceId: string,
  cycleId: string,
): Promise<ClosureSummary | null> {
  const [cycle] = await tx
    .select({ status: cycles.status })
    .from(cycles)
    .where(
      activeOnly(
        cycles,
        eq(cycles.workspaceId, workspaceId),
        eq(cycles.id, cycleId),
      ),
    )
    .limit(1);
  if (cycle?.status !== "closed") {
    return null;
  }

  const [snapshot] = await tx
    .select({
      resultValue: performanceSnapshots.resultValue,
      verdict: performanceSnapshots.verdict,
    })
    .from(performanceSnapshots)
    .where(
      activeOnly(
        performanceSnapshots,
        eq(performanceSnapshots.workspaceId, workspaceId),
        eq(performanceSnapshots.cycleId, cycleId),
        eq(performanceSnapshots.ownerKind, "workspace"),
      ),
    )
    .limit(1);
  const figures = {
    resultValue:
      snapshot?.resultValue === null || snapshot?.resultValue === undefined
        ? null
        : Number(snapshot.resultValue),
    verdict: snapshot?.verdict ?? null,
  };

  const [next] = await tx
    .select({ id: cycles.id, name: cycles.name })
    .from(cycles)
    .where(
      activeOnly(
        cycles,
        eq(cycles.workspaceId, workspaceId),
        eq(cycles.previousCycleId, cycleId),
      ),
    )
    .orderBy(asc(cycles.startsOn))
    .limit(1);
  if (!next) {
    return {
      ...figures,
      nextCycle: null,
      priorScores: 0,
      carriedIssues: 0,
      carriedDrafts: 0,
      notCarried: [],
      processPriority: null,
      packNote: false,
    };
  }

  // The prior scores that came from this cycle's key results, including one
  // deleted since: its score was handed on while it existed.
  const [scores] = await tx
    .select({ total: count() })
    .from(cyclePriorScores)
    .innerJoin(
      keyResults,
      eq(keyResults.id, cyclePriorScores.sourceKeyResultId),
    )
    .innerJoin(goals, eq(goals.id, keyResults.goalId))
    .where(
      activeOnly(
        cyclePriorScores,
        eq(cyclePriorScores.workspaceId, workspaceId),
        eq(cyclePriorScores.cycleId, next.id),
        eq(goals.cycleId, cycleId),
      ),
    );

  const [carried] = await tx
    .select({ total: count() })
    .from(cycleIssues)
    .where(
      activeOnly(
        cycleIssues,
        eq(cycleIssues.workspaceId, workspaceId),
        eq(cycleIssues.cycleId, next.id),
        eq(cycleIssues.source, "carry_forward"),
      ),
    );

  const review = await findClosedReview(tx, workspaceId, cycleId);
  const lowest = review
    ? await lowestStatementOf(tx, workspaceId, review.id)
    : null;
  const [priority] = lowest
    ? await tx
        .select({ text: cyclePriorities.text })
        .from(cyclePriorities)
        .where(
          activeOnly(
            cyclePriorities,
            eq(cyclePriorities.workspaceId, workspaceId),
            eq(cyclePriorities.cycleId, next.id),
            eq(cyclePriorities.text, lowest),
          ),
        )
        .limit(1)
    : [];

  const [pack] = await tx
    .select({ note: cyclePackItems.note })
    .from(cyclePackItems)
    .where(
      activeOnly(
        cyclePackItems,
        eq(cyclePackItems.workspaceId, workspaceId),
        eq(cyclePackItems.cycleId, next.id),
        eq(cyclePackItems.itemKey, 2),
      ),
    )
    .limit(1);

  // The drafts this cycle's kept objectives became, including one deleted
  // since: it was handed on, and deleting it was the next cycle's decision.
  const kept = (
    await closeDecisionsInTx(tx, workspaceId, cycleId, review?.id ?? null)
  ).filter((objective) => CARRIED_DECISIONS.includes(objective.decision));
  const drafts =
    kept.length === 0
      ? []
      : await tx
          .select({ from: goals.carriedFromGoalId })
          .from(goals)
          .where(
            includeDeleted(
              goals,
              eq(goals.workspaceId, workspaceId),
              eq(goals.cycleId, next.id),
              inArray(
                goals.carriedFromGoalId,
                kept.map((objective) => objective.goalId),
              ),
            ),
          );
  const handedOn = new Set(drafts.map((row) => row.from));

  return {
    ...figures,
    nextCycle: { id: next.id, name: next.name },
    priorScores: Number(scores?.total ?? 0),
    carriedIssues: Number(carried?.total ?? 0),
    carriedDrafts: handedOn.size,
    notCarried: kept
      .filter((objective) => !handedOn.has(objective.goalId))
      .map((objective) => objective.title),
    processPriority: priority?.text ?? null,
    packNote: Boolean(pack?.note),
  };
}
