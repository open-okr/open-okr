/**
 * Task reads and writes (TECHNICAL-PLAN §4.9, P5-T11).
 *
 * **Completing a task moves no key result, and no code path here can.** The
 * work-layer design's §1 is the reason the product exists rather than a
 * technical preference: a team that measures activity instead of outcomes has an
 * OKR practice in name only. `tasks.linkedWork` answers with two counts and,
 * when they disagree with the measure, the sentence
 * `packages/method/src/linked-work.ts` writes. It never returns a progress
 * figure and nothing writes `key_results`.
 *
 * **Assignment is an access change, so it goes through the pipeline like any
 * other.** The assignment row, the binding that grants edit, the subscription,
 * the activity, the audit row and the outbox row commit together. Everybody
 * assigned is notified except the actor, which is the rule the rest of the
 * notification layer already applies.
 *
 * **A board is a view, so there is no board action that writes.** `tasks.move`
 * changes a card's status and position under a row lock; which board somebody
 * dragged it on is not recorded, because a card never belonged to one.
 */
import {
  activeOnly,
  checklistItems,
  goals,
  initiatives,
  keyResults,
  newId,
  spaces,
  TASK_STATUSES,
  type TaskStatus,
  taskAssignees,
  tasks,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import { linkedWorkDivergence } from "@openokr/method";
import { asc, eq, inArray, isNull, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { getAccessScoped } from "../access/reads.ts";
import { assertLegacyKeyFree, legacyKey } from "../imports/legacy.ts";
import { notifyRecipients } from "../notifications/create.ts";
import { resolveRecipients } from "../notifications/recipients.ts";
import type { OperationTx } from "../operations/operation.ts";
import { OperationError } from "../operations/operation.ts";
import { RICH_TEXT_SCHEMA_VERSION } from "../rich-text/schema.ts";
import { isValidRichText } from "../rich-text/validate.ts";
import { boardChannel } from "../tasks/live.ts";
import {
  addChecklistItemInTx,
  assignTaskInTx,
  createTaskInTx,
  linkedWorkForKeyResults,
  moveTaskInTx,
  unassignTaskInTx,
} from "../tasks/service.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

const richText = z
  .unknown()
  .refine(
    (value) =>
      value === null || isValidRichText(value, RICH_TEXT_SCHEMA_VERSION),
    { message: "not valid editor JSON for the current rich text schema" },
  );

const assignee = z.object({ id: z.uuid(), name: z.string() });

const taskCard = z.object({
  id: z.uuid(),
  spaceId: z.uuid(),
  initiativeId: z.uuid().nullable(),
  keyResultId: z.uuid().nullable(),
  keyResultTitle: z.string().nullable(),
  title: z.string(),
  status: z.enum(TASK_STATUSES),
  dueOn: z.string().nullable(),
  position: z.number().int(),
  assignees: z.array(assignee),
  checklist: z.object({ done: z.number().int(), total: z.number().int() }),
});

/** A write reached by something with no member row cannot hold or move work. */
function requireMemberId(memberId: string | null | undefined): string {
  if (!memberId) {
    throw new OperationError("forbidden", "A system actor cannot do this.");
  }
  return memberId;
}

/** The acting member, for a read. The fourth copy; see `actions/copilot.ts`. */
async function actingMember(
  tx: OperationTx,
  workspaceId: string,
  userId: string | undefined,
): Promise<string> {
  if (!userId) {
    throw new OperationError("not_found", "No such task.");
  }
  const [member] = await tx
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.status, "active"),
      ),
    )
    .limit(1);
  if (!member) {
    throw new OperationError("not_found", "No such task.");
  }
  return member.id;
}

interface LoadedTask {
  readonly contextId: string;
  readonly spaceId: string;
  readonly title: string;
  readonly status: TaskStatus;
}

async function requireTask(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
  taskId: string,
  requires: number,
): Promise<LoadedTask> {
  const scoped = await getAccessScoped(tx, {
    workspaceId,
    memberId,
    resourceType: "task",
    resourceId: taskId,
    requires: requires as never,
  });
  const [row] = await tx
    .select({
      spaceId: tasks.spaceId,
      title: tasks.title,
      status: tasks.status,
    })
    .from(tasks)
    .where(
      activeOnly(
        tasks,
        eq(tasks.workspaceId, workspaceId),
        eq(tasks.id, taskId),
      ),
    )
    .limit(1);
  if (!row) {
    // The context outlived the row, which a soft delete does. Same sentence.
    throw new OperationError(
      "not_found",
      "No such task, or you do not have access to it.",
    );
  }
  return {
    contextId: scoped.contextId,
    spaceId: row.spaceId,
    title: row.title,
    status: row.status,
  };
}

/**
 * One outbox row telling everybody watching this space's work to re-read.
 *
 * **A fresh identifier as the deduplication key, not a description of the
 * change.** The key has to be unique across the whole table, and a card moved
 * twice can land on the same position in the same column both times: the second
 * insert then collides, the unique index refuses it, and the whole write fails.
 * Found by dragging one card across two columns in the browser, where the second
 * move silently never happened.
 *
 * Nothing is lost by not deduplicating. The event carries identifiers and a
 * word, and a client that receives it re-reads the board; a duplicate delivery
 * costs one extra read, while a colliding key costs the write.
 */
const boardEvent = (
  workspaceId: string,
  spaceId: string,
  taskId: string,
  change: "created" | "moved" | "updated" | "deleted",
) => ({
  topic: "board.changed",
  payload: {
    channel: boardChannel(workspaceId, spaceId),
    workspaceId,
    spaceId,
    taskId,
    change,
  },
  idempotencyKey: `board.changed:${newId()}`,
});

/** Cards plus the two things a card cannot be drawn without. */
async function decorate(
  tx: OperationTx,
  workspaceId: string,
  rows: readonly {
    id: string;
    spaceId: string;
    initiativeId: string | null;
    keyResultId: string | null;
    keyResultTitle: string | null;
    title: string;
    status: TaskStatus;
    dueOn: string | null;
    position: number;
  }[],
) {
  if (rows.length === 0) {
    return [];
  }
  const ids = rows.map((row) => row.id);

  const assignments = await tx
    .select({
      taskId: taskAssignees.taskId,
      memberId: workspaceMembers.id,
      name: workspaceMembers.name,
    })
    .from(taskAssignees)
    .innerJoin(
      workspaceMembers,
      eq(workspaceMembers.id, taskAssignees.memberId),
    )
    .where(
      activeOnly(
        taskAssignees,
        eq(taskAssignees.workspaceId, workspaceId),
        inArray(taskAssignees.taskId, ids),
      ),
    )
    .orderBy(asc(workspaceMembers.name));

  const items = await tx
    .select({ taskId: checklistItems.taskId, done: checklistItems.done })
    .from(checklistItems)
    .where(
      activeOnly(
        checklistItems,
        eq(checklistItems.workspaceId, workspaceId),
        inArray(checklistItems.taskId, ids),
      ),
    );

  return rows.map((row) => ({
    id: row.id,
    spaceId: row.spaceId,
    initiativeId: row.initiativeId,
    keyResultId: row.keyResultId,
    keyResultTitle: row.keyResultTitle,
    title: row.title,
    status: row.status,
    dueOn: row.dueOn,
    position: row.position,
    assignees: assignments
      .filter((one) => one.taskId === row.id)
      .map((one) => ({ id: one.memberId, name: one.name })),
    checklist: {
      done: items.filter((one) => one.taskId === row.id && one.done).length,
      total: items.filter((one) => one.taskId === row.id).length,
    },
  }));
}

const CARD_COLUMNS = {
  id: tasks.id,
  spaceId: tasks.spaceId,
  initiativeId: tasks.initiativeId,
  keyResultId: tasks.keyResultId,
  keyResultTitle: keyResults.title,
  title: tasks.title,
  status: tasks.status,
  dueOn: tasks.dueOn,
  position: tasks.position,
};

/** Keeps only the cards this member may read, in the order they came. */
async function readable<T extends { id: string }>(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
  rows: readonly T[],
): Promise<T[]> {
  const kept: T[] = [];
  for (const row of rows) {
    const allowed = await getAccessScoped(tx, {
      workspaceId,
      memberId,
      resourceType: "task",
      resourceId: row.id,
    }).then(
      () => true,
      () => false,
    );
    if (allowed) {
      kept.push(row);
    }
  }
  return kept;
}

/**
 * What a board is of, and the reason it is parsed inside the handler.
 *
 * `callAction` does not parse a read action's input: only a write goes through
 * `defineWriteAction`'s own parse, and REST and the tool catalogue each validate
 * at their own boundary. So the refine below would have been decoration, and a
 * board asked for with no filter answered with every card in the workspace.
 * Access-filtered, so nothing leaked, and still the wrong answer to the
 * question. Found by a test that expected the refusal.
 */
const boardInput = z
  .object({
    spaceId: z.uuid().optional(),
    initiativeId: z.uuid().optional(),
    keyResultId: z.uuid().optional(),
  })
  .refine(
    (value) =>
      Boolean(value.spaceId ?? value.initiativeId ?? value.keyResultId),
    { message: "a board is of a space, an initiative or a key result" },
  );

export const readBoard = defineReadAction({
  name: "tasks.board",
  summary:
    "One board: every task in a space, an initiative or a key result, grouped by status. Drives screen S-27.",
  input: boardInput,
  output: z.object({
    columns: z.array(
      z.object({
        status: z.enum(TASK_STATUSES),
        cards: z.array(taskCard),
      }),
    ),
    /** The rail: every key result this board's work serves. */
    rail: z.array(
      z.object({
        keyResultId: z.uuid(),
        keyResultTitle: z.string(),
        goalTitle: z.string(),
        /** The measured value's progress. The one that counts. */
        progressPct: z.number(),
        /** Completed linked tasks over total. A different fact. */
        linkedWork: z.object({
          done: z.number().int(),
          total: z.number().int(),
        }),
        /** Present only when the work is finished and the number has not moved. */
        divergence: z.string().nullable(),
      }),
    ),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context, rawInput) {
    const input = boardInput.parse(rawInput);
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      return { columns: [], rail: [] };
    }
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as OperationTx;
        const memberId = await actingMember(tx, context.workspaceId, userId);

        const rows = await tx
          .select(CARD_COLUMNS)
          .from(tasks)
          .leftJoin(keyResults, eq(keyResults.id, tasks.keyResultId))
          .where(
            activeOnly(
              tasks,
              eq(tasks.workspaceId, context.workspaceId),
              ...(input.spaceId ? [eq(tasks.spaceId, input.spaceId)] : []),
              ...(input.initiativeId
                ? [eq(tasks.initiativeId, input.initiativeId)]
                : []),
              ...(input.keyResultId
                ? [eq(tasks.keyResultId, input.keyResultId)]
                : []),
            ),
          )
          .orderBy(asc(tasks.position), asc(tasks.createdAt));

        const cards = await decorate(
          tx,
          context.workspaceId,
          await readable(tx, context.workspaceId, memberId, rows),
        );

        const railIds = [
          ...new Set(
            cards
              .map((card) => card.keyResultId)
              .filter((id): id is string => id !== null),
          ),
        ];
        const rail = await buildRail(tx, context.workspaceId, railIds);

        return {
          columns: TASK_STATUSES.map((status) => ({
            status,
            cards: cards.filter((card) => card.status === status),
          })),
          rail,
        };
      },
    );
  },
});

/**
 * The rail beside the board (design §3.4).
 *
 * Two numbers, labelled differently, never added together: the measured
 * progress and the share of linked work that is finished. The third field is
 * present only when the second is complete and the first has not moved, which
 * is the divergence TECHNICAL-PLAN §4.9 names.
 */
async function buildRail(
  tx: OperationTx,
  workspaceId: string,
  keyResultIds: readonly string[],
) {
  if (keyResultIds.length === 0) {
    return [];
  }
  const rows = await tx
    .select({
      id: keyResults.id,
      title: keyResults.title,
      goalTitle: goals.title,
      progressPct: keyResults.progressPct,
      currentValue: keyResults.currentValue,
      baselineValue: keyResults.baselineValue,
    })
    .from(keyResults)
    .innerJoin(goals, eq(goals.id, keyResults.goalId))
    .where(
      activeOnly(
        keyResults,
        eq(keyResults.workspaceId, workspaceId),
        inArray(keyResults.id, [...keyResultIds]),
      ),
    )
    .orderBy(asc(goals.position), asc(keyResults.position));

  const counts = await linkedWorkForKeyResults(
    tx,
    workspaceId,
    rows.map((row) => row.id),
  );

  return rows.map((row) => {
    const work = counts.get(row.id) ?? { done: 0, total: 0 };
    const divergence = linkedWorkDivergence({
      keyResultTitle: row.title,
      work,
      currentValue: Number(row.currentValue),
      baselineValue: Number(row.baselineValue),
    });
    return {
      keyResultId: row.id,
      keyResultTitle: row.title,
      goalTitle: row.goalTitle,
      progressPct: Number(row.progressPct),
      linkedWork: work,
      divergence: divergence?.reason ?? null,
    };
  });
}

export const listTasks = defineReadAction({
  name: "tasks.list",
  summary:
    "Tasks, optionally only the caller's own or only the ones due by a date.",
  input: z.object({
    mine: z.boolean().optional(),
    dueBy: z.string().optional(),
    status: z.enum(TASK_STATUSES).optional(),
  }),
  output: z.array(taskCard),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      return [];
    }
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as OperationTx;
        const memberId = await actingMember(tx, context.workspaceId, userId);

        let mineIds: string[] | null = null;
        if (input.mine) {
          const rows = await tx
            .select({ taskId: taskAssignees.taskId })
            .from(taskAssignees)
            .where(
              activeOnly(
                taskAssignees,
                eq(taskAssignees.workspaceId, context.workspaceId),
                eq(taskAssignees.memberId, memberId),
              ),
            );
          mineIds = rows.map((row) => row.taskId);
          if (mineIds.length === 0) {
            return [];
          }
        }

        const rows = await tx
          .select(CARD_COLUMNS)
          .from(tasks)
          .leftJoin(keyResults, eq(keyResults.id, tasks.keyResultId))
          .where(
            activeOnly(
              tasks,
              eq(tasks.workspaceId, context.workspaceId),
              ...(mineIds ? [inArray(tasks.id, mineIds)] : []),
              ...(input.status ? [eq(tasks.status, input.status)] : []),
              ...(input.dueBy ? [lte(tasks.dueOn, input.dueBy)] : []),
            ),
          )
          .orderBy(asc(tasks.dueOn), asc(tasks.position));

        return decorate(
          tx,
          context.workspaceId,
          await readable(tx, context.workspaceId, memberId, rows),
        );
      },
    );
  },
});

export const readTask = defineReadAction({
  name: "tasks.read",
  summary: "One task with its assignees and its checklist. Drives screen S-28.",
  input: z.object({ id: z.uuid() }),
  output: taskCard.extend({
    spaceName: z.string(),
    initiativeTitle: z.string().nullable(),
    description: z.unknown().nullable(),
    items: z.array(
      z.object({
        id: z.uuid(),
        title: z.string(),
        done: z.boolean(),
        position: z.number().int(),
      }),
    ),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such task.");
    }
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as OperationTx;
        const memberId = await actingMember(tx, context.workspaceId, userId);
        await requireTask(
          tx,
          context.workspaceId,
          memberId,
          input.id,
          ACCESS_LEVELS.view,
        );

        const [row] = await tx
          .select({
            ...CARD_COLUMNS,
            spaceName: spaces.name,
            initiativeTitle: initiatives.title,
            description: tasks.description,
          })
          .from(tasks)
          .innerJoin(spaces, eq(spaces.id, tasks.spaceId))
          .leftJoin(keyResults, eq(keyResults.id, tasks.keyResultId))
          .leftJoin(initiatives, eq(initiatives.id, tasks.initiativeId))
          .where(
            activeOnly(
              tasks,
              eq(tasks.workspaceId, context.workspaceId),
              eq(tasks.id, input.id),
            ),
          )
          .limit(1);
        if (!row) {
          throw new OperationError(
            "not_found",
            "No such task, or you do not have access to it.",
          );
        }

        const [card] = await decorate(tx, context.workspaceId, [row]);
        if (!card) {
          throw new OperationError("not_found", "No such task.");
        }

        const items = await tx
          .select({
            id: checklistItems.id,
            title: checklistItems.title,
            done: checklistItems.done,
            position: checklistItems.position,
          })
          .from(checklistItems)
          .where(
            activeOnly(
              checklistItems,
              eq(checklistItems.workspaceId, context.workspaceId),
              eq(checklistItems.taskId, input.id),
            ),
          )
          .orderBy(asc(checklistItems.position));

        return {
          ...card,
          spaceName: row.spaceName,
          initiativeTitle: row.initiativeTitle,
          description: row.description ?? null,
          items,
        };
      },
    );
  },
});

export const createTask = defineWriteAction({
  name: "tasks.create",
  summary: "Creates a task in a space, optionally behind a key result.",
  input: z.object({
    spaceId: z.uuid(),
    title: z.string().trim().min(1).max(500),
    description: richText.optional(),
    initiativeId: z.uuid().optional(),
    keyResultId: z.uuid().optional(),
    status: z.enum(TASK_STATUSES).optional(),
    dueOn: z.string().optional(),
    assigneeIds: z.array(z.uuid()).max(20).optional(),
    /** The source-system identity, when an import is creating this (P6-T01a). */
    legacy: legacyKey.optional(),
  }),
  output: z.object({ id: z.uuid(), title: z.string() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async load({ tx, workspaceId, actor }) {
      await getAccessScoped(tx, {
        workspaceId,
        memberId: requireMemberId(actor.memberId),
        resourceType: "space",
        resourceId: input.spaceId,
        requires: ACCESS_LEVELS.edit,
      });
      return undefined;
    },
    async execute({ tx, workspaceId, actor }) {
      await assertLegacyKeyFree(tx, workspaceId, tasks, input.legacy, "task");

      const created = await createTaskInTx(tx, {
        workspaceId,
        spaceId: input.spaceId,
        title: input.title,
        description: input.description,
        initiativeId: input.initiativeId ?? null,
        keyResultId: input.keyResultId ?? null,
        ...(input.status ? { status: input.status } : {}),
        dueOn: input.dueOn ?? null,
        ...(input.legacy ? { legacy: input.legacy } : {}),
      });

      const notified: string[] = [];
      for (const memberId of input.assigneeIds ?? []) {
        const outcome = await assignTaskInTx(tx, {
          workspaceId,
          taskId: created.id,
          contextId: created.contextId,
          memberId,
        });
        if (outcome.assigned) {
          notified.push(memberId);
        }
      }
      await notifyAssignees(tx, {
        workspaceId,
        taskId: created.id,
        actorMemberId: actor.memberId,
      });

      return {
        result: { id: created.id, title: created.title },
        outbox: [boardEvent(workspaceId, input.spaceId, created.id, "created")],
        activity: {
          kind: "task.created",
          subjectType: "task",
          subjectId: created.id,
          payload: { title: created.title, assigned: notified.length },
        },
        audit: {
          action: "tasks.create",
          targetType: "task",
          targetId: created.id,
          payload: { title: created.title, spaceId: input.spaceId },
        },
      };
    },
  }),
});

/**
 * Tells everybody subscribed to this task except whoever just acted.
 *
 * `resolveRecipients` does the excluding, which is the same rule every other
 * notification in the product follows: nobody is told about their own doing.
 */
async function notifyAssignees(
  tx: OperationTx,
  input: {
    workspaceId: string;
    taskId: string;
    actorMemberId: string | null;
  },
): Promise<void> {
  const recipients = await resolveRecipients(tx, {
    workspaceId: input.workspaceId,
    subjectType: "task",
    subjectId: input.taskId,
    ...(input.actorMemberId ? { excludeMemberId: input.actorMemberId } : {}),
  });
  if (recipients.length === 0) {
    return;
  }
  await notifyRecipients(tx, {
    workspaceId: input.workspaceId,
    subjectType: "task",
    subjectId: input.taskId,
    recipients,
  });
}

export const updateTask = defineWriteAction({
  name: "tasks.update",
  summary:
    "Updates a task's own fields. Its position is moved with tasks.move, not here.",
  input: z
    .object({
      id: z.uuid(),
      title: z.string().trim().min(1).max(500).optional(),
      description: richText.optional(),
      status: z.enum(TASK_STATUSES).optional(),
      dueOn: z.string().nullable().optional(),
      initiativeId: z.uuid().nullable().optional(),
      keyResultId: z.uuid().nullable().optional(),
    })
    .refine((value) => Object.keys(value).length > 1, {
      message: "an update has to change something",
    }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async load({ tx, workspaceId, actor }) {
      return requireTask(
        tx,
        workspaceId,
        requireMemberId(actor.memberId),
        input.id,
        ACCESS_LEVELS.edit,
      );
    },
    async execute({ tx, workspaceId, loaded }) {
      // openokr:allow-mutation: the calling Operation's own transaction.
      await tx
        .update(tasks)
        .set({
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.description === undefined
            ? {}
            : {
                description: input.description as never,
                descriptionVersion:
                  input.description === null ? null : RICH_TEXT_SCHEMA_VERSION,
              }),
          ...(input.status === undefined ? {} : { status: input.status }),
          ...(input.dueOn === undefined ? {} : { dueOn: input.dueOn }),
          ...(input.initiativeId === undefined
            ? {}
            : { initiativeId: input.initiativeId }),
          ...(input.keyResultId === undefined
            ? {}
            : { keyResultId: input.keyResultId }),
          updatedAt: new Date(),
        })
        .where(
          activeOnly(
            tasks,
            eq(tasks.workspaceId, workspaceId),
            eq(tasks.id, input.id),
          ),
        );

      return {
        result: { id: input.id },
        outbox: [boardEvent(workspaceId, loaded.spaceId, input.id, "updated")],
        activity: {
          kind: "task.updated",
          subjectType: "task",
          subjectId: input.id,
          payload: { fields: Object.keys(input).filter((key) => key !== "id") },
        },
        audit: {
          action: "tasks.update",
          targetType: "task",
          targetId: input.id,
          payload: { fields: Object.keys(input).filter((key) => key !== "id") },
        },
      };
    },
  }),
});

export const moveTask = defineWriteAction({
  name: "tasks.move",
  summary:
    "Moves a card to a column and a slot, under a lock so two drags cannot lose one.",
  input: z.object({
    id: z.uuid(),
    status: z.enum(TASK_STATUSES),
    /** The card it lands after, or absent for the top of the column. */
    afterTaskId: z.uuid().nullable().optional(),
  }),
  output: z.object({
    id: z.uuid(),
    position: z.number().int(),
    /** True when the column was renumbered to make room. */
    normalised: z.boolean(),
  }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async load({ tx, workspaceId, actor }) {
      return requireTask(
        tx,
        workspaceId,
        requireMemberId(actor.memberId),
        input.id,
        ACCESS_LEVELS.edit,
      );
    },
    async execute({ tx, workspaceId, loaded }) {
      const moved = await moveTaskInTx(tx, {
        workspaceId,
        taskId: input.id,
        status: input.status,
        afterTaskId: input.afterTaskId ?? null,
      });

      return {
        result: { id: input.id, ...moved },
        outbox: [boardEvent(workspaceId, loaded.spaceId, input.id, "moved")],
        activity: {
          kind: "task.moved",
          subjectType: "task",
          subjectId: input.id,
          payload: { status: input.status },
        },
        audit: {
          action: "tasks.move",
          targetType: "task",
          targetId: input.id,
          payload: { status: input.status, position: moved.position },
        },
      };
    },
  }),
});

export const assignTask = defineWriteAction({
  name: "tasks.assign",
  summary:
    "Assigns a member, which grants them edit on this task and notifies them.",
  input: z.object({ id: z.uuid(), memberId: z.uuid() }),
  output: z.object({ assigned: z.boolean() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async load({ tx, workspaceId, actor }) {
      return requireTask(
        tx,
        workspaceId,
        requireMemberId(actor.memberId),
        input.id,
        ACCESS_LEVELS.edit,
      );
    },
    async execute({ tx, workspaceId, actor, loaded }) {
      const outcome = await assignTaskInTx(tx, {
        workspaceId,
        taskId: input.id,
        contextId: loaded.contextId,
        memberId: input.memberId,
      });
      if (outcome.assigned) {
        await notifyAssignees(tx, {
          workspaceId,
          taskId: input.id,
          actorMemberId: actor.memberId,
        });
      }

      return {
        result: outcome,
        // Only when something changed. Assigning the same member twice is one
        // assignment, and a second outbox row carries the same idempotency key:
        // the insert refuses it and the whole write fails, which is how this
        // was found.
        ...(outcome.assigned
          ? {
              outbox: [
                boardEvent(workspaceId, loaded.spaceId, input.id, "updated"),
              ],
            }
          : {}),
        activity: {
          kind: "task.assigned",
          subjectType: "task",
          subjectId: input.id,
          payload: { memberId: input.memberId },
        },
        audit: {
          action: "tasks.assign",
          targetType: "task",
          targetId: input.id,
          payload: { memberId: input.memberId },
        },
      };
    },
  }),
});

export const unassignTask = defineWriteAction({
  name: "tasks.unassign",
  summary: "Removes an assignment and the edit access it granted.",
  input: z.object({ id: z.uuid(), memberId: z.uuid() }),
  output: z.object({ unassigned: z.boolean() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async load({ tx, workspaceId, actor }) {
      return requireTask(
        tx,
        workspaceId,
        requireMemberId(actor.memberId),
        input.id,
        ACCESS_LEVELS.edit,
      );
    },
    async execute({ tx, workspaceId, loaded }) {
      const outcome = await unassignTaskInTx(tx, {
        workspaceId,
        taskId: input.id,
        contextId: loaded.contextId,
        memberId: input.memberId,
      });

      return {
        result: outcome,
        // Only when something changed. Assigning the same member twice is one
        // assignment, and a second outbox row carries the same idempotency key:
        // the insert refuses it and the whole write fails, which is how this
        // was found.
        ...(outcome.unassigned
          ? {
              outbox: [
                boardEvent(workspaceId, loaded.spaceId, input.id, "updated"),
              ],
            }
          : {}),
        activity: {
          kind: "task.unassigned",
          subjectType: "task",
          subjectId: input.id,
          payload: { memberId: input.memberId },
        },
        audit: {
          action: "tasks.unassign",
          targetType: "task",
          targetId: input.id,
          payload: { memberId: input.memberId },
        },
      };
    },
  }),
});

export const addChecklistItem = defineWriteAction({
  name: "tasks.addChecklistItem",
  summary: "Adds one line to a task's checklist.",
  input: z.object({
    id: z.uuid(),
    title: z.string().trim().min(1).max(300),
  }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async load({ tx, workspaceId, actor }) {
      return requireTask(
        tx,
        workspaceId,
        requireMemberId(actor.memberId),
        input.id,
        ACCESS_LEVELS.edit,
      );
    },
    async execute({ tx, workspaceId }) {
      const created = await addChecklistItemInTx(tx, {
        workspaceId,
        taskId: input.id,
        title: input.title,
      });
      return {
        result: created,
        activity: {
          kind: "task.checklist_changed",
          subjectType: "task",
          subjectId: input.id,
          payload: { change: "added" },
        },
        audit: {
          action: "tasks.addChecklistItem",
          targetType: "task",
          targetId: input.id,
        },
      };
    },
  }),
});

export const setChecklistItem = defineWriteAction({
  name: "tasks.setChecklistItem",
  summary: "Ticks or unticks one checklist line.",
  input: z.object({
    id: z.uuid(),
    itemId: z.uuid(),
    done: z.boolean(),
  }),
  output: z.object({ itemId: z.uuid(), done: z.boolean() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async load({ tx, workspaceId, actor }) {
      return requireTask(
        tx,
        workspaceId,
        requireMemberId(actor.memberId),
        input.id,
        ACCESS_LEVELS.edit,
      );
    },
    async execute({ tx, workspaceId }) {
      // openokr:allow-mutation: the calling Operation's own transaction.
      await tx
        .update(checklistItems)
        .set({ done: input.done, updatedAt: new Date() })
        .where(
          activeOnly(
            checklistItems,
            eq(checklistItems.workspaceId, workspaceId),
            eq(checklistItems.id, input.itemId),
            eq(checklistItems.taskId, input.id),
          ),
        );
      return {
        result: { itemId: input.itemId, done: input.done },
        activity: {
          kind: "task.checklist_changed",
          subjectType: "task",
          subjectId: input.id,
          payload: { change: input.done ? "ticked" : "unticked" },
        },
        audit: {
          action: "tasks.setChecklistItem",
          targetType: "task",
          targetId: input.id,
        },
      };
    },
  }),
});

export const removeChecklistItem = defineWriteAction({
  name: "tasks.removeChecklistItem",
  summary: "Removes one checklist line.",
  input: z.object({ id: z.uuid(), itemId: z.uuid() }),
  output: z.object({ itemId: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async load({ tx, workspaceId, actor }) {
      return requireTask(
        tx,
        workspaceId,
        requireMemberId(actor.memberId),
        input.id,
        ACCESS_LEVELS.edit,
      );
    },
    async execute({ tx, workspaceId }) {
      const now = new Date();
      // openokr:allow-mutation: the calling Operation's own transaction.
      await tx
        .update(checklistItems)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          activeOnly(
            checklistItems,
            eq(checklistItems.workspaceId, workspaceId),
            eq(checklistItems.id, input.itemId),
            eq(checklistItems.taskId, input.id),
          ),
        );
      return {
        result: { itemId: input.itemId },
        activity: {
          kind: "task.checklist_changed",
          subjectType: "task",
          subjectId: input.id,
          payload: { change: "removed" },
        },
        audit: {
          action: "tasks.removeChecklistItem",
          targetType: "task",
          targetId: input.id,
        },
      };
    },
  }),
});

export const deleteTask = defineWriteAction({
  name: "tasks.delete",
  summary: "Soft-deletes a task, its assignments and its checklist.",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.full,
  safety: "destructive",
  operation: (_context, input) => ({
    async load({ tx, workspaceId, actor }) {
      return requireTask(
        tx,
        workspaceId,
        requireMemberId(actor.memberId),
        input.id,
        ACCESS_LEVELS.full,
      );
    },
    async execute({ tx, workspaceId, loaded }) {
      const now = new Date();
      for (const table of [taskAssignees, checklistItems] as const) {
        // openokr:allow-mutation: the calling Operation's own transaction.
        await tx
          .update(table)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            activeOnly(
              table,
              eq(table.workspaceId, workspaceId),
              eq(table.taskId, input.id),
            ),
          );
      }
      // openokr:allow-mutation: the calling Operation's own transaction.
      await tx
        .update(tasks)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          activeOnly(
            tasks,
            eq(tasks.workspaceId, workspaceId),
            eq(tasks.id, input.id),
          ),
        );

      return {
        result: { id: input.id },
        outbox: [boardEvent(workspaceId, loaded.spaceId, input.id, "deleted")],
        activity: {
          kind: "task.deleted",
          subjectType: "task",
          subjectId: input.id,
          payload: { title: loaded.title },
        },
        audit: {
          action: "tasks.delete",
          targetType: "task",
          targetId: input.id,
          payload: { title: loaded.title },
        },
      };
    },
  }),
});

export const readLinkedWork = defineReadAction({
  name: "tasks.linkedWork",
  summary:
    "Linked work per key result for one cycle: two counts, and the sentence when they disagree with the measure.",
  input: z.object({ cycleId: z.uuid() }),
  output: z.array(
    z.object({
      keyResultId: z.uuid(),
      keyResultTitle: z.string(),
      goalTitle: z.string(),
      progressPct: z.number(),
      linkedWork: z.object({
        done: z.number().int(),
        total: z.number().int(),
      }),
      divergence: z.string().nullable(),
    }),
  ),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      return [];
    }
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as OperationTx;
        const memberId = await actingMember(tx, context.workspaceId, userId);

        const rows = await tx
          .select({ id: keyResults.id, goalId: keyResults.goalId })
          .from(keyResults)
          .innerJoin(goals, eq(goals.id, keyResults.goalId))
          .where(
            activeOnly(
              keyResults,
              eq(keyResults.workspaceId, context.workspaceId),
              eq(goals.cycleId, input.cycleId),
              isNull(goals.deletedAt),
            ),
          );

        // Through the goal, which is the rule the rest of the product follows: a
        // key result inherits its goal's context.
        const visible: string[] = [];
        for (const row of rows) {
          const allowed = await getAccessScoped(tx, {
            workspaceId: context.workspaceId,
            memberId,
            resourceType: "goal",
            resourceId: row.goalId,
          }).then(
            () => true,
            () => false,
          );
          if (allowed) {
            visible.push(row.id);
          }
        }
        return buildRail(tx, context.workspaceId, visible);
      },
    );
  },
});
