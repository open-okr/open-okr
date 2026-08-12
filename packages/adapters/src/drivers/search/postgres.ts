/**
 * The Postgres full-text search driver (TECHNICAL-PLAN §9).
 *
 * Identical on every deployment target and safe for an air-gapped install:
 * no search service to run. Semantic search adds pgvector alongside this
 * later, and degrades back to full text when embeddings are unavailable.
 *
 * Results are identifiers and a rank. The caller reloads each hit through
 * the access-aware getter, so this index can never widen what someone sees.
 */
import type {
  Search,
  SearchDocument,
  SearchHit,
  SearchQuery,
} from "../../ports/search.ts";

/** The query surface this driver needs: a pg Pool or Client. */
export interface SearchQueryable {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

const DEFAULT_LIMIT = 20;

export class PostgresSearch implements Search {
  readonly #db: SearchQueryable;

  constructor(db: SearchQueryable) {
    this.#db = db;
  }

  async index(document: SearchDocument): Promise<void> {
    await this.#db.query(
      `insert into search_documents (workspace_id, entity_type, entity_id, title, body, updated_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (workspace_id, entity_type, entity_id) do update
          set title = excluded.title,
              body = excluded.body,
              updated_at = now()`,
      [
        document.workspaceId,
        document.entityType,
        document.entityId,
        document.title,
        document.body ?? null,
      ],
    );
  }

  async remove(
    entityType: string,
    entityId: string,
    workspaceId: string,
  ): Promise<void> {
    await this.#db.query(
      `delete from search_documents
        where workspace_id = $1 and entity_type = $2 and entity_id = $3`,
      [workspaceId, entityType, entityId],
    );
  }

  async query(query: SearchQuery): Promise<SearchHit[]> {
    // What a person typed is text, not query syntax. websearch_to_tsquery
    // parses it the way a search box should: quoted phrases and "or" work,
    // stray operators are just characters, and nothing raises.
    const terms = query.text.trim();
    if (terms === "") {
      return [];
    }

    const result = await this.#db.query(
      `select entity_type, entity_id, title,
              ts_rank(document, websearch_to_tsquery('english', $2)) as rank
         from search_documents
        where workspace_id = $1
          and document @@ websearch_to_tsquery('english', $2)
          and ($3::text[] is null or entity_type = any($3::text[]))
        order by rank desc, updated_at desc
        limit $4`,
      [
        query.workspaceId,
        terms,
        query.entityTypes && query.entityTypes.length > 0
          ? [...query.entityTypes]
          : null,
        query.limit ?? DEFAULT_LIMIT,
      ],
    );

    return result.rows.map((row) => ({
      entityType: row.entity_type as string,
      entityId: row.entity_id as string,
      title: row.title as string,
      rank: Number(row.rank),
    }));
  }

  async stop(): Promise<void> {
    // The pool is injected and owned by the host process; nothing of this
    // driver's own to close.
  }
}
