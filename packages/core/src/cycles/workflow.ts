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
  initiativeKeyResults,
  initiatives,
  keyResultDependencies,
  keyResults,
  newId,
  okrSessions,
  retroNotes,
  type WorkspaceTx,
} from "@openokr/db";
import {
  type CycleWorkflowInput,
  canPublish,
  type GateResult,
  type GoalSnapshot,
  INPUT_PACK_ITEMS,
  type InitiativeSnapshot,
  type PhaseResult,
  phaseCompletion,
  publishGates,
  type ResolvedThresholds,
} from "@openokr/method";
import {
  and,
  asc,
  count,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  or,
} from "drizzle-orm";
import { practiceFromRow } from "../practice/settings.ts";
import { loadCycleCadence } from "../sessions/booking.ts";
import { readRhythmRow, workspaceTimeZone } from "./service.ts";

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
 * Every input is read here since the completeness review (H-08, H-09): the
 * booked cadence, the scores and the retrospective. `packages/method` still
 * treats "no rows" and "not read" as different facts, so a field left
 * `undefined` by a caller reports its phase as unanswered rather than passed.
 * Phase 4 judges the goal snapshots itself, so it needs no field of its own.
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
    | "companyPublishedAt"
    | "sponsorId"
    | "facilitatorId"
    | "packDistributedAt"
    | "sessionDates"
    | "frameId"
  >,
): Promise<CycleWorkflowInput> {
  const cycleId = cycle.id;

  // One await per query, deliberately, and never `Promise.all`. A transaction
  // is a single connection: five queries started together on it do not run in
  // parallel, they queue inside the driver, and `pg` 9 removes that queue and
  // throws on the second one instead. Sequential costs nothing here because the
  // queue was serialising them anyway.
  const packItems = await tx
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
    );

  const priorScores = await tx
    .select({ score: cyclePriorScores.score })
    .from(cyclePriorScores)
    .where(
      activeOnly(
        cyclePriorScores,
        eq(cyclePriorScores.workspaceId, workspaceId),
        eq(cyclePriorScores.cycleId, cycleId),
      ),
    );

  const issues = await tx
    .select({ impact: cycleIssues.impact })
    .from(cycleIssues)
    .where(
      activeOnly(
        cycleIssues,
        eq(cycleIssues.workspaceId, workspaceId),
        eq(cycleIssues.cycleId, cycleId),
      ),
    );

  const priorities = await tx
    .select({ successStatement: cyclePriorities.successStatement })
    .from(cyclePriorities)
    .where(
      activeOnly(
        cyclePriorities,
        eq(cyclePriorities.workspaceId, workspaceId),
        eq(cyclePriorities.cycleId, cycleId),
      ),
    );

  const focusRows = await tx
    .select({ id: cycleFocusKeyResults.id })
    .from(cycleFocusKeyResults)
    .where(
      activeOnly(
        cycleFocusKeyResults,
        eq(cycleFocusKeyResults.workspaceId, workspaceId),
        eq(cycleFocusKeyResults.cycleId, cycleId),
      ),
    );

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

  const frame = await loadFrameSnapshot(tx, workspaceId, cycle);

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

  // METHOD.md §2.3, P9-T02: a cycle with no earlier cycle of its own mode
  // is a first cycle whether or not anybody declared it, so a new workspace
  // never meets "the prior cycle is not scored" for a prior cycle that does
  // not exist. The declaration still counts for a workspace that made one.
  const [earlier] = cycle.firstCycle
    ? [undefined]
    : await tx
        .select({ id: cycles.id })
        .from(cycles)
        .where(
          activeOnly(
            cycles,
            eq(cycles.workspaceId, workspaceId),
            eq(cycles.mode, cycle.mode),
            lt(cycles.startsOn, cycle.startsOn),
          ),
        )
        .limit(1);

  return {
    mode: cycle.mode,
    firstCycle: cycle.firstCycle || earlier === undefined,
    startsOn: cycle.startsOn,
    publicationDeadline: cycle.publicationDeadline,
    publishedAt: cycle.publishedAt,
    companyPublishedAt: cycle.companyPublishedAt,
    // How hard each check and gate is here (METHOD.md §12). Read with the
    // rest of the input, so phase 4, the gates and publication all judge by
    // the workspace's practice rather than the recommended one (P9-T03b).
    practice: practiceFromRow(await readRhythmRow(tx, workspaceId)).practice,
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
    annualKeyResultCount: (await loadFocusCandidates(tx, workspaceId, cycle))
      .length,
    hasCapacityNotes: Boolean(capacity?.cuts),
    frame,
    goals: await loadGoalSnapshots(tx, workspaceId, cycleId),
    initiatives: await loadInitiativeSnapshots(tx, workspaceId, cycleId),
    // Phase 7: every key result scored, and the retrospective written
    // (completeness review H-09).
    ...(await loadReviewAndLearn(tx, workspaceId, cycle)),
    // Phase 6: the §7.1 rhythm booked for the whole cycle, and at least one
    // decision recorded (completeness review H-08).
    cadence: await loadCycleCadence(
      tx,
      workspaceId,
      {
        id: cycleId,
        startsOn: cycle.startsOn,
        endsOn: cycle.endsOn,
        mode: cycle.mode,
      },
      await workspaceTimeZone(tx, workspaceId),
    ),
  };
}

/**
 * Phase 7's two conditions (METHOD.md §2.3: "Every key result scored and the
 * retrospective written"; completeness review H-09).
 *
 * **Scored** means `key_results.score` is set, which the quarterly review
 * writes back when it closes (P4-T10b-a). A cycle with no key results has
 * nothing scored, not everything.
 *
 * **The retrospective** is §8.1 stage five, the team retro, held in a
 * quarterly review of this cycle: one note in either column is a retro that
 * happened. A review booked before sessions carried a cycle counts when it
 * falls inside the cycle or the week after its close, the same reading
 * `sessions/booking.ts` gives "at cycle close".
 */
async function loadReviewAndLearn<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  cycle: Pick<Cycle, "id" | "startsOn" | "endsOn">,
): Promise<{ allKeyResultsScored: boolean; retrospectiveWritten: boolean }> {
  const [tally] = await tx
    .select({ total: count(), scored: count(keyResults.score) })
    .from(keyResults)
    .innerJoin(goals, eq(goals.id, keyResults.goalId))
    .where(
      activeOnly(
        keyResults,
        eq(keyResults.workspaceId, workspaceId),
        eq(goals.cycleId, cycle.id),
        isNull(goals.deletedAt),
      ),
    );
  const total = Number(tally?.total ?? 0);

  const earliest = new Date(`${cycle.startsOn}T00:00:00Z`);
  earliest.setUTCDate(earliest.getUTCDate() - 1);
  const latest = new Date(`${cycle.endsOn}T00:00:00Z`);
  latest.setUTCDate(latest.getUTCDate() + 9);
  const [note] = await tx
    .select({ id: retroNotes.id })
    .from(retroNotes)
    .innerJoin(okrSessions, eq(okrSessions.id, retroNotes.sessionId))
    .where(
      activeOnly(
        retroNotes,
        eq(retroNotes.workspaceId, workspaceId),
        isNull(okrSessions.deletedAt),
        eq(okrSessions.kind, "quarterly"),
        or(
          eq(okrSessions.cycleId, cycle.id),
          and(
            isNull(okrSessions.cycleId),
            gte(okrSessions.scheduledFor, earliest),
            lte(okrSessions.scheduledFor, latest),
          ),
        ),
      ),
    )
    .limit(1);

  return {
    allKeyResultsScored: total > 0 && Number(tally?.scored ?? 0) === total,
    retrospectiveWritten: Boolean(note),
  };
}

/**
 * The initiatives serving this cycle's key results (METHOD.md §5.5, P5-T10a).
 *
 * **Reached through the key results, because that is the only relationship §5.5
 * describes.** An initiative has no cycle of its own: a project that moves a key
 * result in this cycle is in this cycle's capacity check, and the same project
 * moving a key result in the next one is in that check too. A `cycle_id` column
 * would be a second answer, and the two would disagree the first time an
 * initiative served both.
 *
 * An empty array is a real answer and `undefined` is not returned from here:
 * the table exists, so gate 5 is evaluable, and a cycle with no initiatives
 * recorded fails only on `hasCapacityNotes` as it did before.
 */
async function loadInitiativeSnapshots<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  cycleId: string,
): Promise<InitiativeSnapshot[]> {
  const rows = await tx
    .selectDistinct({
      id: initiatives.id,
      title: initiatives.title,
      capacity: initiatives.capacity,
      kind: goals.kind,
    })
    .from(initiatives)
    .innerJoin(
      initiativeKeyResults,
      and(
        eq(initiativeKeyResults.initiativeId, initiatives.id),
        eq(initiativeKeyResults.workspaceId, workspaceId),
        isNull(initiativeKeyResults.deletedAt),
      ),
    )
    .innerJoin(
      keyResults,
      and(
        eq(keyResults.id, initiativeKeyResults.keyResultId),
        eq(keyResults.workspaceId, workspaceId),
        isNull(keyResults.deletedAt),
      ),
    )
    .innerJoin(
      goals,
      and(
        eq(goals.id, keyResults.goalId),
        eq(goals.workspaceId, workspaceId),
        eq(goals.cycleId, cycleId),
        isNull(goals.deletedAt),
      ),
    )
    .where(activeOnly(initiatives, eq(initiatives.workspaceId, workspaceId)));

  // One row per kind an initiative serves. It counts as committed when any
  // objective it serves is (METHOD.md §5.5, P9-T11b-b): work a commitment
  // depends on is part of the commitment, whatever else it also feeds.
  const byId = new Map<string, InitiativeSnapshot>();
  for (const row of rows) {
    const seen = byId.get(row.id);
    if (!seen || row.kind === "committed") {
      byId.set(row.id, {
        id: row.id,
        title: row.title,
        capacity: row.capacity,
        kind: row.kind,
      });
    }
  }
  return [...byId.values()];
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
      standaloneReason: goals.standaloneReason,
      kind: goals.kind,
    })
    .from(goals)
    .where(
      activeOnly(
        goals,
        eq(goals.workspaceId, workspaceId),
        eq(goals.cycleId, cycleId),
        // An objective started mid-cycle faces the checks set to block when
        // it is written, never the set-level gates (METHOD.md §4.5, §2.9).
        isNull(goals.addedMidCycleAt),
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
      keyResultKind: keyResults.kind,
      // Publish gate 2 judges the §4.2 checks over the whole set, so the fields
      // those checks read travel with the snapshot.
      baselineValue: keyResults.baselineValue,
      targetValue: keyResults.targetValue,
      dueOn: keyResults.dueOn,
      ownerId: keyResults.ownerId,
      indicatorType: keyResults.indicatorType,
      direction: keyResults.direction,
      confidence: keyResults.confidence,
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
        // And a key result started mid-cycle under a planned objective.
        isNull(keyResults.addedMidCycleAt),
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
      escalatedToId: keyResultDependencies.escalatedToId,
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
    standaloneReason: row.standaloneReason,
    keyResults: children
      .filter((child) => child.goalId === row.id)
      .map((child) => ({
        id: child.id,
        title: child.title,
        capacity: child.capacity,
        // Gate 5 holds back only committed work at "exceeds" (§5.5).
        kind: row.kind,
        dependencies: dependencies
          .filter((dependency) => dependency.keyResultId === child.id)
          .map((dependency) => ({
            confirmed: dependency.confirmed,
            riskOwnerId: dependency.riskOwnerId,
            escalatedToId: dependency.escalatedToId,
          })),
        // `numeric` arrives as a string, and a string where §4.2 expects a
        // number makes every comparison read as a missing value.
        quality: {
          baseline: Number(child.baselineValue),
          target: child.targetValue === null ? null : Number(child.targetValue),
          dueOn: child.dueOn,
          ownerId: child.ownerId,
          indicatorType: child.indicatorType,
          direction: child.direction,
          confidence:
            child.confidence === null ? null : Number(child.confidence),
          keyResultKind: child.keyResultKind,
        },
      })),
  }));
}

async function loadFrameSnapshot<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  cycle: Pick<Cycle, "frameId" | "startsOn" | "endsOn">,
) {
  const frameId = cycle.frameId;
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

  // The key results of the year this cycle sits in. §2.3's quarterly phase 3
  // reads this to decide whether "focus areas chosen" means picking annual key
  // results or writing a focus note: with nothing to point at, a note is the
  // only honest answer (P3-T04, read by the calendar since H-09).
  const annualKeyResults = await loadFocusCandidates(tx, workspaceId, cycle);

  return {
    hasMission: Boolean(frame.mission),
    hasStrategy: Boolean(frame.strategy),
    strategyCount: strategies.length,
    notDoingWritten: Boolean(frame.notDoing),
    agreed: frame.agreed,
    annualKeyResultCount: annualKeyResults.length,
  };
}

/**
 * The year's key results a quarter may choose its focus from (METHOD.md §2.3
 * phase 3: "focus areas chosen"; completeness review H-09): every key result
 * of an annual cycle that overlaps the quarter.
 *
 * **By the calendar, not by `cycles.frame_id`.** Nothing has ever written that
 * column, so reading the year through it found no key results on any
 * workspace, and phase 3 accepted a focus note from a quarter whose year had
 * key results to point at. `frame.annualObjectives` reads the year the same
 * way: an annual objective is one in an annual cycle.
 */
export async function loadFocusCandidates<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  quarter: { readonly startsOn: string; readonly endsOn: string },
) {
  return tx
    .select({
      id: keyResults.id,
      title: keyResults.title,
      goalTitle: goals.title,
    })
    .from(keyResults)
    .innerJoin(goals, eq(goals.id, keyResults.goalId))
    .innerJoin(cycles, eq(cycles.id, goals.cycleId))
    .where(
      and(
        activeOnly(keyResults, eq(keyResults.workspaceId, workspaceId)),
        isNull(goals.deletedAt),
        isNull(cycles.deletedAt),
        eq(cycles.mode, "annual"),
        lte(cycles.startsOn, quarter.endsOn),
        gte(cycles.endsOn, quarter.startsOn),
      ),
    )
    .orderBy(asc(goals.title), asc(keyResults.title));
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
      companyPublishedAt: cycles.companyPublishedAt,
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
  const gates = publishGates(input, thresholds);
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

/**
 * Re-evaluates and stores one cycle's gate rows, skipping what cannot change.
 *
 * **Written for the callers that are not the cycle screen** (P5-T10a). An
 * initiative's capacity verdict feeds publish gate five, so a write to an
 * initiative has to leave the stored gates correct for every cycle that
 * initiative serves. Those callers know an initiative, not a cycle, and they
 * reach several cycles at once, so the load-evaluate-store sequence lives here
 * instead of being copied per action.
 *
 * **A missing or closed cycle is skipped rather than refused.** The equivalent
 * inside `actions/cycle-workflow.ts` throws, and it is right to: somebody is
 * editing that cycle. Here the cycle is a consequence of the write rather than
 * its subject, and refusing to link an initiative because one of the key results
 * it serves belongs to an archived cycle would block a correct change for a
 * reason nobody could act on.
 */
export async function refreshGateStateFor<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  cycleId: string,
  thresholds: ResolvedThresholds,
): Promise<void> {
  const cycle = await loadCycleForWorkflow(tx, workspaceId, cycleId);
  if (!cycle || cycle.status === "closed") {
    return;
  }
  const snapshot = await evaluateWorkflow(tx, workspaceId, cycle, thresholds);
  await recomputeGateState(tx, workspaceId, cycleId, snapshot.gates);
}
