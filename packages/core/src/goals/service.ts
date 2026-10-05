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
 * | The reviewer's own group | edit, tagged `reviewer` | Acknowledging a check-in is a write, and §14 requires edit for every write. The tag is what the review inbox finds them by; the level is what lets them close the loop |
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
  checkIns,
  type GoalCloseDecision,
  type GoalKind,
  type GoalLevel,
  type GoalOwnerKind,
  type GoalSuccessStatus,
  type GoalTimeframe,
  goalRetrospectives,
  goals,
  type IndicatorType,
  type KeyResultDirection,
  type KeyResultKind,
  keyResults,
  keyResultValues,
  newId,
  type ValueSource,
  type WorkspaceTx,
  workspaceMembers,
} from "@openokr/db";
import { desc, eq, isNull } from "drizzle-orm";
import {
  bindGroup,
  ensureContext,
  ensureMemberGroup,
  ensureWorkspaceStandardGroup,
  unbindGroup,
} from "../access/contexts.ts";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { bindAgentsToContextInTx } from "../agents/bindings.ts";
import { type LegacyKey, legacyColumns } from "../imports/legacy.ts";
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
  /**
   * Committed or aspirational (METHOD.md §2.8, P9-T11b-a). Left out, the
   * column's default, aspirational: `goals.create` resolves the workspace's
   * own default before it gets here.
   */
  readonly kind?: GoalKind;
  readonly ownerKind: GoalOwnerKind;
  readonly spaceId?: string | null;
  readonly memberId?: string | null;
  readonly championId: string;
  /** Optional since P9-T04 (METHOD.md §2.5). */
  readonly reviewerId: string | null;
  readonly parentGoalId?: string | null;
  readonly parentKeyResultId?: string | null;
  /** The §2.1 annual strategy this objective serves, or null (P6-G14b). */
  readonly strategyId?: string | null;
  readonly weight?: number;
  readonly contributionStatement?: string | null;
  /** True when a model wrote the words (P4-T15a). */
  readonly aiGenerated?: boolean;
  readonly position?: number;
  /** When it was started mid-cycle (METHOD.md §2.9, P9-T13-a). */
  readonly addedMidCycleAt?: Date | null;
  /**
   * The source-system identity, when an import created this row (P6-T01a).
   *
   * Absent for everything created in the product. Present, it is what makes
   * a re-run of the same file write the row once.
   */
  readonly legacy?: LegacyKey;
}

export interface CreatedGoal {
  readonly id: string;
  readonly title: string;
  readonly contextId: string;
}

/** Both role holders have to be real, active members of this workspace. */
export async function requireActiveMember<
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
  if (input.reviewerId) {
    await requireActiveMember(
      tx,
      input.workspaceId,
      input.reviewerId,
      "reviewer",
    );
  }

  // No loop check on create: a goal that does not exist yet cannot be its own
  // ancestor. `update` is where the walk matters, and it is where it runs.
  const goalId = newId();
  // The space the goal is stored in, which is the one every binding below
  // follows. Only a space-owned goal keeps the space it was sent with; the
  // bindings used to read `input.spaceId` instead, so a goal sent with a space
  // it does not belong to was stored in none and bound to no agent.
  const spaceId = input.ownerKind === "space" ? (input.spaceId ?? null) : null;

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
      ...(input.kind === undefined ? {} : { kind: input.kind }),
      ...(input.addedMidCycleAt
        ? { addedMidCycleAt: input.addedMidCycleAt }
        : {}),
      ownerKind: input.ownerKind,
      spaceId,
      memberId: input.ownerKind === "member" ? (input.memberId ?? null) : null,
      championId: input.championId,
      reviewerId: input.reviewerId,
      parentGoalId: input.parentGoalId ?? null,
      parentKeyResultId: input.parentKeyResultId ?? null,
      strategyId: input.strategyId ?? null,
      weight: String(clampWeight(input.weight ?? 1)),
      contributionStatement: input.contributionStatement?.trim() || null,
      // Provenance (P4-T15a). False unless the caller says a model wrote the
      // words. The column has been here since 0022 and nothing wrote it, which
      // meant an assisted objective read exactly like a typed one.
      aiGenerated: input.aiGenerated ?? false,
      position: input.position ?? 0,
      ...legacyColumns(input.legacy),
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

  // **A goal in a space used to grant every member of that space `edit`, and
  // no longer does** (P8-G13c, docs/design/p8-g13-workspace-roles.md). That
  // binding was the only answer to "who may edit this objective", it could be
  // stated only by reading the binding table, it could be changed only by
  // moving people between spaces, and it had no screen. The workspace role
  // answers it now, on a screen an administrator can edit.
  //
  // Nothing about who can *see* it changes: the `workspace_standard` binding
  // above grants `view` to every member, as it has since P3-T04. What a space
  // decides is still membership, the session cadence and the rails that read
  // it; what it no longer decides is editing somebody else's objective.
  //
  // Data change 0013 removes the bindings written before this.

  await bindRole(tx, {
    workspaceId: input.workspaceId,
    contextId,
    memberId: input.championId,
    role: "champion",
  });
  if (input.reviewerId) {
    await bindRole(tx, {
      workspaceId: input.workspaceId,
      contextId,
      memberId: input.reviewerId,
      role: "reviewer",
    });
  }

  // A goal that belongs to no space, a company or an individual goal, has no
  // space binding the built-in agents can see it through, so they are bound
  // to it by name (completeness review H-04). A space goal is already in
  // their sight through the space.
  if (!spaceId) {
    await bindAgentsToContextInTx(tx, {
      workspaceId: input.workspaceId,
      contextId,
    });
  }

  return { id: row.id, title: row.title, contextId };
}

export type GoalRole = "champion" | "reviewer";

/** What each role holds. The tag matters more than the level for the reviewer. */
const ROLE_LEVEL: Readonly<Record<GoalRole, number>> = {
  champion: ACCESS_LEVELS.full,
  // Edit, not comment. Acknowledging a check-in is a write, and §14 requires edit
  // for every write, so a reviewer who could only comment could not do the one
  // thing the role exists for. Recorded as a question rather than settled: it
  // gives a reviewer editing rights on the goal as a side effect, which is more
  // than the role needs.
  reviewer: ACCESS_LEVELS.edit,
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
  /** Null when the goal had no reviewer (P9-T04). */
  readonly fromMemberId: string | null;
  /** Null takes the reviewer off; a champion is never null. */
  readonly toMemberId: string | null;
}

/**
 * A role change is a rebind, not a column update (§4.4).
 *
 * All five steps that section lists happen here: unbind, bind, update the
 * column, reassign every pending obligation of that role, and the audit event
 * the caller writes.
 *
 * The fourth step is narrower than it sounds, and the narrowness is the point.
 * Only an **open** obligation moves. An acknowledged check-in keeps the reviewer
 * who closed it, so a new reviewer inherits the work still to do and never the
 * work somebody else already finished. That is what makes both halves of §4.4
 * true at once: "reassign every pending obligation" and "a reviewer change never
 * retroactively creates an obligation for a check-in published before the
 * change".
 */
export async function reassignRoleInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: ReassignRoleInput): Promise<void> {
  if (input.fromMemberId === input.toMemberId) {
    return;
  }
  if (input.toMemberId === null && input.role === "champion") {
    // A goal is never without a champion (§2.5), whatever the practice.
    throw new Error("A champion cannot be removed, only moved.");
  }
  if (input.toMemberId) {
    await requireActiveMember(
      tx,
      input.workspaceId,
      input.toMemberId,
      input.role,
    );
  }

  if (input.fromMemberId) {
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
  }
  if (input.toMemberId) {
    await bindRole(tx, {
      workspaceId: input.workspaceId,
      contextId: input.contextId,
      memberId: input.toMemberId,
      role: input.role,
    });
  }

  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx
    .update(goals)
    .set(
      input.role === "champion"
        ? { championId: input.toMemberId as string, updatedAt: new Date() }
        : { reviewerId: input.toMemberId, updatedAt: new Date() },
    )
    .where(activeOnly(goals, eq(goals.id, input.goalId)));

  if (input.role === "reviewer") {
    // Step 4. A published check-in nobody has acknowledged is the only pending
    // obligation this role has today; blockers and commitments arrive at P3-T09
    // and P4-T07 and will need their own line here. Taking the reviewer off
    // (P9-T04) takes the obligation with them: nobody owes it any more.
    // openokr:allow-mutation: the calling Operation's own transaction.
    await tx
      .update(checkIns)
      .set({ reviewerMemberId: input.toMemberId, updatedAt: new Date() })
      .where(
        activeOnly(
          checkIns,
          eq(checkIns.workspaceId, input.workspaceId),
          eq(checkIns.subjectId, input.goalId),
          eq(checkIns.state, "published"),
          isNull(checkIns.acknowledgedAt),
        ),
      );
  }
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
  /**
   * Metric, maintain, milestone or baseline (METHOD.md §2.10, P9-T12b). Left
   * out, the column's default, metric.
   */
  readonly kind?: KeyResultKind;
  readonly direction: KeyResultDirection;
  readonly indicatorType: IndicatorType;
  readonly baselineValue: number;
  /**
   * Null when nobody knows it yet (P9-T13-b-a): the key result fails KR-3
   * until it is set, and reads no progress.
   */
  readonly targetValue: number | null;
  readonly currentValue?: number;
  readonly dueOn?: string | null;
  readonly ownerId?: string | null;
  readonly weight?: number;
  readonly kpiId?: string | null;
  readonly capacity?: CapacityVerdict | null;
  readonly authorMemberId?: string | null;
  /** When it was started mid-cycle (METHOD.md §2.9, P9-T13-a). */
  readonly addedMidCycleAt?: Date | null;
  /** The source-system identity, when an import created this row (P6-T01a). */
  readonly legacy?: LegacyKey;
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
  if (input.ownerId) {
    // The foreign key accepts a member of another workspace, because a key
    // check does not see row-level security (completeness review H-09).
    await requireActiveMember(
      tx,
      input.workspaceId,
      input.ownerId,
      "key result owner",
    );
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
      ...(input.kind === undefined ? {} : { kind: input.kind }),
      ...(input.addedMidCycleAt
        ? { addedMidCycleAt: input.addedMidCycleAt }
        : {}),
      direction: input.direction,
      indicatorType: input.indicatorType,
      baselineValue: String(input.baselineValue),
      targetValue:
        input.targetValue === null ? null : String(input.targetValue),
      currentValue: String(current),
      dueOn: input.dueOn ?? null,
      ownerId: input.ownerId ?? null,
      weight: String(clampWeight(input.weight ?? 1)),
      kpiId: input.kpiId ?? null,
      capacity: input.capacity ?? null,
      position: (next?.position ?? -1) + 1,
      ...legacyColumns(input.legacy),
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
 *
 * **A baseline key result is recorded by its first value** (METHOD.md §2.10,
 * P9-T12b): the number nobody measured is now measured, so it becomes the
 * baseline as well as the current value, and the key result is done. A later
 * value moves the current value only; the baseline stays what was first
 * found.
 */
export async function recordValueInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: RecordValueInput): Promise<void> {
  const [keyResult] = await tx
    .select({
      id: keyResults.id,
      kpiId: keyResults.kpiId,
      kind: keyResults.kind,
      doneAt: keyResults.doneAt,
    })
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

  const firstBaseline = keyResult.kind === "baseline" && !keyResult.doneAt;
  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx
    .update(keyResults)
    .set({
      currentValue: String(input.value),
      ...(firstBaseline
        ? { baselineValue: String(input.value), doneAt: now }
        : {}),
      updatedAt: now,
    })
    .where(activeOnly(keyResults, eq(keyResults.id, input.keyResultId)));
}

/**
 * Links a KPI to a key result that had none, taking the value the KPI last
 * reported (§5.3, completeness review M-07).
 *
 * The caller has already found the KPI and read its latest value, because
 * "the KPI exists and this member may read it" is the action's check, not
 * this row's. `reading` is null when the KPI has recorded nothing, and then
 * the key result keeps its own value until the first reading arrives: an
 * unmeasured KPI is not a zero.
 *
 * **A key result that already reads a KPI is refused rather than switched.**
 * Unlinking writes the frozen value as history, and switching straight from
 * one KPI to another would skip that row and make the change of source
 * invisible on the sparkline.
 */
export async function linkKpiInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  input: {
    workspaceId: string;
    keyResultId: string;
    kpiId: string;
    reading: number | null;
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
  if (keyResult.kpiId) {
    throw new OperationError(
      "forbidden",
      "This key result already reads a KPI. Unlink it first, so the change of source is on the record.",
    );
  }

  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx
    .update(keyResults)
    .set({ kpiId: input.kpiId, updatedAt: new Date() })
    .where(activeOnly(keyResults, eq(keyResults.id, input.keyResultId)));

  if (
    input.reading !== null &&
    input.reading !== asNumber(keyResult.currentValue)
  ) {
    await recordValueInTx(tx, {
      workspaceId: input.workspaceId,
      keyResultId: input.keyResultId,
      value: input.reading,
      source: "kpi",
      authorMemberId: input.authorMemberId ?? null,
      note: "KPI linked. The value it last reported",
    });
  }
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

/**
 * When a key result is done, after a write (METHOD.md §2.10, P9-T12b).
 *
 * Only a milestone or a baseline is ever done. Changing a key result to a
 * metric or a maintain clears it, because those read their number. A done
 * asked of one of them is refused, rather than stored where nothing reads it.
 * Marking done again keeps the first moment, which is when it happened.
 */
export function doneAtFor(
  kind: KeyResultKind,
  stored: Date | null,
  done: boolean | undefined,
): Date | null {
  const doneable = kind === "milestone" || kind === "baseline";
  if (done === true && !doneable) {
    throw new OperationError(
      "forbidden",
      "Only a milestone or a baseline key result is marked done. A metric or a maintain key result reads its number instead.",
    );
  }
  if (!doneable || done === false) {
    return null;
  }
  return done === true ? (stored ?? new Date()) : stored;
}
