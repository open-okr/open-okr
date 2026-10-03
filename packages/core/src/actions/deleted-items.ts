/**
 * What has been deleted and can be brought back (completeness review M-13).
 *
 * **The delete control promised this screen and nothing built it.** Goals,
 * initiatives, tasks and documents have been soft-deleted since each shipped,
 * and the sentence beside the delete said an administrator could bring one
 * back. There was no action that did, and no list to find one on.
 *
 * **Only what the reader could restore.** Each row is checked with the level
 * its own restore asks, which is the level its delete asked: `full` on a goal,
 * an initiative or a task, and the document's write rule for a document. So an
 * administrator who is not a goal's champion does not see that goal here, for
 * the same reason they could not have deleted it, and a row on this list never
 * leads to a refusal about access.
 *
 * **Who deleted it comes from the feed's own row.** Every delete writes a
 * `<kind>.deleted` activity with its actor in the same transaction, so that
 * row is the record of who did it rather than something this read infers.
 *
 * **A key result removed on its own is here too** (P9-T06b). One deleted with
 * its objective is not: it comes back with the objective. Its removal's
 * activity names the objective as its subject, so who removed it is matched
 * on the key result id the activity carries since P9-T06b, and an older
 * removal reads as unknown.
 */
import {
  activeOnly,
  activities,
  documents,
  goals,
  includeDeleted,
  initiatives,
  tasks,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { visibleResourceIds } from "../access/reads.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import { defineReadAction } from "./define.ts";
import { requireRestorableDocument } from "./documents.ts";
import { removedKeyResults } from "./goal-targets.ts";

/**
 * The most recent deletions of each kind this read looks at.
 *
 * A page rather than everything, because a workspace that has run for years
 * has deleted a great deal and the screen is for the thing somebody deleted
 * this week. A hundred of each is far more than anybody scrolls, and small
 * enough that the per-row document check below stays cheap.
 */
const PER_KIND = 100;

const DELETED_SUBJECT_TYPES = [
  "goal",
  "key_result",
  "initiative",
  "task",
  "document",
] as const;

const deletedItem = z.object({
  subjectType: z.enum(DELETED_SUBJECT_TYPES),
  id: z.uuid(),
  title: z.string(),
  deletedAt: z.string(),
  /** Null when the delete predates the feed row, or its actor was no member. */
  deletedBy: z.string().nullable(),
});

type DeletedItem = z.infer<typeof deletedItem>;

/** The acting member, refusing the way every other read does. */
async function actingMember(
  tx: OperationTx,
  workspaceId: string,
  userId: string,
): Promise<string> {
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
    throw new OperationError("not_found", "No such workspace.");
  }
  return member.id;
}

/** The deleted rows of one own-context kind, newest first. */
async function deletedRows(
  tx: OperationTx,
  workspaceId: string,
  kind: "goal" | "initiative" | "task",
): Promise<{ id: string; title: string; deletedAt: Date }[]> {
  const table =
    kind === "goal" ? goals : kind === "initiative" ? initiatives : tasks;
  const rows = await tx
    .select({ id: table.id, title: table.title, deletedAt: table.deletedAt })
    .from(table)
    .where(
      includeDeleted(
        table,
        eq(table.workspaceId, workspaceId),
        isNotNull(table.deletedAt),
      ),
    )
    .orderBy(desc(table.deletedAt))
    .limit(PER_KIND);
  return rows.map((row) => ({ ...row, deletedAt: row.deletedAt as Date }));
}

export const listDeletedItems = defineReadAction({
  name: "workspace.deletedItems",
  summary:
    "The goals, initiatives, tasks and documents that were deleted and that the caller could restore, newest first, with who deleted each.",
  input: z.object({}),
  output: z.object({ items: z.array(deletedItem) }),
  // The screen is an administrator's, and so is every restore on it: each
  // one asks `full` on the workspace before it asks anything of the row.
  access: ACCESS_LEVELS.full,
  async handler(context) {
    const userId = context.actor.userId;
    if (!userId) {
      return { items: [] };
    }
    return withContext(
      drizzle(context.pool),
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as OperationTx;
        const workspaceId = context.workspaceId;
        const memberId = await actingMember(tx, workspaceId, userId);

        const items: Omit<DeletedItem, "deletedBy">[] = [];
        for (const kind of ["goal", "initiative", "task"] as const) {
          const rows = await deletedRows(tx, workspaceId, kind);
          // One statement for the whole kind, at the level its restore asks.
          const allowed = await visibleResourceIds(tx, {
            workspaceId,
            memberId,
            resourceType: kind,
            ids: rows.map((row) => row.id),
            requires: ACCESS_LEVELS.full,
          });
          for (const row of rows) {
            if (allowed.has(row.id)) {
              items.push({
                subjectType: kind,
                id: row.id,
                title: row.title,
                deletedAt: row.deletedAt.toISOString(),
              });
            }
          }
        }

        // A key result is restored at the level its removal asked, `full` on
        // its objective, so the check is on the objective.
        const keyResultRows = await removedKeyResults(
          tx,
          workspaceId,
          PER_KIND,
        );
        const keyResultsAllowed = await visibleResourceIds(tx, {
          workspaceId,
          memberId,
          resourceType: "goal",
          ids: [...new Set(keyResultRows.map((row) => row.goalId))],
          requires: ACCESS_LEVELS.full,
        });
        for (const row of keyResultRows) {
          if (keyResultsAllowed.has(row.goalId)) {
            items.push({
              subjectType: "key_result",
              id: row.id,
              title: `${row.title} (${row.goalTitle})`,
              deletedAt: row.deletedAt.toISOString(),
            });
          }
        }

        // A document owns no context, so the set-shaped check above cannot
        // answer for it. Its restore's own loader can, one row at a time, and
        // using it means the list and the restore cannot disagree.
        const documentRows = await tx
          .select({ id: documents.id })
          .from(documents)
          .where(
            includeDeleted(
              documents,
              eq(documents.workspaceId, workspaceId),
              isNotNull(documents.deletedAt),
            ),
          )
          .orderBy(desc(documents.deletedAt))
          .limit(PER_KIND);
        for (const row of documentRows) {
          const restorable = await requireRestorableDocument(
            tx,
            workspaceId,
            memberId,
            row.id,
          ).catch((error: unknown) => {
            if (error instanceof OperationError) {
              return null;
            }
            throw error;
          });
          if (restorable) {
            items.push({
              subjectType: "document",
              id: row.id,
              title: restorable.title,
              deletedAt: restorable.deletedAt.toISOString(),
            });
          }
        }

        const deleters = await whoDeleted(
          tx,
          workspaceId,
          items.map((item) => item.id),
        );
        return {
          items: items
            .map((item) => ({
              ...item,
              deletedBy: deleters.get(item.id) ?? null,
            }))
            .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt)),
        };
      },
    );
  },
});

/**
 * The name of whoever deleted each subject, from the most recent delete row.
 *
 * Most recent, because a thing can be deleted, restored and deleted again, and
 * the list is about the delete that put it here.
 */
async function whoDeleted(
  tx: OperationTx,
  workspaceId: string,
  subjectIds: readonly string[],
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (subjectIds.length === 0) {
    return found;
  }
  const rows = await tx
    .select({
      subjectId: activities.subjectId,
      name: workspaceMembers.name,
    })
    .from(activities)
    .innerJoin(
      workspaceMembers,
      eq(workspaceMembers.id, activities.actorMemberId),
    )
    .where(
      and(
        eq(activities.workspaceId, workspaceId),
        inArray(activities.kind, [
          "goal.deleted",
          "initiative.deleted",
          "task.deleted",
          "document.deleted",
        ]),
        inArray(activities.subjectId, [...subjectIds]),
      ),
    )
    .orderBy(desc(activities.at));
  for (const row of rows) {
    if (!found.has(row.subjectId)) {
      found.set(row.subjectId, row.name);
    }
  }

  // A key result's removal is an activity on its objective, carrying the key
  // result's id in its payload.
  const removals = await tx
    .select({
      keyResultId: sql<string>`${activities.payload}->>'keyResultId'`,
      name: workspaceMembers.name,
    })
    .from(activities)
    .innerJoin(
      workspaceMembers,
      eq(workspaceMembers.id, activities.actorMemberId),
    )
    .where(
      and(
        eq(activities.workspaceId, workspaceId),
        eq(activities.kind, "key_result.removed"),
        inArray(sql<string>`${activities.payload}->>'keyResultId'`, [
          ...subjectIds,
        ]),
      ),
    )
    .orderBy(desc(activities.at));
  for (const row of removals) {
    if (!found.has(row.keyResultId)) {
      found.set(row.keyResultId, row.name);
    }
  }
  return found;
}
