/**
 * The one search read (TECHNICAL-PLAN §5, §9, P5-T13).
 *
 * **One function, and every surface asks it.** The search page, the command
 * palette and the agent's `search` tool all answer from here. A second query
 * path would be a second answer about who can see what, which is the thing the
 * access model exists to prevent.
 *
 * **Filtered in SQL, through the same `EXISTS` clause every list read
 * composes.** `search_documents.context_id` is what makes that possible: a
 * query that fetched a hundred rows and discarded ninety would be slow and
 * would still under-return for the narrowest reader. A member who loses a space
 * stops seeing its rows on the next query, with no reindex.
 *
 * **Semantic results are blended when they are available and absent when they
 * are not.** That is P4-T13b's existing degradation rather than a new one: with
 * no provider and no pgvector the answer is Postgres full text, which is a
 * working search rather than a broken one.
 */
import { searchDocuments, withWorkspace } from "@openokr/db";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { accessScopeFilter } from "../access/reads.ts";
import { EmbeddingService } from "../embeddings/service.ts";
import type { OperationTx } from "../operations/operation.ts";

export interface SearchInput {
  readonly workspaceId: string;
  /** Who is asking. Required: a search without a reader cannot be filtered. */
  readonly memberId: string;
  readonly text: string;
  readonly entityTypes?: readonly string[];
  readonly limit?: number;
}

export interface SearchHit {
  readonly entityType: string;
  readonly entityId: string;
  readonly title: string;
  /** The matching words, with the matches marked by `<b>` and `</b>`. */
  readonly snippet: string;
  readonly rank: number;
  /** True when this row came from the semantic index rather than full text. */
  readonly semantic: boolean;
}

const DEFAULT_LIMIT = 20;

/**
 * Everything matching that this member may read, best first.
 *
 * The text is what somebody typed, not query syntax: `websearch_to_tsquery`
 * parses it the way a search box should, so quoted phrases and "or" work, stray
 * operators are just characters, and nothing raises.
 */
export async function searchWorkspace(
  pool: Pool,
  input: SearchInput,
): Promise<SearchHit[]> {
  const terms = input.text.trim();
  if (terms === "") {
    return [];
  }
  const limit = input.limit ?? DEFAULT_LIMIT;

  const hits = await withWorkspace(
    drizzle(pool),
    input.workspaceId,
    async (rawTx) => {
      const tx = rawTx as unknown as OperationTx;
      const scope = accessScopeFilter(searchDocuments.contextId, {
        workspaceId: input.workspaceId,
        memberId: input.memberId,
        minLevel: ACCESS_LEVELS.view,
      });
      /**
       * The type filter, as bound values rather than one array parameter.
       *
       * `($1)::text[]` with a JavaScript array bound to it does not survive the
       * driver: the query fails outright, and on the search page an error
       * boundary turned that into "Something went wrong" with no clue in it.
       * Found by clicking a type tab in a browser. Each value is still a
       * parameter, so nothing here is interpolated.
       */
      const types =
        input.entityTypes && input.entityTypes.length > 0
          ? [...input.entityTypes]
          : null;
      const typeClause = types
        ? sql`and entity_type in (${sql.join(
            types.map((one) => sql`${one}`),
            sql`, `,
          )})`
        : sql``;

      const rows = await tx.execute<{
        entity_type: string;
        entity_id: string;
        title: string;
        snippet: string;
        rank: number;
      }>(sql`
        select entity_type, entity_id, title,
               ts_headline(
                 'english',
                 coalesce(body, title),
                 websearch_to_tsquery('english', ${terms}),
                 'StartSel=<b>,StopSel=</b>,MaxFragments=2,MaxWords=18,MinWords=6'
               ) as snippet,
               ts_rank(document, websearch_to_tsquery('english', ${terms})) as rank
          from search_documents
         where workspace_id = ${input.workspaceId}
           and document @@ websearch_to_tsquery('english', ${terms})
           ${typeClause}
           and ${scope}
         order by rank desc, updated_at desc
         limit ${limit}
      `);

      return rows.rows.map((row) => ({
        entityType: row.entity_type,
        entityId: row.entity_id,
        title: row.title,
        snippet: row.snippet,
        rank: Number(row.rank),
        semantic: false,
      }));
    },
  );

  return hits;
}

/**
 * Full text, with semantic results blended in behind it.
 *
 * **Blended, not merged into one ranking.** The two indexes score on different
 * scales and pretending otherwise would put an arbitrary constant in front of
 * somebody's results. What a reader wants from a search box is the thing they
 * typed the name of, which is what full text answers; the semantic rows follow,
 * marked, and only where they add something full text missed.
 *
 * With no provider or no pgvector this is exactly `searchWorkspace`, which is
 * §2.4's own degradation.
 */
export async function searchWithSemantic(
  pool: Pool,
  input: SearchInput,
  embed: ConstructorParameters<typeof EmbeddingService>[1] = null,
): Promise<SearchHit[]> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const exact = await searchWorkspace(pool, input);
  if (exact.length >= limit || !embed) {
    return exact.slice(0, limit);
  }

  const service = new EmbeddingService(pool, embed);
  if (!(await service.hasPgvector())) {
    return exact;
  }

  const seen = new Set(exact.map((hit) => `${hit.entityType}:${hit.entityId}`));
  const passages = await service.retrieve({
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    query: input.text,
    ...(input.entityTypes ? { entityTypes: input.entityTypes } : {}),
    limit: limit - exact.length,
  });

  const extra = passages
    .filter((hit) => !seen.has(`${hit.entityType}:${hit.entityId}`))
    .map((hit) => ({
      entityType: hit.entityType,
      entityId: hit.entityId,
      title: hit.content.split("\n")[0]?.slice(0, 120) ?? "",
      snippet: hit.content.slice(0, 200),
      rank: hit.score,
      semantic: true,
    }));

  return [...exact, ...extra].slice(0, limit);
}
