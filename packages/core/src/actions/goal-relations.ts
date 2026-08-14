/**
 * One goal's neighbours, for the S-14 right rail (P3-T10).
 *
 * The parent it supports, the goals that hang off it, the horizontal links it
 * carries and its own register entries, in one read. Four separate reads would
 * be four round trips for a panel that is always rendered whole.
 *
 * Its own file rather than another entry in `alignment.ts`, because this is a
 * read about a goal that happens to include its links, not a read about the
 * cascade. The register resolution is shared through
 * `packages/core/src/alignment/service.ts` so the two cannot drift.
 */
import {
  activeOnly,
  goalDependencies,
  goals,
  keyResults,
  spaces,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import { asc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { getAccessScoped } from "../access/reads.ts";
import { blocksPublish, loadDependencyRegister } from "../alignment/service.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import { defineReadAction } from "./define.ts";

export const readGoalRelations = defineReadAction({
  name: "goals.relations",
  summary:
    "The parent, children, horizontal dependencies and register entries of one goal.",
  input: z.object({ id: z.uuid() }),
  output: z.object({
    parent: z
      .object({ id: z.uuid(), title: z.string(), level: z.string() })
      .nullable(),
    children: z.array(
      z.object({
        id: z.uuid(),
        title: z.string(),
        level: z.string(),
        health: z.string(),
        progressPct: z.number(),
      }),
    ),
    dependencies: z.array(
      z.object({
        id: z.uuid(),
        goalId: z.uuid(),
        title: z.string(),
        note: z.string().nullable(),
      }),
    ),
    register: z.array(
      z.object({
        id: z.uuid(),
        keyResultTitle: z.string(),
        provider: z.string(),
        confirmed: z.boolean(),
        riskOwnerName: z.string().nullable(),
        blocksPublish: z.boolean(),
      }),
    ),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such workspace.");
    }
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as OperationTx;

        const [member] = await tx
          .select({ id: workspaceMembers.id })
          .from(workspaceMembers)
          .where(
            activeOnly(
              workspaceMembers,
              eq(workspaceMembers.workspaceId, context.workspaceId),
              eq(workspaceMembers.userId, userId),
              eq(workspaceMembers.status, "active"),
            ),
          )
          .limit(1);
        if (!member) {
          throw new OperationError("not_found", "No such workspace.");
        }
        const memberId = member.id;

        /** Not-found on forbidden, the same as every other read of a goal. */
        const seen = async (goalId: string): Promise<boolean> => {
          try {
            await getAccessScoped(tx, {
              workspaceId: context.workspaceId,
              memberId,
              resourceType: "goal",
              resourceId: goalId,
              requires: ACCESS_LEVELS.view as never,
            });
            return true;
          } catch (error) {
            if (error instanceof OperationError && error.code === "not_found") {
              return false;
            }
            throw error;
          }
        };

        if (!(await seen(input.id))) {
          throw new OperationError("not_found", "No such goal.");
        }

        const [row] = await tx
          .select({
            parentGoalId: goals.parentGoalId,
            parentKeyResultId: goals.parentKeyResultId,
          })
          .from(goals)
          .where(
            activeOnly(
              goals,
              eq(goals.workspaceId, context.workspaceId),
              eq(goals.id, input.id),
            ),
          )
          .limit(1);
        if (!row) {
          throw new OperationError("not_found", "No such goal.");
        }

        // A key result parent is shown as the goal that owns it, the same way
        // the canvas and the score both resolve it. A rail that named a key
        // result where the score names a goal would read as a disagreement.
        let parentId = row.parentGoalId;
        if (!parentId && row.parentKeyResultId) {
          const [owner] = await tx
            .select({ goalId: keyResults.goalId })
            .from(keyResults)
            .where(
              activeOnly(
                keyResults,
                eq(keyResults.workspaceId, context.workspaceId),
                eq(keyResults.id, row.parentKeyResultId),
              ),
            )
            .limit(1);
          parentId = owner?.goalId ?? null;
        }

        const parentRows = parentId
          ? await tx
              .select({ id: goals.id, title: goals.title, level: goals.level })
              .from(goals)
              .where(
                activeOnly(
                  goals,
                  eq(goals.workspaceId, context.workspaceId),
                  eq(goals.id, parentId),
                ),
              )
              .limit(1)
          : [];
        const parentRow = parentRows[0];
        const parent =
          parentRow && (await seen(parentRow.id)) ? parentRow : null;

        const childRows = await tx
          .select({
            id: goals.id,
            title: goals.title,
            level: goals.level,
            health: goals.health,
            progressPct: goals.progressPct,
          })
          .from(goals)
          .where(
            activeOnly(
              goals,
              eq(goals.workspaceId, context.workspaceId),
              eq(goals.parentGoalId, input.id),
            ),
          )
          .orderBy(asc(goals.title));
        const children = [];
        for (const child of childRows) {
          if (await seen(child.id)) {
            children.push({
              id: child.id,
              title: child.title,
              level: child.level,
              health: child.health,
              progressPct: Number(child.progressPct),
            });
          }
        }

        const linkRows = await tx
          .select({
            id: goalDependencies.id,
            fromGoalId: goalDependencies.fromGoalId,
            toGoalId: goalDependencies.toGoalId,
            note: goalDependencies.note,
          })
          .from(goalDependencies)
          .where(
            activeOnly(
              goalDependencies,
              eq(goalDependencies.workspaceId, context.workspaceId),
            ),
          );
        const mine = linkRows.filter(
          (link) => link.fromGoalId === input.id || link.toGoalId === input.id,
        );
        const otherIds = mine.map((link) =>
          link.fromGoalId === input.id ? link.toGoalId : link.fromGoalId,
        );
        const otherTitles = new Map(
          otherIds.length === 0
            ? []
            : (
                await tx
                  .select({ id: goals.id, title: goals.title })
                  .from(goals)
                  .where(
                    activeOnly(
                      goals,
                      eq(goals.workspaceId, context.workspaceId),
                      inArray(goals.id, otherIds),
                    ),
                  )
              ).map((entry) => [entry.id, entry.title]),
        );
        const dependencies = [];
        for (const link of mine) {
          // The other end, whichever side this goal was stored on. Direction
          // carries no meaning (§5.1), so the rail never shows one.
          const otherId =
            link.fromGoalId === input.id ? link.toGoalId : link.fromGoalId;
          const title = otherTitles.get(otherId);
          if (!title || !(await seen(otherId))) {
            continue;
          }
          dependencies.push({
            id: link.id,
            goalId: otherId,
            title,
            note: link.note,
          });
        }

        const ownKeyResults = await tx
          .select({ id: keyResults.id, title: keyResults.title })
          .from(keyResults)
          .where(
            activeOnly(
              keyResults,
              eq(keyResults.workspaceId, context.workspaceId),
              eq(keyResults.goalId, input.id),
            ),
          );
        const titleOf = new Map(
          ownKeyResults.map((entry) => [entry.id, entry.title]),
        );
        const registerRows = await loadDependencyRegister(
          tx,
          context.workspaceId,
          ownKeyResults.map((entry) => entry.id),
        );

        const spaceNames = new Map(
          (
            await tx
              .select({ id: spaces.id, name: spaces.name })
              // openokr:allow-raw-read: names only, and every human member holds
              // `view` on every space through the `workspace_standard` binding
              // P3-T01 gives them, so this discloses nothing the spaces list
              // does not. The rail needs a team's name, not an identifier.
              .from(spaces)
              .where(
                activeOnly(spaces, eq(spaces.workspaceId, context.workspaceId)),
              )
          ).map((entry) => [entry.id, entry.name]),
        );
        const memberNames = new Map(
          (
            await tx
              .select({ id: workspaceMembers.id, name: workspaceMembers.name })
              .from(workspaceMembers)
              .where(
                activeOnly(
                  workspaceMembers,
                  eq(workspaceMembers.workspaceId, context.workspaceId),
                ),
              )
          ).map((entry) => [entry.id, entry.name]),
        );

        return {
          parent,
          children,
          dependencies,
          register: registerRows.map((entry) => ({
            id: entry.id,
            keyResultTitle: titleOf.get(entry.keyResultId) ?? "a key result",
            provider:
              (entry.providerSpaceId
                ? spaceNames.get(entry.providerSpaceId)
                : entry.providerText) ?? "a team that no longer exists",
            confirmed: entry.confirmed,
            riskOwnerName: entry.riskOwnerId
              ? (memberNames.get(entry.riskOwnerId) ?? null)
              : null,
            blocksPublish: blocksPublish(entry),
          })),
        };
      },
    );
  },
});
