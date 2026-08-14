/**
 * Loading the workflow snapshot and recomputing the gates (TECHNICAL-PLAN §4.3,
 * METHOD.md §2.3, §4.5, P3-T03).
 *
 * `packages/method` decides; this module gathers what it decides on and stores
 * the six gate rows the result implies. The split is the point: the rules are
 * pure and testable without a database, and this file has no opinions.
 *
 * **`cycle_gate_state` is a cache of an evaluation, never a decision.** It exists
 * so a list of cycles can show its gates without evaluating each one, and it is
 * recomputed on every write that could change it. Nothing reads it to decide
 * whether publication is allowed: `publishCycle` re-evaluates first, because a
 * stale row is exactly how a set gets published through a red gate.
 */
import {
  activeOnly,
  annualFrames,
  annualStrategies,
  type Cycle,
  cycleBaselineHealth,
  cycleCapacityNotes,
  cycleFocusKeyResults,
  cycleGateState,
  cycleIssues,
  cyclePackItems,
  cyclePriorities,
  cyclePriorScores,
  cycleRevalidations,
  cycles,
  goals,
  keyResultDependencies,
  keyResults,
  newId,
  type WorkspaceTx,
} from "@openokr/db";
import {
  type CycleWorkflowInput,
  canPublish,
  type GateResult,
  type GoalSnapshot,
  INPUT_PACK_ITEMS,
  type PhaseResult,
  phaseCompletion,
  publishGates,
  type ResolvedThresholds,
} from "@openokr/method";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

type AnyTx<TSchema extends Record<string, unknown> = Record<string, never>> =
  WorkspaceTx<TSchema>;

export interface WorkflowSnapshot {
  readonly input: CycleWorkflowInput;
  readonly phases: readonly PhaseResult[];
  readonly gates: readonly GateResult[];
  readonly publishable: boolean;
}

/**
 * Everything the workflow reads, in one pass over the cycle's children.
 *
 * The quality engine, sessions and the cycle retrospective are left `undefined`
 * rather than defaulted, because `packages/method` treats "no rows" and "no such
 * table yet" as different facts and only one of them lets a gate pass. Each
 * becomes a real field as its task lands: P4-T01, P4-T04 and P4-T08. Goals
 * stopped being one of them at P3-T04.
 */
export async function loadWorkflowInput<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  cycle: Pick<
    Cycle,
    | "id"
    | "mode"
    | "firstCycle"
    | "startsOn"
    | "endsOn"
    | "publicationDeadline"
    | "publishedAt"
    | "sponsorId"
    | "facilitatorId"
    | "packDistributedAt"
    | "sessionDates"
    | "frameId"
  >,
): Promise<CycleWorkflowInput> {
  const cycleId = cycle.id;

  const [packItems, priorScores, issues, priorities, focusRows] =
    await Promise.all([
      tx
        .select({
          itemKey: cyclePackItems.itemKey,
          gathered: cyclePackItems.gathered,
        })
        .from(cyclePackItems)
        .where(
          activeOnly(
            cyclePackItems,
            eq(cyclePackItems.workspaceId, workspaceId),
            eq(cyclePackItems.cycleId, cycleId),
          ),
        ),
      tx
        .select({ score: cyclePriorScores.score })
        .from(cyclePriorScores)
        .where(
          activeOnly(
            cyclePriorScores,
            eq(cyclePriorScores.workspaceId, workspaceId),
            eq(cyclePriorScores.cycleId, cycleId),
          ),
        ),
      tx
        .select({ impact: cycleIssues.impact })
        .from(cycleIssues)
        .where(
          activeOnly(
            cycleIssues,
            eq(cycleIssues.workspaceId, workspaceId),
            eq(cycleIssues.cycleId, cycleId),
          ),
        ),
      tx
        .select({ successStatement: cyclePriorities.successStatement })
        .from(cyclePriorities)
        .where(
          activeOnly(
            cyclePriorities,
            eq(cyclePriorities.workspaceId, workspaceId),
            eq(cyclePriorities.cycleId, cycleId),
          ),
        ),
      tx
        .select({ id: cycleFocusKeyResults.id })
        .from(cycleFocusKeyResults)
        .where(
          activeOnly(
            cycleFocusKeyResults,
            eq(cycleFocusKeyResults.workspaceId, workspaceId),
            eq(cycleFocusKeyResults.cycleId, cycleId),
          ),
        ),
    ]);

  const [baseline] = await tx
    .select({
      cycleId: cycleBaselineHealth.cycleId,
      stable: cycleBaselineHealth.stable,
    })
    .from(cycleBaselineHealth)
    .where(
      activeOnly(
        cycleBaselineHealth,
        eq(cycleBaselineHealth.cycleId, cycleId),
        eq(cycleBaselineHealth.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  const [revalidation] = await tx
    .select({
      holds: cycleRevalidations.holds,
      changed: cycleRevalidations.changed,
      changeNote: cycleRevalidations.changeNote,
      focusNote: cycleRevalidations.focusNote,
    })
    .from(cycleRevalidations)
    .where(
      activeOnly(
        cycleRevalidations,
        eq(cycleRevalidations.cycleId, cycleId),
        eq(cycleRevalidations.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  const [capacity] = await tx
    .select({ cuts: cycleCapacityNotes.cuts })
    .from(cycleCapacityNotes)
    .where(
      activeOnly(
        cycleCapacityNotes,
        eq(cycleCapacityNotes.cycleId, cycleId),
        eq(cycleCapacityNotes.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  const frame = await loadFrameSnapshot(tx, workspaceId, cycle.frameId);

  // The earliest booked session, which is what the §2.6 pack lead is measured
  // against. `session_dates` is a jsonb array rather than a table because
  // nothing joins to a date; the real session rows are domain G at P4-T04.
  const sessionDates = Array.isArray(cycle.sessionDates)
    ? cycle.sessionDates
    : [];
  const firstSessionOn =
    sessionDates
      .map((entry) => (entry as { on?: string }).on)
      .filter((on): on is string => typeof on === "string" && on !== "")
      .sort()[0] ?? null;

  return {
    mode: cycle.mode,
    firstCycle: cycle.firstCycle,
    startsOn: cycle.startsOn,
    publicationDeadline: cycle.publicationDeadline,
    publishedAt: cycle.publishedAt,
    sponsorId: cycle.sponsorId,
    facilitatorId: cycle.facilitatorId,
    packDistributedAt: cycle.packDistributedAt,
    firstSessionOn,
    packItems,
    // `numeric` comes back as a string, and a string compared against null would
    // make every prior score look present.
    priorScores: priorScores.map((row) => ({
      score: row.score === null ? null : Number(row.score),
    })),
    hasBaselineHealth: Boolean(baseline),
    issues,
    priorities,
    revalidation: revalidation ?? null,
    focusKeyResultCount: focusRows.length,
    hasCapacityNotes: Boolean(capacity?.cuts),
    frame,
    goals: await loadGoalSnapshots(tx, workspaceId, cycleId),
  };
}

/**
 * The cycle's goals as the gates need to see them (P3-T04).
 *
 * This is the field that was `undefined` through P3-T03, and supplying it is what
 * makes phases 0, 3 and 4 and gates 1, 3 and 5 evaluable at all.
 *
 * `dependencies` stays undefined on every key result, because the §5.4 register
 * arrives at P3-T09. That keeps gate 4 honestly unevaluable rather than passing
 * it on an empty list nobody could have filled in.
 */
async function loadGoalSnapshots<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  cycleId: string,
): Promise<GoalSnapshot[]> {
  const rows = await tx
    .select({
      id: goals.id,
      title: goals.title,
      level: goals.level,
      championId: goals.championId,
      reviewerId: goals.reviewerId,
      parentGoalId: goals.parentGoalId,
      parentKeyResultId: goals.parentKeyResultId,
      contributionStatement: goals.contributionStatement,
    })
    .from(goals)
    .where(
      activeOnly(
        goals,
        eq(goals.workspaceId, workspaceId),
        eq(goals.cycleId, cycleId),
      ),
    );

  if (rows.length === 0) {
    return [];
  }

  const children = await tx
    .select({
      id: keyResults.id,
      goalId: keyResults.goalId,
      title: keyResults.title,
      capacity: keyResults.capacity,
    })
    .from(keyResults)
    .where(
      activeOnly(
        keyResults,
        eq(keyResults.workspaceId, workspaceId),
        inArray(
          keyResults.goalId,
          rows.map((row) => row.id),
        ),
      ),
    );

  // The §5.4 register, which is what makes publish gate 4 evaluable at all
  // (P3-T09). An empty array is a real answer: this key result has no
  // dependencies, so there is nothing unconfirmed to block on. `undefined` is
  // what the evaluator reads as "nobody has checked", and it must not appear
  // here again now that the table exists.
  const dependencies = await tx
    .select({
      keyResultId: keyResultDependencies.keyResultId,
      confirmed: keyResultDependencies.confirmed,
      riskOwnerId: keyResultDependencies.riskOwnerId,
    })
    .from(keyResultDependencies)
    .where(
      activeOnly(
        keyResultDependencies,
        eq(keyResultDependencies.workspaceId, workspaceId),
        inArray(
          keyResultDependencies.keyResultId,
          children.map((child) => child.id),
        ),
      ),
    );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    level: row.level,
    championId: row.championId,
    reviewerId: row.reviewerId,
    hasParent: Boolean(row.parentGoalId ?? row.parentKeyResultId),
    contributionStatement: row.contributionStatement,
    keyResults: children
      .filter((child) => child.goalId === row.id)
      .map((child) => ({
        id: child.id,
        title: child.title,
        capacity: child.capacity,
        dependencies: dependencies
          .filter((dependency) => dependency.keyResultId === child.id)
          .map((dependency) => ({
            confirmed: dependency.confirmed,
            riskOwnerId: dependency.riskOwnerId,
          })),
      })),
  }));
}

async function loadFrameSnapshot<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, workspaceId: string, frameId: string | null) {
  const [frame] = await tx
    .select({
      id: annualFrames.id,
      mission: annualFrames.mission,
      strategy: annualFrames.strategy,
      notDoing: annualFrames.notDoing,
      agreed: annualFrames.agreed,
    })
    .from(annualFrames)
    .where(
      frameId
        ? activeOnly(annualFrames, eq(annualFrames.id, frameId))
        : activeOnly(
            annualFrames,
            eq(annualFrames.workspaceId, workspaceId),
            isNull(annualFrames.supersededAt),
          ),
    )
    .limit(1);

  if (!frame) {
    return null;
  }

  const strategies = await tx
    .select({ id: annualStrategies.id })
    .from(annualStrategies)
    .where(
      activeOnly(
        annualStrategies,
        eq(annualStrategies.workspaceId, workspaceId),
        eq(annualStrategies.frameId, frame.id),
      ),
    );

  // The key results of the annual cycles that sit under this frame. §2.3's
  // quarterly phase 3 reads this to decide whether "focus areas chosen" means
  // picking annual key results or writing a focus note: with nothing to point at,
  // a note is the only honest answer (P3-T04).
  const annualKeyResults = await tx
    .select({ id: keyResults.id })
    .from(keyResults)
    .innerJoin(goals, eq(goals.id, keyResults.goalId))
    .innerJoin(cycles, eq(cycles.id, goals.cycleId))
    .where(
      and(
        activeOnly(keyResults, eq(keyResults.workspaceId, workspaceId)),
        isNull(goals.deletedAt),
        eq(cycles.frameId, frame.id),
        eq(cycles.mode, "annual"),
      ),
    );

  return {
    hasMission: Boolean(frame.mission),
    hasStrategy: Boolean(frame.strategy),
    strategyCount: strategies.length,
    notDoingWritten: Boolean(frame.notDoing),
    agreed: frame.agreed,
    annualKeyResultCount: annualKeyResults.length,
  };
}

/** The cycle row the loader needs, by id. */
export async function loadCycleForWorkflow<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, workspaceId: string, cycleId: string) {
  const [cycle] = await tx
    .select({
      id: cycles.id,
      name: cycles.name,
      mode: cycles.mode,
      phase: cycles.phase,
      status: cycles.status,
      firstCycle: cycles.firstCycle,
      startsOn: cycles.startsOn,
      endsOn: cycles.endsOn,
      publicationDeadline: cycles.publicationDeadline,
      publishedAt: cycles.publishedAt,
      sponsorId: cycles.sponsorId,
      facilitatorId: cycles.facilitatorId,
      packDistributedAt: cycles.packDistributedAt,
      sessionDates: cycles.sessionDates,
      frameId: cycles.frameId,
    })
    .from(cycles)
    .where(
      activeOnly(
        cycles,
        eq(cycles.id, cycleId),
        eq(cycles.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return cycle;
}

/** Loads, evaluates, and returns everything a surface or a write needs. */
export async function evaluateWorkflow<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  cycle: Parameters<typeof loadWorkflowInput>[2],
  thresholds: ResolvedThresholds,
): Promise<WorkflowSnapshot> {
  const input = await loadWorkflowInput(tx, workspaceId, cycle);
  const gates = publishGates(input);
  return {
    input,
    phases: phaseCompletion(input, thresholds),
    gates,
    publishable: canPublish(gates),
  };
}

/**
 * Writes the six gate rows for a cycle, one per gate, replacing what was there.
 *
 * Called from inside an Operation's `execute` after any write that could change a
 * gate, which is what TECHNICAL-PLAN §4.3 means by "recomputed on every relevant
 * write". Upserted by `(workspace_id, cycle_id, gate_key)` so the row count stays
 * at six and each gate keeps its identity across evaluations.
 */
export async function recomputeGateState<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  cycleId: string,
  gates: readonly GateResult[],
): Promise<void> {
  const existing = await tx
    .select({ id: cycleGateState.id, gateKey: cycleGateState.gateKey })
    .from(cycleGateState)
    .where(
      activeOnly(
        cycleGateState,
        eq(cycleGateState.workspaceId, workspaceId),
        eq(cycleGateState.cycleId, cycleId),
      ),
    );
  const byKey = new Map(existing.map((row) => [row.gateKey, row.id]));

  for (const gate of gates) {
    const values = {
      passed: gate.passed,
      evaluable: gate.evaluable,
      evaluatedAt: new Date(),
      detail: {
        missing: [...gate.detail.missing],
        ...(gate.detail.blocked ? { blocked: gate.detail.blocked } : {}),
      },
      updatedAt: new Date(),
    };
    const id = byKey.get(gate.gateKey);
    if (id) {
      // openokr:allow-mutation: runs on the transaction the calling Operation
      // opened, so the gate rows commit with the change that invalidated them.
      await tx
        .update(cycleGateState)
        .set(values)
        .where(activeOnly(cycleGateState, eq(cycleGateState.id, id)));
      continue;
    }
    // openokr:allow-mutation: the calling Operation's own transaction.
    await tx.insert(cycleGateState).values({
      id: newId(),
      workspaceId,
      cycleId,
      gateKey: gate.gateKey,
      ...values,
    });
  }
}

/**
 * The seven §2.6 input-pack rows, created on first use.
 *
 * Rows rather than seven booleans on the cycle, so each carries its own note.
 * Created lazily instead of at cycle creation, because a cycle that nobody has
 * opened yet has nothing to say about its pack, and seven empty rows per cycle
 * per workspace is a lot of nothing.
 */
export async function ensurePackItemsInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, workspaceId: string, cycleId: string): Promise<void> {
  const existing = await tx
    .select({ itemKey: cyclePackItems.itemKey })
    .from(cyclePackItems)
    .where(
      activeOnly(
        cyclePackItems,
        eq(cyclePackItems.workspaceId, workspaceId),
        eq(cyclePackItems.cycleId, cycleId),
      ),
    );
  const present = new Set(existing.map((row) => row.itemKey));

  for (let itemKey = 1; itemKey <= INPUT_PACK_ITEMS.length; itemKey++) {
    if (present.has(itemKey)) {
      continue;
    }
    // openokr:allow-mutation: the calling Operation's own transaction.
    await tx.insert(cyclePackItems).values({
      id: newId(),
      workspaceId,
      cycleId,
      itemKey,
      gathered: false,
    });
  }
}

/**
 * All seven §2.6 items in order, whether or not a row exists for one.
 *
 * The list is canon, not data: §2.6 names the seven, and a cycle nobody has
 * opened yet has simply gathered none of them. Returning only the rows would
 * make the phase 1 surface show an empty list until something wrote, and the
 * alternative, having a read create the rows, is a read that writes.
 */
export async function readPackItems<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, workspaceId: string, cycleId: string) {
  const rows = await tx
    .select({
      id: cyclePackItems.id,
      itemKey: cyclePackItems.itemKey,
      gathered: cyclePackItems.gathered,
      note: cyclePackItems.note,
    })
    .from(cyclePackItems)
    .where(
      activeOnly(
        cyclePackItems,
        eq(cyclePackItems.workspaceId, workspaceId),
        eq(cyclePackItems.cycleId, cycleId),
      ),
    )
    .orderBy(asc(cyclePackItems.itemKey));

  const byKey = new Map(rows.map((row) => [row.itemKey, row]));

  return INPUT_PACK_ITEMS.map((label, index) => {
    const itemKey = index + 1;
    const row = byKey.get(itemKey);
    return {
      id: row?.id ?? null,
      itemKey,
      label,
      gathered: row?.gathered ?? false,
      note: row?.note ?? null,
    };
  });
}
