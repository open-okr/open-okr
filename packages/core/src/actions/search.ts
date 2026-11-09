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
import { activeOnly, withContext, workspaceMembers } from "@openokr/db";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { resolveAddress } from "../ids/address.ts";
import { type AddressKind, isShortId, SHORT_ID_TABLES } from "../ids/short.ts";
import type { OperationTx } from "../operations/operation.ts";
import { OperationError } from "../operations/operation.ts";
import { findByName, NAMED_KINDS } from "../search/entities.ts";
import { hrefsInTx, resolveHrefs } from "../search/hrefs.ts";
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

/** The longest phrase a search takes, which the search box holds it to. */
export const SEARCH_TEXT_MAX_LENGTH = 500;

const searchInput = z.object({
  text: z.string().trim().min(1).max(SEARCH_TEXT_MAX_LENGTH),
  entityTypes: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export const runSearch = defineReadAction({
  name: "search.query",
  summary:
    "Everything in this workspace matching a phrase that the caller may read.",
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
  /** Only these kinds; every kind when absent. */
  kinds: z.array(z.enum(NAMED_KINDS)).min(1).optional(),
});

export const findEntities = defineReadAction({
  name: "search.entities",
  summary:
    "The things of every kind whose name matches a phrase, that the caller may open. The palette's jump.",
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
      ...(input.kinds ? { kinds: input.kinds } : {}),
    });
  },
});

/**
 * The eight kinds a short identifier names, in the order the jump tries them.
 * Uniqueness is per table, so two kinds could in principle share one; the
 * first the reader can open wins, and `kinds` narrows the question.
 */
const JUMP_KINDS = [
  "goal",
  "key_result",
  "kpi",
  "initiative",
  "task",
  "document",
  "session",
  "cycle",
] as const satisfies readonly AddressKind[];

/** The column each kind's name is in. */
const TITLE_COLUMN: Readonly<Record<AddressKind, string>> = {
  cycle: "name",
  goal: "title",
  key_result: "title",
  kpi: "title",
  initiative: "title",
  task: "title",
  document: "title",
  session: "title",
};

export const readPaletteJump = defineReadAction({
  name: "search.jump",
  summary:
    "The thing one short identifier names, of any kind, for the palette's jump.",
  input: z.object({
    shortId: z.string().trim().min(1).max(40),
    /** Only these kinds, as a page asks for its own. Every kind when absent. */
    kinds: z.array(z.enum(JUMP_KINDS)).min(1).optional(),
  }),
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
   * **Every addressable kind since 0.7.0** (docs/design/short-ids.md S5). It
   * answered a KPI's code and null for anything else while only `kpis` had a
   * short identifier.
   *
   * Each kind is found through `resolveAddress`, so the rule is the one every
   * action applies to a short identifier: the kind's own read, through the
   * access getter. A guest who types a KPI's code gets nothing, as the jump by
   * name beside this gives them nothing (completeness review M-21), and a
   * session opens only for somebody in its room. A deleted row is not offered,
   * and nor is one with no page this reader may open.
   *
   * The jump by name is `search.entities`; the palette asks both.
   */
  async handler(context, input) {
    const userId = context.actor.userId;
    if (!userId) {
      return null;
    }
    // **Not upper-cased.** The alphabet is mixed-case (`123456789abc…XYZ`), so
    // folding the case makes every jump miss. Found by a test that created a
    // KPI and asked for its own code back.
    const code = input.shortId.trim();
    if (!isShortId(code)) {
      return null;
    }

    return withContext(
      drizzle(context.pool),
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as OperationTx;
        // Resolved so a suspended member gets nothing, the same as every read.
        const memberId = await actingMember(tx, context.workspaceId, userId);
        const reader = { workspaceId: context.workspaceId, memberId };

        for (const kind of input.kinds ?? JUMP_KINDS) {
          let id: string;
          try {
            ({ id } = await resolveAddress(tx, reader, kind, code));
          } catch (error) {
            if (error instanceof OperationError && error.code === "not_found") {
              continue;
            }
            throw error;
          }
          const { rows } = await tx.execute<{ title: string }>(
            sql`select ${sql.identifier(TITLE_COLUMN[kind])} as title
                  from ${sql.identifier(SHORT_ID_TABLES[kind])}
                 where workspace_id = ${context.workspaceId}
                   and id = ${id}
                   and deleted_at is null`,
          );
          const title = rows[0]?.title;
          if (title === undefined) {
            continue;
          }
          const hrefs = await hrefsInTx(tx, context.workspaceId, memberId, [
            { entityType: kind, entityId: id },
          ]);
          const href = hrefs.get(`${kind}:${id}`);
          if (href) {
            return { entityType: kind, entityId: id, title, href };
          }
        }
        return null;
      },
    );
  },
});
