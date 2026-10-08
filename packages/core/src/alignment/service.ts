import {
  type AlignmentFindingKind,
  activeOnly,
  alignmentFindings,
  cycles,
  goalDependencies,
  goals,
  keyResultDependencies,
  keyResults,
  newId,
} from "@openokr/db";
import {
  type AlignmentGraph,
  type AlignmentResult,
  type AlignmentScope,
  type AlignmentSeverity,
  type AlignmentThresholds,
  alignmentScore,
  enforceAlignment,
  type ResolvedThresholds,
} from "@openokr/method";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { selectInChunks } from "../actions/chunk.ts";
import { cycleRulesInTx } from "../cycles/rules.ts";
import type { OperationTx } from "../operations/operation.ts";

/**
 * The alignment engine's half that needs rows (METHOD.md §5, design
 * `alignment-engine.md` §6 and §7, P3-T09).
 *
 * The arithmetic is in `packages/method`. This loads the graph, calls it, and
 * reconciles the findings table against the answer.
 *
 * **Recompute runs in the writing transaction, not in a job.** The design
 * document drives it from the outbox, and no relay host runs in the application
 * yet, so a topic with no consumer would be a pending row nobody drains. That is
 * the same call P3-T05 made for the scoring cascade, and for the same second
 * reason: in-transaction is the stronger guarantee, because there is no window
 * where the studio shows a score the rows no longer support. When a relay host
 * exists, it calls this same function.
 *
 * The graph loads in one query per relation and computes in memory, which is what
 * §13.1's budget of 2 seconds for 10,000 goals is written against.
 */

/** §11's two alignment thresholds, out of a workspace's resolved registry. */
function alignmentThresholdsOf(
  thresholds: ResolvedThresholds,
): AlignmentThresholds {
  return {
    healthy: thresholds["alignment.healthyThreshold"],
    watch: thresholds["alignment.watchThreshold"],
  };
}

/**
 * One scope's score, read the way its cycle is read (P9-T16b-a).
 *
 * The cycle's own rules, so a closed cycle keeps the thresholds and check
 * levels it closed under (P9-T14b), and the levels it began with, so AL-3
 * measures a skip over the levels it uses (G-3). The practice then drops the
 * findings of every check it turned off; the share does not move.
 */
export async function alignmentInTx(
  tx: OperationTx,
  input: AlignmentScopeInput,
): Promise<{
  readonly graph: AlignmentGraph;
  readonly result: AlignmentResult;
  readonly thresholds: AlignmentThresholds;
}> {
  const rules = await cycleRulesInTx(tx, input.workspaceId, input.cycleId);
  const [cycle] = await tx
    .select({ levels: cycles.levels })
    .from(cycles)
    .where(
      activeOnly(
        cycles,
        eq(cycles.workspaceId, input.workspaceId),
        eq(cycles.id, input.cycleId),
      ),
    )
    .limit(1);
  const graph = await loadAlignmentGraph(tx, input);
  const thresholds = alignmentThresholdsOf(rules.thresholds);
  const result = enforceAlignment(
    alignmentScore(graph, input.scope, thresholds, {
      ...(cycle ? { levels: cycle.levels } : {}),
      contributionMinimum: rules.thresholds["quality.contributionMinimum"],
    }),
    rules.practice,
  );
  return { graph, result, thresholds };
}

export interface AlignmentScopeInput {
  readonly workspaceId: string;
  readonly cycleId: string;
  readonly scope: AlignmentScope;
}

/**
 * Every goal in scope, with its parent resolved to a goal.
 *
 * A goal may point at a parent goal or at a parent key result, and §3.4 says a
 * key result parent takes the level of the goal that owns it. Resolving here is
 * what lets the engine stay ignorant of which kind of pointer it was.
 */
async function loadAlignmentGraph(
  tx: OperationTx,
  input: AlignmentScopeInput,
): Promise<AlignmentGraph> {
  const inScope =
    input.scope.kind === "space"
      ? [eq(goals.spaceId, input.scope.spaceId)]
      : [];

  const rows = await tx
    .select({
      id: goals.id,
      level: goals.level,
      parentGoalId: goals.parentGoalId,
      parentKeyResultId: goals.parentKeyResultId,
      standaloneReason: goals.standaloneReason,
      contributionStatement: goals.contributionStatement,
      spaceId: goals.spaceId,
      closedAt: goals.closedAt,
    })
    .from(goals)
    .where(
      activeOnly(
        goals,
        eq(goals.workspaceId, input.workspaceId),
        eq(goals.cycleId, input.cycleId),
        ...inScope,
      ),
    );

  const ids = rows.map((row) => row.id);
  if (ids.length === 0) {
    return { goals: [], goalDependencies: [], keyResultDependencies: [] };
  }

  // Key results serve three purposes at once: the KR-1 count, the owner of a
  // parent key result, and the join for the dependency register.
  // Chunked (P7-T01b): `inArray` sends one placeholder per id, and a cycle
  // with a hundred thousand goals blew past Postgres's 65,535-parameter
  // ceiling here before it could compute anything.
  const keyResultRows = await selectInChunks(ids, (batch) =>
    tx
      .select({ id: keyResults.id, goalId: keyResults.goalId })
      .from(keyResults)
      .where(
        activeOnly(
          keyResults,
          eq(keyResults.workspaceId, input.workspaceId),
          inArray(keyResults.goalId, batch),
        ),
      ),
  );

  const ownerOfKeyResult = new Map(
    keyResultRows.map((row) => [row.id, row.goalId]),
  );
  const countByGoal = new Map<string, number>();
  for (const row of keyResultRows) {
    countByGoal.set(row.goalId, (countByGoal.get(row.goalId) ?? 0) + 1);
  }

  const inScopeIds = new Set(ids);

  const dependencyRows = await tx
    .select({
      fromGoalId: goalDependencies.fromGoalId,
      toGoalId: goalDependencies.toGoalId,
    })
    .from(goalDependencies)
    .where(
      activeOnly(
        goalDependencies,
        eq(goalDependencies.workspaceId, input.workspaceId),
      ),
    );

  const registerRows = await selectInChunks(
    [...ownerOfKeyResult.keys()],
    (batch) =>
      tx
        .select({
          keyResultId: keyResultDependencies.keyResultId,
          providerSpaceId: keyResultDependencies.providerSpaceId,
        })
        .from(keyResultDependencies)
        .where(
          activeOnly(
            keyResultDependencies,
            eq(keyResultDependencies.workspaceId, input.workspaceId),
            inArray(keyResultDependencies.keyResultId, batch),
          ),
        ),
  );

  const outside = await outsideParentLevels(
    tx,
    input.workspaceId,
    rows,
    ownerOfKeyResult,
    inScopeIds,
  );

  return {
    goals: rows.map((row) => ({
      id: row.id,
      level: row.level,
      // The subtree walks follow parents inside the scope only: a space scope
      // asks whether this space's own tree hangs together.
      parentGoalId: resolveParent(row, ownerOfKeyResult, inScopeIds),
      // A parent outside it still aligns the goal (§5.1), so the share counts
      // it by level rather than as no parent.
      outsideParentLevel: outside.get(row.id) ?? null,
      standaloneReason: row.standaloneReason,
      contributionStatement: row.contributionStatement,
      spaceId: row.spaceId,
      keyResultCount: countByGoal.get(row.id) ?? 0,
      closed: row.closedAt !== null,
    })),
    // A link with one end outside the scope still counts: that is exactly the
    // link that proves a department is not siloed.
    goalDependencies: dependencyRows.map((row) => ({
      from: row.fromGoalId,
      to: row.toGoalId,
    })),
    keyResultDependencies: registerRows.flatMap((row) => {
      const goalId = ownerOfKeyResult.get(row.keyResultId);
      return goalId ? [{ goalId, providerSpaceId: row.providerSpaceId }] : [];
    }),
  };
}

/**
 * The level of each live parent outside the scope, by the goal it parents.
 *
 * Another space at space scope, and another cycle at either: §5.1 lets a
 * quarter's goal hang under an annual objective. Two small reads, one for
 * parent goals and one for parent key results through the goal that owns
 * them, and only over the pointers the scope could not resolve. A pointer to a
 * deleted parent finds nothing and so counts as no parent, which is what it
 * is.
 */
async function outsideParentLevels(
  tx: OperationTx,
  workspaceId: string,
  rows: readonly {
    id: string;
    parentGoalId: string | null;
    parentKeyResultId: string | null;
  }[],
  ownerOfKeyResult: Map<string, string>,
  inScope: Set<string>,
): Promise<Map<string, string>> {
  const goalParents = new Set<string>();
  const keyResultParents = new Set<string>();
  for (const row of rows) {
    if (row.parentGoalId && !inScope.has(row.parentGoalId)) {
      goalParents.add(row.parentGoalId);
    } else if (row.parentKeyResultId) {
      const owner = ownerOfKeyResult.get(row.parentKeyResultId);
      if (!owner || !inScope.has(owner)) {
        keyResultParents.add(row.parentKeyResultId);
      }
    }
  }

  const levelOfGoal = new Map<string, string>();
  if (goalParents.size > 0) {
    const found = await selectInChunks([...goalParents], (batch) =>
      tx
        .select({ id: goals.id, level: goals.level })
        .from(goals)
        .where(
          activeOnly(
            goals,
            eq(goals.workspaceId, workspaceId),
            inArray(goals.id, batch),
          ),
        ),
    );
    for (const row of found) {
      levelOfGoal.set(row.id, row.level);
    }
  }
  const levelOfKeyResult = new Map<string, string>();
  if (keyResultParents.size > 0) {
    const found = await selectInChunks([...keyResultParents], (batch) =>
      tx
        .select({ id: keyResults.id, level: goals.level })
        .from(keyResults)
        .innerJoin(goals, eq(goals.id, keyResults.goalId))
        .where(
          and(
            activeOnly(
              keyResults,
              eq(keyResults.workspaceId, workspaceId),
              inArray(keyResults.id, batch),
            ),
            activeOnly(goals, eq(goals.workspaceId, workspaceId)),
          ),
        ),
    );
    for (const row of found) {
      levelOfKeyResult.set(row.id, row.level);
    }
  }

  const levels = new Map<string, string>();
  for (const row of rows) {
    const level =
      (row.parentGoalId ? levelOfGoal.get(row.parentGoalId) : undefined) ??
      (row.parentKeyResultId
        ? levelOfKeyResult.get(row.parentKeyResultId)
        : undefined);
    if (level) {
      levels.set(row.id, level);
    }
  }
  return levels;
}

function resolveParent(
  row: {
    parentGoalId: string | null;
    parentKeyResultId: string | null;
  },
  ownerOfKeyResult: Map<string, string>,
  inScope: Set<string>,
): string | null {
  const resolved =
    row.parentGoalId ??
    (row.parentKeyResultId
      ? (ownerOfKeyResult.get(row.parentKeyResultId) ?? null)
      : null);
  if (resolved === null) {
    return null;
  }
  return inScope.has(resolved) ? resolved : null;
}

const KIND = "structure" as const;

interface FindingIdentity {
  readonly ruleKey: string;
  readonly subjectGoalId: string | null;
  readonly targetGoalId: string | null;
  /**
   * The key result this is about, when it is about one (P5-T14).
   *
   * Widening the identity is the whole reason this field exists. The divergence
   * sweep raised one finding per goal because a second collided with the first
   * and overwrote it, and a goal with three measures has three separate
   * conversations to have. Null on everything the four earlier sweeps write, so
   * their identity strings gain one more empty segment and nothing else.
   */
  readonly subjectKeyResultId?: string | null;
}

const identityOf = (finding: FindingIdentity): string =>
  `${finding.ruleKey} ${finding.subjectGoalId ?? ""} ${finding.targetGoalId ?? ""} ${finding.subjectKeyResultId ?? ""}`;

/**
 * Recomputes one scope and reconciles the findings table against the answer.
 *
 * Four rules from design §6, and each exists because the alternative breaks
 * something:
 *
 * - Upsert by identity, so a run does not duplicate what it found last time.
 * - A row already `dismissed` stays dismissed.
 * - A condition that cleared soft-deletes its row rather than flipping to a
 *   closed state, so "open findings" is one predicate rather than two.
 * - The engine filters on `source = 'engine'` before it touches anything. The
 *   Coach's semantic findings live in the same table, and clearing by scope
 *   rather than by source would delete its work every time somebody edited a
 *   weight.
 */
export async function recomputeAlignment(
  tx: OperationTx,
  input: AlignmentScopeInput,
): Promise<AlignmentResult> {
  const { result } = await alignmentInTx(tx, input);

  const scopeId = input.scope.kind === "space" ? input.scope.spaceId : null;

  await reconcileFindingsInTx(tx, {
    workspaceId: input.workspaceId,
    cycleId: input.cycleId,
    scope: input.scope.kind,
    scopeId,
    source: "engine",
    kind: KIND,
    wanted: result.findings.map((finding) => ({
      ruleKey: finding.ruleKey,
      subjectGoalId: finding.subjectGoalId,
      targetGoalId: null,
      severity: finding.severity,
      reason: finding.reason,
    })),
  });

  return result;
}

/** One finding the caller wants to exist, in the shape the table stores. */
export interface WantedFinding {
  readonly ruleKey: string;
  readonly subjectGoalId: string | null;
  readonly targetGoalId: string | null;
  /** The measure this is about, when it is about one (P5-T14). */
  readonly subjectKeyResultId?: string | null;
  readonly severity: AlignmentSeverity;
  readonly reason: string;
}

/**
 * Reconciles one (scope, source) slice of the findings table against what the
 * caller says should be there (P4-T06b-a).
 *
 * Extracted from `recomputeAlignment`, which was the only caller until the
 * Coach's divergence detection needed the same four guarantees. **Sharing it is
 * the point rather than a tidiness:** "a dismissal survives" and "a cleared
 * condition soft-deletes" are promises the product makes to a facilitator, and a
 * second copy of them is a second set of promises that will drift.
 *
 * The four rules, each because the alternative breaks something:
 *
 * - Upsert by identity, so a run does not duplicate what it found last time.
 * - A row already dismissed stays dismissed. Only the wording and the severity
 *   are refreshed, because those move when a threshold moves and the state is
 *   the facilitator's rather than ours.
 * - A condition that cleared soft-deletes its row rather than flipping to a
 *   closed state, so "open findings" stays one predicate. A returning condition
 *   gets a fresh row in `open`, because the facilitator dismissed the finding
 *   they saw, not every finding that rule will ever raise.
 * - **The slice is (scope, source) and never scope alone.** The engine's
 *   structural findings and the Coach's live in one table, and clearing by
 *   scope would delete the other's work on every write.
 */
export async function reconcileFindingsInTx(
  tx: OperationTx,
  input: {
    readonly workspaceId: string;
    readonly cycleId: string;
    readonly scope: "workspace" | "space";
    readonly scopeId: string | null;
    readonly source: "engine" | "coach";
    readonly kind: AlignmentFindingKind;
    readonly wanted: readonly WantedFinding[];
    /**
     * The goals this sweep could see, when it could not see them all
     * (completeness review H-04). A finding about any other goal is left as it
     * is: a sweep that read a scoped set and then closed every finding outside
     * it would be retracting what it never looked at.
     */
    readonly subjectGoalIds?: ReadonlySet<string>;
  },
): Promise<void> {
  const scopeMatch = and(
    eq(alignmentFindings.workspaceId, input.workspaceId),
    eq(alignmentFindings.cycleId, input.cycleId),
    eq(alignmentFindings.scope, input.scope),
    input.scopeId === null
      ? isNull(alignmentFindings.scopeId)
      : eq(alignmentFindings.scopeId, input.scopeId),
    eq(alignmentFindings.source, input.source),
    // Within one source, one kind at a time. The Coach raises divergence and,
    // from P4-T06b-b, relink, dependency, conflict and gap; a sweep for one of
    // them must not soft-delete another's rows for being absent from its list.
    eq(alignmentFindings.kind, input.kind),
  );

  const allExisting = await tx
    .select({
      id: alignmentFindings.id,
      ruleKey: alignmentFindings.ruleKey,
      subjectGoalId: alignmentFindings.subjectGoalId,
      targetGoalId: alignmentFindings.targetGoalId,
      subjectKeyResultId: alignmentFindings.subjectKeyResultId,
      state: alignmentFindings.state,
    })
    .from(alignmentFindings)
    .where(activeOnly(alignmentFindings, scopeMatch));
  const within = input.subjectGoalIds;
  const existing = within
    ? allExisting.filter(
        (row) => row.subjectGoalId !== null && within.has(row.subjectGoalId),
      )
    : allExisting;

  const byIdentity = new Map(
    existing.map((row) => [
      identityOf({
        ruleKey: row.ruleKey ?? "",
        subjectGoalId: row.subjectGoalId,
        targetGoalId: row.targetGoalId,
        subjectKeyResultId: row.subjectKeyResultId,
      }),
      row,
    ]),
  );

  const now = new Date();
  const wantedIdentities = new Set<string>();

  for (const finding of input.wanted) {
    const identity = identityOf(finding);
    wantedIdentities.add(identity);
    const match = byIdentity.get(identity);
    if (match) {
      // openokr:allow-mutation: the calling Operation's own transaction.
      await tx
        .update(alignmentFindings)
        .set({
          severity: finding.severity,
          reason: finding.reason,
          updatedAt: now,
        })
        .where(
          activeOnly(alignmentFindings, eq(alignmentFindings.id, match.id)),
        );
      continue;
    }
    // openokr:allow-mutation: same transaction.
    await tx.insert(alignmentFindings).values({
      id: newId(),
      workspaceId: input.workspaceId,
      scope: input.scope,
      scopeId: input.scopeId,
      cycleId: input.cycleId,
      kind: input.kind,
      severity: finding.severity,
      subjectGoalId: finding.subjectGoalId,
      targetGoalId: finding.targetGoalId,
      subjectKeyResultId: finding.subjectKeyResultId ?? null,
      reason: finding.reason,
      ruleKey: finding.ruleKey,
      source: input.source,
      state: "open",
    });
  }

  const stale = existing.filter(
    (row) =>
      !wantedIdentities.has(
        identityOf({
          ruleKey: row.ruleKey ?? "",
          subjectGoalId: row.subjectGoalId,
          targetGoalId: row.targetGoalId,
          subjectKeyResultId: row.subjectKeyResultId,
        }),
      ),
  );

  if (stale.length > 0) {
    // openokr:allow-mutation: same transaction.
    await tx
      .update(alignmentFindings)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        activeOnly(
          alignmentFindings,
          inArray(
            alignmentFindings.id,
            stale.map((row) => row.id),
          ),
        ),
      );
  }
}

/**
 * Every scope one goal belongs to (design §7).
 *
 * The workspace always, and the goal's own space when it has one. A write that
 * moves a goal between spaces recomputes both, which is why the caller passes
 * the spaces rather than this reading them back after the change.
 */
export function scopesForGoal(
  spaceIds: readonly (string | null)[],
): AlignmentScope[] {
  const scopes: AlignmentScope[] = [{ kind: "workspace" }];
  const seen = new Set<string>();
  for (const spaceId of spaceIds) {
    if (spaceId && !seen.has(spaceId)) {
      seen.add(spaceId);
      scopes.push({ kind: "space", spaceId });
    }
  }
  return scopes;
}

/**
 * Whether this key result dependency blocks publish gate 4 (METHOD.md §5.4):
 * neither confirmed by the providing team, nor escalated to the sponsor, nor
 * logged as a risk with a named owner.
 */
export function blocksPublish(dependency: {
  readonly confirmed: boolean;
  readonly riskOwnerId: string | null;
  readonly escalatedToId: string | null;
}): boolean {
  return (
    !dependency.confirmed &&
    dependency.riskOwnerId === null &&
    dependency.escalatedToId === null
  );
}

/** The register for one cycle's key results, for gate 4 and the S-10 panel. */
export async function loadDependencyRegister(
  tx: OperationTx,
  workspaceId: string,
  keyResultIds: readonly string[],
) {
  // Chunked (P7-T01b), for the reason the graph above is.
  return selectInChunks(keyResultIds, (batch) =>
    tx
      .select({
        id: keyResultDependencies.id,
        keyResultId: keyResultDependencies.keyResultId,
        providerSpaceId: keyResultDependencies.providerSpaceId,
        providerText: keyResultDependencies.providerText,
        note: keyResultDependencies.note,
        confirmed: keyResultDependencies.confirmed,
        riskOwnerId: keyResultDependencies.riskOwnerId,
        escalatedToId: keyResultDependencies.escalatedToId,
        escalatedAt: keyResultDependencies.escalatedAt,
      })
      .from(keyResultDependencies)
      .where(
        activeOnly(
          keyResultDependencies,
          eq(keyResultDependencies.workspaceId, workspaceId),
          inArray(keyResultDependencies.keyResultId, batch),
        ),
      )
      .orderBy(sql`${keyResultDependencies.createdAt} asc`),
  );
}
