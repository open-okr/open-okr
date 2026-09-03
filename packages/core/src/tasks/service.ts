/**
 * Task writes, as helpers an Operation's `execute` calls (TECHNICAL-PLAN §4.9,
 * P5-T11).
 *
 * **What a task's access context holds.** A task owns one context:
 *
 * | Principal | Level | Why |
 * |---|---|---|
 * | `workspace_standard` | view | The board is a shared record of what a team is doing, the same reason a goal binds it |
 * | The owning space's `space_standard` | edit | Working in the space is working on its board |
 * | Each assignee's own group | edit | §4.9: "assignment grants edit access through the member's group". A person given work can change it, wherever they sit |
 *
 * The third row is the reason a task owns a context at all rather than
 * inheriting its initiative's. Binding an assignee on the initiative would hand
 * them every task under it; binding them on the space would hand them the space.
 *
 * **Ordering is the part with a real problem in it.** Two people drag two cards
 * at the same moment. The move below takes a row lock over the column's own set
 * before it reads neighbours, so two moves serialise instead of interleaving,
 * and it renumbers in the same transaction when the gaps close. Never as a
 * background job: a board that renumbers itself while somebody drags is worse
 * than a slow drag.
 *
 * **Nothing here writes a key result.** Completing every task under a measure
 * moves no number. That is TECHNICAL-PLAN §4.9 and the whole reason the product
 * exists, and there is no code path from this file to `key_results`.
 */
import {
  activeOnly,
  checklistItems,
  includeDeleted,
  newId,
  type TaskStatus,
  taskAssignees,
  tasks,
  type WorkspaceTx,
  workspaceMembers,
} from "@openokr/db";
import { eq, inArray, sql } from "drizzle-orm";
import {
  bindGroup,
  ensureContext,
  ensureMemberGroup,
  ensureSpaceStandardGroup,
  ensureWorkspaceStandardGroup,
  unbindGroup,
} from "../access/contexts.ts";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { type LegacyKey, legacyColumns } from "../imports/legacy.ts";
import {
  ensureSubscriptionList,
  subscribeMember,
} from "../notifications/subscriptions.ts";
import { OperationError } from "../operations/operation.ts";
import { RICH_TEXT_SCHEMA_VERSION } from "../rich-text/schema.ts";

type AnyTx<TSchema extends Record<string, unknown> = Record<string, never>> =
  WorkspaceTx<TSchema>;

/**
 * The gap left between neighbouring cards.
 *
 * Large enough that a column can be dragged into ten deep before two
 * neighbours sit one apart and a renumber is needed, small enough that a
 * thousand cards stay inside a plain integer.
 */
export const TASK_POSITION_SPACING = 1024;

/** The gap below which the column is renumbered rather than squeezed again. */
const MINIMUM_GAP = 2;

export interface CreateTaskInput {
  readonly workspaceId: string;
  readonly spaceId: string;
  readonly title: string;
  readonly description?: unknown;
  readonly initiativeId?: string | null;
  readonly keyResultId?: string | null;
  readonly status?: TaskStatus;
  readonly dueOn?: string | null;
  /** The source-system identity, when an import created this row (P6-T01a). */
  readonly legacy?: LegacyKey;
}

export interface CreatedTask {
  readonly id: string;
  readonly title: string;
  readonly contextId: string;
}

/** The member who may hold work, or a refusal. */
async function requireHumanMember<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, workspaceId: string, memberId: string): Promise<void> {
  const [row] = await tx
    .select({ id: workspaceMembers.id, kind: workspaceMembers.kind })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.id, memberId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new OperationError("not_found", "No such member.");
  }
  if (row.kind !== "human") {
    // The same rule initiatives follow, for the same reason: an agent proposes
    // work and does not carry it (AI-NATIVE-PLAN.md §1.3), and assignment is an
    // access grant.
    throw new OperationError(
      "forbidden",
      "A task is assigned to a person. An agent proposes work; it does not carry it.",
    );
  }
}

/** The next free position at the end of a column. */
async function nextPositionInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  spaceId: string,
  status: TaskStatus,
): Promise<number> {
  const [row] = await tx
    .select({ highest: sql<number | null>`max(${tasks.position})` })
    .from(tasks)
    .where(
      activeOnly(
        tasks,
        eq(tasks.workspaceId, workspaceId),
        eq(tasks.spaceId, spaceId),
        eq(tasks.status, status),
      ),
    );
  return (row?.highest ?? 0) + TASK_POSITION_SPACING;
}

export async function createTaskInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: CreateTaskInput): Promise<CreatedTask> {
  const status = input.status ?? "backlog";
  const taskId = newId();

  // openokr:allow-mutation: runs on the transaction the calling Operation
  // opened, so the row commits with its activity, audit and outbox rows.
  const [row] = await tx
    .insert(tasks)
    .values({
      id: taskId,
      workspaceId: input.workspaceId,
      spaceId: input.spaceId,
      initiativeId: input.initiativeId ?? null,
      keyResultId: input.keyResultId ?? null,
      title: input.title.trim(),
      description: (input.description ?? null) as never,
      descriptionVersion:
        input.description === undefined || input.description === null
          ? null
          : RICH_TEXT_SCHEMA_VERSION,
      status,
      dueOn: input.dueOn ?? null,
      position: await nextPositionInTx(
        tx,
        input.workspaceId,
        input.spaceId,
        status,
      ),
      orderingState: { spacing: TASK_POSITION_SPACING },
      ...legacyColumns(input.legacy),
    })
    .returning({ id: tasks.id, title: tasks.title });

  if (!row) {
    throw new Error("The task insert returned no row.");
  }

  const contextId = await ensureContext(tx, {
    workspaceId: input.workspaceId,
    resourceType: "task",
    resourceId: taskId,
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

  return { id: row.id, title: row.title, contextId };
}

/**
 * Assigns one member, grants them edit on this task, and subscribes them.
 *
 * **All three in one transaction, because they are one decision.** §4.9 says
 * assignment grants edit access, so the binding is not a side effect of the
 * assignment: it is half of what the assignment means. An assignment row without
 * its binding is somebody told they own work they cannot change.
 *
 * Idempotent. Assigning twice is the same decision made twice, and the caller
 * is told which it was so it can decide whether anybody needs telling.
 */
export async function assignTaskInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  input: {
    workspaceId: string;
    taskId: string;
    contextId: string;
    memberId: string;
  },
): Promise<{ readonly assigned: boolean }> {
  await requireHumanMember(tx, input.workspaceId, input.memberId);

  const [existing] = await tx
    .select({ id: taskAssignees.id, deletedAt: taskAssignees.deletedAt })
    .from(taskAssignees)
    .where(
      // Deleted rows on purpose: the unique index covers live rows only, so a
      // member who was unassigned is revived rather than inserted beside.
      includeDeleted(
        taskAssignees,
        eq(taskAssignees.workspaceId, input.workspaceId),
        eq(taskAssignees.taskId, input.taskId),
        eq(taskAssignees.memberId, input.memberId),
      ),
    )
    .limit(1);

  if (existing && existing.deletedAt === null) {
    return { assigned: false };
  }

  if (existing) {
    // openokr:allow-mutation: the calling Operation's own transaction.
    await tx
      .update(taskAssignees)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(includeDeleted(taskAssignees, eq(taskAssignees.id, existing.id)));
  } else {
    // openokr:allow-mutation: the calling Operation's own transaction.
    await tx.insert(taskAssignees).values({
      id: newId(),
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      memberId: input.memberId,
    });
  }

  const groupId = await ensureMemberGroup(tx, {
    workspaceId: input.workspaceId,
    memberId: input.memberId,
  });
  await bindGroup(tx, {
    workspaceId: input.workspaceId,
    groupId,
    contextId: input.contextId,
    level: ACCESS_LEVELS.edit,
  });

  // Subscribed as `role`, which is what an assignee is: somebody who holds a
  // position on this subject rather than somebody who joined a conversation.
  const listId = await ensureSubscriptionList(tx, {
    workspaceId: input.workspaceId,
    subjectType: "task",
    subjectId: input.taskId,
  });
  await subscribeMember(tx, {
    workspaceId: input.workspaceId,
    listId,
    memberId: input.memberId,
    reason: "role",
  });

  return { assigned: true };
}

/** Removes one assignment and the access it granted. */
export async function unassignTaskInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  input: {
    workspaceId: string;
    taskId: string;
    contextId: string;
    memberId: string;
  },
): Promise<{ readonly unassigned: boolean }> {
  const [existing] = await tx
    .select({ id: taskAssignees.id })
    .from(taskAssignees)
    .where(
      activeOnly(
        taskAssignees,
        eq(taskAssignees.workspaceId, input.workspaceId),
        eq(taskAssignees.taskId, input.taskId),
        eq(taskAssignees.memberId, input.memberId),
      ),
    )
    .limit(1);
  if (!existing) {
    return { unassigned: false };
  }

  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx
    .update(taskAssignees)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(activeOnly(taskAssignees, eq(taskAssignees.id, existing.id)));

  // The access goes with it. Leaving the binding would keep somebody editing
  // work that is no longer theirs, which is what the rebind shape exists for.
  const groupId = await ensureMemberGroup(tx, {
    workspaceId: input.workspaceId,
    memberId: input.memberId,
  });
  await unbindGroup(tx, {
    workspaceId: input.workspaceId,
    groupId,
    contextId: input.contextId,
  });

  return { unassigned: true };
}

export interface MoveTaskInput {
  readonly workspaceId: string;
  readonly taskId: string;
  readonly status: TaskStatus;
  /** The card this one lands after, or null for the top of the column. */
  readonly afterTaskId?: string | null;
}

export interface MoveTaskResult {
  readonly position: number;
  readonly normalised: boolean;
}

/**
 * Moves one card, under a lock on the column it lands in.
 *
 * **The lock is the whole design, and `for update` alone was not enough.**
 * `select … for update` does serialise two moves over the same rows: the second
 * waits and then reads the values the first actually wrote. What it does not do
 * is re-sort them. Postgres plans the query against the transaction's own
 * snapshot, so the `order by position` is applied to the positions as they were
 * before the wait; the locked rows come back with fresh values in a stale
 * order. The second move then reads `others[afterIndex + 1]` and finds the card
 * that used to be the next one, computes the same midpoint the first move
 * already used, and two cards share a slot.
 *
 * It failed the acceptance test about once in four full runs of the suite and
 * passed every time that file ran alone, which is why it read as a flake until
 * it did not. Nothing lost and nothing duplicated held throughout: only the
 * distinctness of the positions broke, which is the one assertion that catches
 * it.
 *
 * So the column is claimed before it is read, with a transaction-scoped
 * advisory lock. The second move now blocks before its select is planned, so it
 * sorts data that is already settled. The lock is released when the Operation
 * commits or rolls back, with nothing to remember. The row lock stays
 * underneath it: an advisory lock binds only the callers that agree to take it,
 * so a write reaching these rows another way must still block.
 *
 * **The column is the space's, not the board's.** Three boards read these rows
 * (a space, an initiative, a key result), so locking by whichever board the drag
 * happened on would let two moves over the same cards run at once. Locking the
 * space's own column is the set that actually has to hold still.
 *
 * **Deleted and completed cards are excluded from the renumber**, per the
 * design: otherwise a board's order drifts every time something is finished.
 * Completed cards keep the positions they had, which is fine because the `done`
 * column is its own set.
 */
export async function moveTaskInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: MoveTaskInput): Promise<MoveTaskResult> {
  const [task] = await tx
    .select({ id: tasks.id, spaceId: tasks.spaceId })
    .from(tasks)
    .where(
      activeOnly(
        tasks,
        eq(tasks.workspaceId, input.workspaceId),
        eq(tasks.id, input.taskId),
      ),
    )
    .limit(1);
  if (!task) {
    throw new OperationError("not_found", "No such task.");
  }

  // **Claim the column before reading it.** Transaction-scoped, so it is
  // released on commit or rollback with nothing to remember and nothing to
  // leak. Two keys rather than one hash of one string: the space in the first
  // and the status in the second, so a hash collision would need both to
  // collide at once. A collision would only cost throughput, never
  // correctness, but a board stalling behind another team's drag is a bug
  // somebody reports.
  await tx.execute(sql`
    select pg_advisory_xact_lock(
      hashtext(${`${input.workspaceId}:${task.spaceId}`}),
      hashtext(${input.status})
    )
  `);

  // The row lock, underneath the advisory one. Raw because Drizzle has no
  // `for update` on a select builder here, and the ordering matters: rows come
  // back in the order the move reasons about, and the lock is held until this
  // Operation's transaction commits.
  const locked = await tx.execute<{ id: string; position: number }>(sql`
    select id, position from tasks
     where workspace_id = ${input.workspaceId}
       and space_id = ${task.spaceId}
       and status = ${input.status}
       and deleted_at is null
     order by position asc
     for update
  `);
  const column = locked.rows as { id: string; position: number }[];
  const others = column.filter((row) => row.id !== input.taskId);

  const afterIndex = input.afterTaskId
    ? others.findIndex((row) => row.id === input.afterTaskId)
    : -1;
  if (input.afterTaskId && afterIndex === -1) {
    // The card it was dropped after is not in this column any more, which
    // happens when two people drag at once. Refusing is wrong (the drag was
    // real) and guessing is worse, so it lands at the end.
    return writePosition(tx, input, {
      position:
        (others[others.length - 1]?.position ?? 0) + TASK_POSITION_SPACING,
      normalised: false,
    });
  }

  const before = afterIndex >= 0 ? others[afterIndex]?.position : undefined;
  const after = others[afterIndex + 1]?.position;

  if (before === undefined && after === undefined) {
    return writePosition(tx, input, {
      position: TASK_POSITION_SPACING,
      normalised: false,
    });
  }
  if (before === undefined && after !== undefined) {
    // The top of the column. Half the gap below the current first card, unless
    // there is no room left above it.
    if (after < MINIMUM_GAP) {
      return normaliseAndPlace(tx, input, others, afterIndex);
    }
    return writePosition(tx, input, {
      position: Math.floor(after / 2),
      normalised: false,
    });
  }
  if (after === undefined && before !== undefined) {
    return writePosition(tx, input, {
      position: before + TASK_POSITION_SPACING,
      normalised: false,
    });
  }
  if (before !== undefined && after !== undefined) {
    if (after - before < MINIMUM_GAP) {
      return normaliseAndPlace(tx, input, others, afterIndex);
    }
    return writePosition(tx, input, {
      position: before + Math.floor((after - before) / 2),
      normalised: false,
    });
  }

  return writePosition(tx, input, {
    position: TASK_POSITION_SPACING,
    normalised: false,
  });
}

/**
 * Renumbers the column, then places the card in the slot it was dropped into.
 *
 * In the same transaction as the move, holding the same lock. A renumber that
 * committed separately would be a board reordering itself between two of
 * somebody's drags.
 */
async function normaliseAndPlace<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  input: MoveTaskInput,
  others: readonly { id: string; position: number }[],
  afterIndex: number,
): Promise<MoveTaskResult> {
  const now = new Date();
  const orderingState = {
    spacing: TASK_POSITION_SPACING,
    normalisedAt: now.toISOString(),
  };

  const ordered = [...others];
  // The moved card goes back in at the slot it was dropped into, then the whole
  // column is written out evenly. One pass, one order, no second opinion.
  ordered.splice(afterIndex + 1, 0, { id: input.taskId, position: 0 });

  let position = 0;
  for (const row of ordered) {
    position += TASK_POSITION_SPACING;
    // openokr:allow-mutation: the calling Operation's own transaction.
    await tx
      .update(tasks)
      .set({
        position,
        orderingState,
        ...(row.id === input.taskId ? { status: input.status } : {}),
        updatedAt: now,
      })
      .where(
        activeOnly(
          tasks,
          eq(tasks.workspaceId, input.workspaceId),
          eq(tasks.id, row.id),
        ),
      );
  }

  const moved = ordered.findIndex((row) => row.id === input.taskId);
  return {
    position: (moved + 1) * TASK_POSITION_SPACING,
    normalised: true,
  };
}

async function writePosition<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  input: MoveTaskInput,
  result: MoveTaskResult,
): Promise<MoveTaskResult> {
  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx
    .update(tasks)
    .set({
      status: input.status,
      position: result.position,
      updatedAt: new Date(),
    })
    .where(
      activeOnly(
        tasks,
        eq(tasks.workspaceId, input.workspaceId),
        eq(tasks.id, input.taskId),
      ),
    );
  return result;
}

/** Adds one checklist item at the end of its task's list. */
export async function addChecklistItemInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  input: { workspaceId: string; taskId: string; title: string },
): Promise<{ readonly id: string }> {
  const [last] = await tx
    .select({ highest: sql<number | null>`max(${checklistItems.position})` })
    .from(checklistItems)
    .where(
      activeOnly(
        checklistItems,
        eq(checklistItems.workspaceId, input.workspaceId),
        eq(checklistItems.taskId, input.taskId),
      ),
    );

  const id = newId();
  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx.insert(checklistItems).values({
    id,
    workspaceId: input.workspaceId,
    taskId: input.taskId,
    title: input.title.trim(),
    position: (last?.highest ?? 0) + 1,
  });
  return { id };
}

/**
 * Linked work per key result, counted (TECHNICAL-PLAN §4.9).
 *
 * **A count and a count, never a percentage of a key result.** The caller turns
 * these two numbers into the second signal the rail draws beside the measured
 * progress. Nothing writes either number onto `key_results`.
 */
export async function linkedWorkForKeyResults<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  keyResultIds: readonly string[],
): Promise<Map<string, { done: number; total: number }>> {
  const counts = new Map<string, { done: number; total: number }>();
  if (keyResultIds.length === 0) {
    return counts;
  }
  const rows = await tx
    .select({
      keyResultId: tasks.keyResultId,
      status: tasks.status,
    })
    .from(tasks)
    .where(
      activeOnly(
        tasks,
        eq(tasks.workspaceId, workspaceId),
        inArray(tasks.keyResultId, [...keyResultIds]),
      ),
    );

  for (const row of rows) {
    if (!row.keyResultId) {
      continue;
    }
    const entry = counts.get(row.keyResultId) ?? { done: 0, total: 0 };
    entry.total += 1;
    if (row.status === "done") {
      entry.done += 1;
    }
    counts.set(row.keyResultId, entry);
  }
  return counts;
}
