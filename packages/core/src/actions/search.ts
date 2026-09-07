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
import { activeOnly, kpis, withContext, workspaceMembers } from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import type { OperationTx } from "../operations/operation.ts";
import { OperationError } from "../operations/operation.ts";
import { searchWithSemantic } from "../search/service.ts";
import { defineReadAction } from "./define.ts";

/** Where a result of each type opens. */
const HREF_FOR: Readonly<Record<string, (id: string) => string>> = {
  goal: (id) => `/goals/${id}`,
  key_result: (id) => `/goals/${id}`,
  kpi: (id) => `/kpis/${id}`,
  initiative: (id) => `/initiatives/${id}`,
  task: (id) => `/tasks/${id}`,
  document: (id) => `/documents/${id}`,
  session: (id) => `/session/${id}`,
  comment: (id) => `/goals/${id}`,
  check_in: (id) => `/goals/${id}`,
};

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

    return hits.map((hit) => ({
      entityType: hit.entityType,
      entityId: hit.entityId,
      title: hit.title,
      snippet: hit.snippet,
      href: HREF_FOR[hit.entityType]?.(hit.entityId) ?? "/",
      rank: hit.rank,
      semantic: hit.semantic,
    }));
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
   * for everything else, rather than pretending to a lookup it cannot do. The
   * palette falls back to the phrase search, which is what somebody typing a
   * goal's name wanted anyway.
   *
   * Giving the other three a short code is a schema change with an
   * allocation scheme behind it, and it belongs to whichever task decides what
   * those codes look like. Recorded on the P5-T13 row rather than guessed at.
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
        await actingMember(tx, context.workspaceId, userId);

        const [kpi] = await tx
          .select({ id: kpis.id, title: kpis.title })
          .from(kpis)
          .where(
            activeOnly(
              kpis,
              eq(kpis.workspaceId, context.workspaceId),
              eq(kpis.shortId, code),
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
