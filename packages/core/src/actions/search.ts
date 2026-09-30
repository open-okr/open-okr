/**
 * Search and the palette's own reads (UIUX-PLAN.md §4 S-32, P5-T13).
 *
 * **One read behind three surfaces.** The search page, the command palette and
 * the agent's `search` tool all answer from `searchWorkspace`. A second query
 * path would be a second answer about who can see what.
 *
 * **Filtered in SQL.** Every row in the index carries the access context it is
 * visible through, so the same `EXISTS` clause every list read composes does
 * the filtering. A member who loses a space stops seeing its rows on the next
 * query with no reindex.
 */
import {
  accessContexts,
  activeOnly,
  kpis,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { accessFilterMember, accessScopeFilter } from "../access/reads.ts";
import type { OperationTx } from "../operations/operation.ts";
import { OperationError } from "../operations/operation.ts";
import { findByName, NAMED_KINDS } from "../search/entities.ts";
import { resolveHrefs } from "../search/hrefs.ts";
import { searchWithSemantic } from "../search/service.ts";
import { defineReadAction } from "./define.ts";

async function actingMember(
  tx: OperationTx,
  workspaceId: string,
  userId: string | undefined,
): Promise<string> {
  if (!userId) {
    throw new OperationError("not_found", "No such workspace.");
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
    throw new OperationError("not_found", "No such workspace.");
  }
  return member.id;
}

const searchInput = z.object({
  text: z.string().trim().min(1).max(500),
  entityTypes: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export const runSearch = defineReadAction({
  name: "search.query",
  summary:
    "Everything in this workspace matching a phrase that the caller may read. Drives screen S-32.",
  input: searchInput,
  output: z.array(
    z.object({
      entityType: z.string(),
      entityId: z.uuid(),
      title: z.string(),
      /** Matching words with `<b>` around the matches. Sanitised at render. */
      snippet: z.string(),
      href: z.string(),
      rank: z.number(),
      semantic: z.boolean(),
    }),
  ),
  access: ACCESS_LEVELS.view,
  async handler(context, rawInput) {
    // Parsed here, because `callAction` does not parse a read action's input:
    // the same gap `tasks.board` was found through at P5-T11.
    const input = searchInput.parse(rawInput);
    const userId = context.actor.userId;
    if (!userId) {
      return [];
    }

    const memberId = await withContext(
      drizzle(context.pool),
      { workspaceId: context.workspaceId, userId },
      (rawTx) =>
        actingMember(rawTx as OperationTx, context.workspaceId, userId),
    );

    const hits = await searchWithSemantic(
      context.pool,
      {
        workspaceId: context.workspaceId,
        memberId,
        text: input.text,
        ...(input.entityTypes ? { entityTypes: input.entityTypes } : {}),
        ...(input.limit ? { limit: input.limit } : {}),
      },
      context.embed ?? null,
    );

    // Where each one opens, read from its parent where it has no page of its
    // own (completeness review M-21). A result with nowhere to open, or in a
    // session the reader is not in, is left out rather than pointed at the
    // home page or at a refusal.
    const hrefs = await resolveHrefs(
      context.pool,
      context.workspaceId,
      memberId,
      hits,
    );
    return hits.flatMap((hit) => {
      const href = hrefs.get(`${hit.entityType}:${hit.entityId}`);
      return href
        ? [
            {
              entityType: hit.entityType,
              entityId: hit.entityId,
              title: hit.title,
              snippet: hit.snippet,
              href,
              rank: hit.rank,
              semantic: hit.semantic,
            },
          ]
        : [];
    });
  },
});

const entitiesInput = z.object({
  text: z.string().trim().min(1).max(200),
  limit: z.number().int().min(1).max(20).optional(),
});

export const findEntities = defineReadAction({
  name: "search.entities",
  summary:
    "The things of every kind whose name matches a phrase, that the caller may open. The palette's jump. Drives screen S-32.",
  input: entitiesInput,
  output: z.array(
    z.object({
      entityType: z.enum(NAMED_KINDS),
      entityId: z.uuid(),
      title: z.string(),
      href: z.string(),
    }),
  ),
  access: ACCESS_LEVELS.view,
  /**
   * The jump by name that §3 asks of the palette (completeness review M-21).
   *
   * `search.jump` answers a short identifier, and only a KPI has one. This
   * answers the start of a name, for goals, key results, KPIs, spaces, people,
   * initiatives, tasks, documents, sessions and cycles, each filtered by the
   * rule its own read applies. `search/entities.ts` says which rule is which.
   */
  async handler(context, input) {
    const userId = context.actor.userId;
    if (!userId) {
      return [];
    }
    const memberId = await withContext(
      drizzle(context.pool),
      { workspaceId: context.workspaceId, userId },
      (rawTx) =>
        actingMember(rawTx as OperationTx, context.workspaceId, userId),
    );
    return findByName(context.pool, {
      workspaceId: context.workspaceId,
      memberId,
      text: input.text,
      ...(input.limit ? { limit: input.limit } : {}),
    });
  },
});

export const readPaletteJump = defineReadAction({
  name: "search.jump",
  summary:
    "The entity one short identifier means, for the palette's jump. Drives screen S-32.",
  input: z.object({ shortId: z.string().trim().min(1).max(40) }),
  output: z
    .object({
      entityType: z.string(),
      entityId: z.uuid(),
      title: z.string(),
      href: z.string(),
    })
    .nullable(),
  access: ACCESS_LEVELS.view,
  /**
   * **One table carries a short identifier today, and it is `kpis`.** S-32 asks
   * for an entity jump by short code, and only `kpis.short_id` exists: goals,
   * initiatives and tasks have none. So this answers for a KPI and answers null
   * for everything else, rather than pretending to a lookup it cannot do.
   *
   * The jump by name is `search.entities`, beside this, and reaches every kind
   * (completeness review M-21). The palette asks both. Giving the other kinds a
   * short code is a schema change with an allocation scheme behind it, and it
   * belongs to whichever task decides what those codes look like. Recorded on
   * the P5-T13 row rather than guessed at.
   */
  async handler(context, input) {
    const userId = context.actor.userId;
    if (!userId) {
      return null;
    }
    // **Not upper-cased.** `kpis.shortId` draws from a mixed-case alphabet
    // (`123456789abc…XYZ`), so folding the case makes every jump miss. Found by
    // a test that created a KPI and asked for its own code back.
    const code = input.shortId.trim();

    return withContext(
      drizzle(context.pool),
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as OperationTx;
        // Resolved so a suspended member gets nothing, the same as every read.
        const memberId = await actingMember(tx, context.workspaceId, userId);

        // **Through the workspace's own context, which is the rule the index
        // applies to a KPI** (completeness review M-21). This read used to
        // answer any active member, so a guest who typed a KPI's code got its
        // title from the jump while the jump by name, beside it, rightly
        // offered them nothing. The two answer in one list, so they have to
        // agree about who may see what.
        const [kpi] = await tx
          .select({ id: kpis.id, title: kpis.title })
          .from(kpis)
          .innerJoin(
            accessContexts,
            activeOnly(
              accessContexts,
              eq(accessContexts.workspaceId, context.workspaceId),
              eq(accessContexts.resourceType, "workspace"),
              eq(accessContexts.resourceId, kpis.workspaceId),
            ),
          )
          .where(
            and(
              activeOnly(
                kpis,
                eq(kpis.workspaceId, context.workspaceId),
                eq(kpis.shortId, code),
              ),
              accessScopeFilter(accessContexts.id, {
                workspaceId: context.workspaceId,
                memberId,
                minLevel: ACCESS_LEVELS.view,
                member: await accessFilterMember(tx, {
                  workspaceId: context.workspaceId,
                  memberId,
                }),
              }),
            ),
          )
          .limit(1);

        return kpi
          ? {
              entityType: "kpi",
              entityId: kpi.id,
              title: kpi.title,
              href: `/kpis/${kpi.id}`,
            }
          : null;
      },
    );
  },
});
