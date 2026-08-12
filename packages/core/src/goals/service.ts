/**
 * Goal and key result writes, as helpers an Operation's `execute` calls
 * (TECHNICAL-PLAN §4.4, METHOD.md §2.5, P3-T04).
 *
 * **What a goal's access context holds.** A goal owns one context, and four
 * principals reach it:
 *
 * | Principal | Level | Why |
 * |---|---|---|
 * | `workspace_standard` | view | An OKR set nobody can read is not an OKR set. Alignment, the explorer and the cycle's own gates all assume the set is visible, and METHOD.md §5.1 has children naming parents they would otherwise be unable to find |
 * | The owner space's `space_standard` | edit | Working in the space is working on its goals |
 * | The champion's own group | full, tagged `champion` | METHOD.md §2.5: exactly one per goal, never a team. Owning a goal includes naming who reviews it |
 * | The reviewer's own group | comment, tagged `reviewer` | Acknowledging a check-in is not editing the goal. The tag is what the review inbox finds them by, not the level |
 *
 * A workspace administrator holds nothing here by virtue of being one. That is
 * the same rule spaces already follow: an admin who is not a space manager holds
 * only what `workspace_standard` gives. It has a consequence worth stating out
 * loud, recorded as an open question rather than papered over: a goal whose
 * champion is suspended has nobody left who can reassign it, because a suspended
 * member's bindings stop resolving.
 *
 * **Derived columns are not written here.** `progress_pct`, `health` and
 * `forecast` belong to the scoring cascade in `scoring/recompute.ts`, which the
 * actions call in the same transaction (P3-T05). A goal created here reads 0% and
 * `pending`, and stays that way until something moves.
 */
import {
  activeOnly,
  type CapacityVerdict,
  type GoalCloseDecision,
  type GoalLevel,
  type GoalOwnerKind,
  type GoalSuccessStatus,
  type GoalTimeframe,
  goalRetrospectives,
  goals,
  type IndicatorType,
  type KeyResultDirection,
  keyResults,
  keyResultValues,
  newId,
  type ValueSource,
  type WorkspaceTx,
  workspaceMembers,
} from "@openokr/db";
import { desc, eq } from "drizzle-orm";
import {
  bindGroup,
  ensureContext,
  ensureMemberGroup,
  ensureSpaceStandardGroup,
  ensureWorkspaceStandardGroup,
  unbindGroup,
} from "../access/contexts.ts";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { OperationError } from "../operations/operation.ts";
import { RICH_TEXT_SCHEMA_VERSION } from "../rich-text/schema.ts";

type AnyTx<TSchema extends Record<string, unknown> = Record<string, never>> =
  WorkspaceTx<TSchema>;

/** How deep the parent walk goes before it gives up. */
const MAX_ALIGNMENT_DEPTH = 64;

/**
 * `numeric` comes back from the driver as a string. Every read of one goes
 * through here, because a string compared against a number is the bug this
 * repository has already shipped once.
 */
export const asNumber = (value: string | number | null): number | null => {
  if (value === null) {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** §4.1: weight is clamped on write, never rejected. 0 means "does not count". */
export const clampWeight = (weight: number): number =>
  Math.min(100, Math.max(0, weight));

export interface CreateGoalInput {
  readonly workspaceId: string;
  readonly title: string;
  readonly description?: unknown;
  readonly cycleId?: string | null;
  readonly timeframe?: GoalTimeframe | null;
  readonly level: GoalLevel;
  readonly ownerKind: GoalOwnerKind;
  readonly spaceId?: string | null;
  readonly memberId?: string | null;
  readonly championId: string;
  readonly reviewerId: string;
  readonly parentGoalId?: string | null;
  readonly parentKeyResultId?: string | null;
  readonly weight?: number;
  readonly contributionStatement?: string | null;
  readonly position?: number;
}

export interface CreatedGoal {
  readonly id: string;
  readonly title: string;
  readonly contextId: string;
}

/** Both role holders have to be real, active members of this workspace. */
async function requireActiveMember<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  memberId: string,
  role: string,
): Promise<void> {
  const [member] = await tx
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.id, memberId),
        eq(workspaceMembers.status, "active"),
      ),
    )
    .limit(1);
  if (!member) {
    throw new OperationError(
      "not_found",
      `No such member for the ${role}, or they are not active.`,
    );
  }
}

/**
 * Whether making `proposedParentId` the parent of `goalId` closes a loop.
 *
 * Walks upward from the proposed parent. Depth-limited rather than trusting the
 * data: an import can leave a cycle behind, and a walk that assumed otherwise
 * would spin instead of refusing.
 */
export async function wouldCloseAlignmentLoop<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  goalId: string,
  proposedParentId: string,
): Promise<boolean> {
  let cursor: string | null = proposedParentId;
  const seen = new Set<string>();

  for (let depth = 0; depth < MAX_ALIGNMENT_DEPTH; depth += 1) {
    if (cursor === null) {
      return false;
    }
    if (cursor === goalId) {
      return true;
    }
    if (seen.has(cursor)) {
      // A loop that already existed. Refusing is the safe answer either way.
      return true;
    }
    seen.add(cursor);

    const [row] = await tx
      .select({
        parentGoalId: goals.parentGoalId,
        parentKeyResultId: goals.parentKeyResultId,
      })
      .from(goals)
      .where(
        activeOnly(
          goals,
          eq(goals.workspaceId, workspaceId),
          eq(goals.id, cursor),
        ),
      )
      .limit(1);
    if (!row) {
      return false;
    }
    if (row.parentKeyResultId) {
      // Up through a key result to the goal that owns it: a chain through a
      // parent key result can close a loop just as a goal chain can.
      const [owner] = await tx
        .select({ goalId: keyResults.goalId })
        .from(keyResults)
        .where(
          activeOnly(
            keyResults,
            eq(keyResults.workspaceId, workspaceId),
            eq(keyResults.id, row.parentKeyResultId),
          ),
        )
        .limit(1);
      cursor = owner?.goalId ?? null;
      continue;
    }
    cursor = row.parentGoalId;
  }

  // Deeper than any real cascade. Refusing beats walking forever.
  return true;
}

/** The goal, its context and its four bindings, written together. */
export async function createGoalInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: CreateGoalInput): Promise<CreatedGoal> {
  const title = input.title.trim();
  if (title === "") {
    throw new OperationError("forbidden", "A goal needs a title.");
  }

  await requireActiveMember(
    tx,
    input.workspaceId,
    input.championId,
    "champion",
  );
  await requireActiveMember(
    tx,
    input.workspaceId,
    input.reviewerId,
    "reviewer",
  );

  // No loop check on create: a goal that does not exist yet cannot be its own
  // ancestor. `update` is where the walk matters, and it is where it runs.
  const goalId = newId();

  // openokr:allow-mutation: runs on the transaction the calling Operation
  // opened, so the goal, its access wiring and that Operation's audit row
  // commit together or not at all.
  const [row] = await tx
    .insert(goals)
    .values({
      id: goalId,
      workspaceId: input.workspaceId,
      title,
      description: (input.description ?? null) as never,
      descriptionVersion:
        input.description === undefined || input.description === null
          ? null
          : RICH_TEXT_SCHEMA_VERSION,
      cycleId: input.cycleId ?? null,
      timeframe: input.timeframe ?? null,
      level: input.level,
      ownerKind: input.ownerKind,
      spaceId: input.ownerKind === "space" ? (input.spaceId ?? null) : null,
      memberId: input.ownerKind === "member" ? (input.memberId ?? null) : null,
      championId: input.championId,
      reviewerId: input.reviewerId,
      parentGoalId: input.parentGoalId ?? null,
      parentKeyResultId: input.parentKeyResultId ?? null,
      weight: String(clampWeight(input.weight ?? 1)),
      contributionStatement: input.contributionStatement?.trim() || null,
      position: input.position ?? 0,
    })
    .returning({ id: goals.id, title: goals.title });

  if (!row) {
    throw new Error("The goal insert returned no row.");
  }

  const contextId = await ensureContext(tx, {
    workspaceId: input.workspaceId,
    resourceType: "goal",
    resourceId: goalId,
  });

  const workspaceStandardGroupId = await ensureWorkspaceStandardGroup(tx, {
    workspaceId: input.workspaceId,
  });
  await bindGroup(tx, {
    workspaceId: input.workspaceId,
    groupId: workspaceStandardGroupId,
    contextId,
    level: ACCESS_LEVELS.view,
  });

  if (input.ownerKind === "space" && input.spaceId) {
    const spaceStandardGroupId = await ensureSpaceStandardGroup(tx, {
      workspaceId: input.workspaceId,
      spaceId: input.spaceId,
    });
    await bindGroup(tx, {
      workspaceId: input.workspaceId,
      groupId: spaceStandardGroupId,
      contextId,
      level: ACCESS_LEVELS.edit,
    });
  }

  await bindRole(tx, {
    workspaceId: input.workspaceId,
    contextId,
    memberId: input.championId,
    role: "champion",
  });
  await bindRole(tx, {
    workspaceId: input.workspaceId,
    contextId,
    memberId: input.reviewerId,
    role: "reviewer",
  });

  return { id: row.id, title: row.title, contextId };
}

export type GoalRole = "champion" | "reviewer";

/** What each role holds. The tag matters more than the level for the reviewer. */
const ROLE_LEVEL: Readonly<Record<GoalRole, number>> = {
  champion: ACCESS_LEVELS.full,
  reviewer: ACCESS_LEVELS.comment,
};

async function bindRole<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  input: {
    workspaceId: string;
    contextId: string;
    memberId: string;
    role: GoalRole;
  },
): Promise<void> {
  const groupId = await ensureMemberGroup(tx, {
    workspaceId: input.workspaceId,
    memberId: input.memberId,
  });
  await bindGroup(tx, {
    workspaceId: input.workspaceId,
    groupId,
    contextId: input.contextId,
    level: ROLE_LEVEL[input.role] as never,
    tag: input.role,
  });
}

export interface ReassignRoleInput {
  readonly workspaceId: string;
  readonly goalId: string;
  readonly contextId: string;
  readonly role: GoalRole;
  readonly fromMemberId: string;
  readonly toMemberId: string;
}

/**
 * A role change is a rebind, not a column update (§4.4).
 *
 * Four of the five steps that section lists happen here: unbind, bind, update
 * the column, and stamp the time the change happened. The fifth, reassigning
 * pending obligations, needs the review inbox and lands with it at P3-T08; the
 * timestamp is what lets that task read "the reviewer as of publication" rather
 * than guessing.
 */
export async function reassignRoleInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: ReassignRoleInput): Promise<void> {
  if (input.fromMemberId === input.toMemberId) {
    return;
  }
  await requireActiveMember(
    tx,
    input.workspaceId,
    input.toMemberId,
    input.role,
  );

  const outgoingGroupId = await ensureMemberGroup(tx, {
    workspaceId: input.workspaceId,
    memberId: input.fromMemberId,
  });
  await unbindGroup(tx, {
    workspaceId: input.workspaceId,
    groupId: outgoingGroupId,
    contextId: input.contextId,
    tag: input.role,
  });
  await bindRole(tx, {
    workspaceId: input.workspaceId,
    contextId: input.contextId,
    memberId: input.toMemberId,
    role: input.role,
  });

  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx
    .update(goals)
    .set(
      input.role === "champion"
        ? { championId: input.toMemberId, updatedAt: new Date() }
        : { reviewerId: input.toMemberId, updatedAt: new Date() },
    )
    .where(activeOnly(goals, eq(goals.id, input.goalId)));
}

export interface CloseGoalInput {
  readonly workspaceId: string;
  readonly goalId: string;
  readonly closedById: string;
  readonly successStatus: GoalSuccessStatus;
  readonly closeDecision: GoalCloseDecision;
  readonly closeReason?: string | null;
  /** Editor JSON. Required: §4.3 will not close a goal with no account of it. */
  readonly retrospectiveBody: unknown;
}

/**
 * Closes a goal (§4.3).
 *
 * The outcome becomes the health, so a closed goal never borrows a live status.
 * The retrospective is created here and deliberately survives a reopen, which is
 * why the unique index is on the goal rather than on the close.
 */
export async function closeGoalInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: CloseGoalInput): Promise<void> {
  const [goal] = await tx
    .select({ id: goals.id, closedAt: goals.closedAt })
    .from(goals)
    .where(
      activeOnly(
        goals,
        eq(goals.workspaceId, input.workspaceId),
        eq(goals.id, input.goalId),
      ),
    )
    .limit(1);
  if (!goal) {
    throw new OperationError("not_found", "No such goal.");
  }
  if (goal.closedAt) {
    throw new OperationError("forbidden", "This goal is already closed.");
  }

  const now = new Date();

  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx
    .update(goals)
    .set({
      closedAt: now,
      closedById: input.closedById,
      successStatus: input.successStatus,
      closeDecision: input.closeDecision,
      closeReason: input.closeReason?.trim() || null,
      health: input.successStatus,
      updatedAt: now,
    })
    .where(activeOnly(goals, eq(goals.id, input.goalId)));

  const [existing] = await tx
    .select({ id: goalRetrospectives.id })
    .from(goalRetrospectives)
    .where(
      activeOnly(
        goalRetrospectives,
        eq(goalRetrospectives.workspaceId, input.workspaceId),
        eq(goalRetrospectives.goalId, input.goalId),
      ),
    )
    .limit(1);

  const body = {
    body: input.retrospectiveBody as never,
    bodyVersion: RICH_TEXT_SCHEMA_VERSION,
    authorMemberId: input.closedById,
    updatedAt: now,
  };

  if (existing) {
    // A goal closed, reopened and closed again edits the one account of it.
    // openokr:allow-mutation: the calling Operation's own transaction.
    await tx
      .update(goalRetrospectives)
      .set(body)
      .where(
        activeOnly(goalRetrospectives, eq(goalRetrospectives.id, existing.id)),
      );
    return;
  }

  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx
    .insert(goalRetrospectives)
    .values({ workspaceId: input.workspaceId, goalId: input.goalId, ...body });
}

/**
 * Reopens a goal (§4.3).
 *
 * Clears the outcome and the decision, keeps the retrospective, and puts health
 * back to `pending`, and the caller's recompute settles it: the §3.5 precedence
 * puts staleness above the last check-in, so a reopened goal that is already
 * overdue reads `outdated` rather than `pending`.
 */
export async function reopenGoalInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  input: { workspaceId: string; goalId: string },
): Promise<void> {
  const [goal] = await tx
    .select({ id: goals.id, closedAt: goals.closedAt })
    .from(goals)
    .where(
      activeOnly(
        goals,
        eq(goals.workspaceId, input.workspaceId),
        eq(goals.id, input.goalId),
      ),
    )
    .limit(1);
  if (!goal) {
    throw new OperationError("not_found", "No such goal.");
  }
  if (!goal.closedAt) {
    throw new OperationError("forbidden", "This goal is not closed.");
  }

  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx
    .update(goals)
    .set({
      closedAt: null,
      closedById: null,
      successStatus: null,
      closeDecision: null,
      health: "pending",
      updatedAt: new Date(),
    })
    .where(activeOnly(goals, eq(goals.id, input.goalId)));
}

export interface CreateKeyResultInput {
  readonly workspaceId: string;
  readonly goalId: string;
  readonly title: string;
  readonly unit?: string | null;
  readonly direction: KeyResultDirection;
  readonly indicatorType: IndicatorType;
  readonly baselineValue: number;
  readonly targetValue: number;
  readonly currentValue?: number;
  readonly dueOn?: string | null;
  readonly ownerId?: string | null;
  readonly weight?: number;
  readonly kpiId?: string | null;
  readonly capacity?: CapacityVerdict | null;
  readonly authorMemberId?: string | null;
}

/**
 * A key result and its first history row.
 *
 * The current value defaults to the baseline (§5.1), so progress starts at 0
 * rather than undefined, and the first `key_result_values` row records where the
 * measurement started. §5.2 allows no path that sets a current value without
 * writing one.
 */
export async function createKeyResultInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: CreateKeyResultInput): Promise<{ id: string }> {
  const title = input.title.trim();
  if (title === "") {
    throw new OperationError("forbidden", "A key result needs a title.");
  }

  const current = input.currentValue ?? input.baselineValue;
  const [next] = await tx
    .select({ position: keyResults.position })
    .from(keyResults)
    .where(
      activeOnly(
        keyResults,
        eq(keyResults.workspaceId, input.workspaceId),
        eq(keyResults.goalId, input.goalId),
      ),
    )
    .orderBy(desc(keyResults.position))
    .limit(1);

  // openokr:allow-mutation: the calling Operation's own transaction.
  const [row] = await tx
    .insert(keyResults)
    .values({
      workspaceId: input.workspaceId,
      goalId: input.goalId,
      title,
      unit: input.unit?.trim() || null,
      direction: input.direction,
      indicatorType: input.indicatorType,
      baselineValue: String(input.baselineValue),
      targetValue: String(input.targetValue),
      currentValue: String(current),
      dueOn: input.dueOn ?? null,
      ownerId: input.ownerId ?? null,
      weight: String(clampWeight(input.weight ?? 1)),
      kpiId: input.kpiId ?? null,
      capacity: input.capacity ?? null,
      position: (next?.position ?? -1) + 1,
    })
    .returning({ id: keyResults.id });

  if (!row) {
    throw new Error("The key result insert returned no row.");
  }

  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx.insert(keyResultValues).values({
    workspaceId: input.workspaceId,
    keyResultId: row.id,
    value: String(current),
    authorMemberId: input.authorMemberId ?? null,
    source: "manual",
    note: "Baseline recorded when the key result was created",
  });

  return { id: row.id };
}

export interface RecordValueInput {
  readonly workspaceId: string;
  readonly keyResultId: string;
  readonly value: number;
  readonly source: ValueSource;
  readonly authorMemberId?: string | null;
  readonly checkInId?: string | null;
  readonly note?: string | null;
}

/**
 * Moves a key result's current value, and records the movement.
 *
 * The two happen together, always. §5.2: "there is no path that updates the
 * current value without" a history row, which is what makes a sparkline a record
 * rather than a guess.
 *
 * A KPI-linked key result refuses a manual value (§5.3): the value has one
 * source of truth, and letting somebody type over it would make the link a
 * suggestion.
 */
export async function recordValueInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: RecordValueInput): Promise<void> {
  const [keyResult] = await tx
    .select({ id: keyResults.id, kpiId: keyResults.kpiId })
    .from(keyResults)
    .where(
      activeOnly(
        keyResults,
        eq(keyResults.workspaceId, input.workspaceId),
        eq(keyResults.id, input.keyResultId),
      ),
    )
    .limit(1);
  if (!keyResult) {
    throw new OperationError("not_found", "No such key result.");
  }
  if (keyResult.kpiId && input.source === "manual") {
    throw new OperationError(
      "forbidden",
      "This key result reads its value from a KPI. Unlink it first, or record the value against the KPI.",
    );
  }

  const now = new Date();

  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx.insert(keyResultValues).values({
    workspaceId: input.workspaceId,
    keyResultId: input.keyResultId,
    value: String(input.value),
    at: now,
    authorMemberId: input.authorMemberId ?? null,
    checkInId: input.checkInId ?? null,
    source: input.source,
    note: input.note?.trim() || null,
  });

  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx
    .update(keyResults)
    .set({ currentValue: String(input.value), updatedAt: now })
    .where(activeOnly(keyResults, eq(keyResults.id, input.keyResultId)));
}

/**
 * Unlinks a KPI, freezing the last value as a manual one (§5.3).
 *
 * The key result keeps the number it had. A history row records the unlink, so
 * the point where the measurement stopped being automatic is visible on the
 * sparkline rather than inferred from a gap.
 */
export async function unlinkKpiInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  input: {
    workspaceId: string;
    keyResultId: string;
    authorMemberId?: string | null;
  },
): Promise<void> {
  const [keyResult] = await tx
    .select({ currentValue: keyResults.currentValue, kpiId: keyResults.kpiId })
    .from(keyResults)
    .where(
      activeOnly(
        keyResults,
        eq(keyResults.workspaceId, input.workspaceId),
        eq(keyResults.id, input.keyResultId),
      ),
    )
    .limit(1);
  if (!keyResult) {
    throw new OperationError("not_found", "No such key result.");
  }
  if (!keyResult.kpiId) {
    throw new OperationError("forbidden", "This key result has no KPI linked.");
  }

  const now = new Date();

  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx
    .update(keyResults)
    .set({ kpiId: null, updatedAt: now })
    .where(activeOnly(keyResults, eq(keyResults.id, input.keyResultId)));

  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx.insert(keyResultValues).values({
    workspaceId: input.workspaceId,
    keyResultId: input.keyResultId,
    value: keyResult.currentValue,
    at: now,
    authorMemberId: input.authorMemberId ?? null,
    source: "manual",
    note: "KPI unlinked. The value the KPI last reported is kept as a manual one",
  });
}
