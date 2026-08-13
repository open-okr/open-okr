/**
 * The embedding and retrieval service (AI-NATIVE-PLAN.md §9, P4-T13).
 *
 * Chunks content, embeds it through the AI provider, stores vectors in the
 * embeddings table, and retrieves with access-filtered hybrid ranking.
 *
 * Degrades to full-text search (through the Search port) when:
 * - pgvector is not installed
 * - No AI provider is configured
 * - The provider has no embedding capability
 *
 * Retrieval never returns a chunk the requester cannot read. Access filtering
 * runs through the same layer as normal reads: the caller reloads each hit
 * through the access-aware getter.
 */
import type { Pool } from "pg";
import { chunkText, contentHash, type ChunkOptions } from "./chunker.ts";

export interface EmbedContentInput {
  readonly workspaceId: string;
  readonly entityType: string;
  readonly entityId: string;
  /** Plain text, already extracted from rich text by the caller. */
  readonly content: string;
}

export interface RetrievalInput {
  readonly workspaceId: string;
  readonly query: string;
  readonly entityTypes?: readonly string[];
  readonly limit?: number;
}

export interface RetrievalHit {
  readonly entityType: string;
  readonly entityId: string;
  readonly content: string;
  readonly score: number;
}

export interface EmbedFunction {
  (input: readonly string[]): Promise<{
    readonly vectors: readonly (readonly number[])[];
    readonly dimensions: number;
    readonly model: string;
  }>;
}

const DEFAULT_RETRIEVAL_LIMIT = 10;

export class EmbeddingService {
  readonly #pool: Pool;
  readonly #embed: EmbedFunction | null;
  readonly #chunkOptions: ChunkOptions;
  #pgvectorAvailable: boolean | null = null;

  constructor(
    pool: Pool,
    embed: EmbedFunction | null,
    chunkOptions?: ChunkOptions,
  ) {
    this.#pool = pool;
    this.#embed = embed;
    this.#chunkOptions = chunkOptions ?? {};
  }

  /**
   * Check once whether pgvector is installed. Cached for the lifetime of
   * this service instance.
   */
  async hasPgvector(): Promise<boolean> {
    if (this.#pgvectorAvailable !== null) {
      return this.#pgvectorAvailable;
    }
    try {
      const result = await this.#pool.query(
        "select 1 from pg_extension where extname = 'vector'",
      );
      this.#pgvectorAvailable = (result.rowCount ?? 0) > 0;
    } catch {
      this.#pgvectorAvailable = false;
    }
    return this.#pgvectorAvailable;
  }

  /**
   * Chunk, embed and store content for an entity. Skips re-embedding when
   * the content hash has not changed.
   */
  async index(input: EmbedContentInput): Promise<void> {
    const chunks = chunkText(input.content, this.#chunkOptions);
    if (chunks.length === 0) {
      return;
    }

    const client = await this.#pool.connect();
    try {
      await client.query(
        "select set_config('app.workspace_id', $1, true)",
        [input.workspaceId],
      );

      for (const chunk of chunks) {
        const hash = contentHash(chunk.content);

        // Check if this chunk already exists with the same hash
        const existing = await client.query(
          `select id, content_hash from embeddings
           where workspace_id = $1
             and entity_type = $2
             and entity_id = $3
             and chunk_index = $4`,
          [input.workspaceId, input.entityType, input.entityId, chunk.index],
        );

        const existingRow = existing.rows[0] as
          | { id: string; content_hash: string }
          | undefined;

        if (existingRow?.content_hash === hash) {
          // Content unchanged, skip
          continue;
        }

        // Embed if we have a provider and pgvector
        let embeddingValue: string | null = null;
        let model: string | null = null;
        let dimensions: number | null = null;

        if (this.#embed && (await this.hasPgvector())) {
          const result = await this.#embed([chunk.content]);
          const vector = result.vectors[0];
          if (vector) {
            embeddingValue = `[${vector.join(",")}]`;
            model = result.model;
            dimensions = result.dimensions;
          }
        }

        if (existingRow) {
          await client.query(
            `update embeddings
             set content = $1,
                 content_hash = $2,
                 embedding = $3,
                 model = $4,
                 dimensions = $5,
                 updated_at = now()
             where id = $6`,
            [
              chunk.content,
              hash,
              embeddingValue,
              model,
              dimensions,
              existingRow.id,
            ],
          );
        } else {
          await client.query(
            `insert into embeddings
             (id, workspace_id, entity_type, entity_id, chunk_index, content, content_hash, embedding, model, dimensions)
             values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              input.workspaceId,
              input.entityType,
              input.entityId,
              chunk.index,
              chunk.content,
              hash,
              embeddingValue,
              model,
              dimensions,
            ],
          );
        }
      }

      // Remove stale chunks (entity was re-chunked with fewer chunks)
      await client.query(
        `delete from embeddings
         where workspace_id = $1
           and entity_type = $2
           and entity_id = $3
           and chunk_index >= $4`,
        [input.workspaceId, input.entityType, input.entityId, chunks.length],
      );
    } finally {
      client.release();
    }
  }

  /**
   * Remove all embeddings for an entity (on delete).
   */
  async remove(
    workspaceId: string,
    entityType: string,
    entityId: string,
  ): Promise<void> {
    await this.#pool.query(
      `delete from embeddings
       where workspace_id = $1
         and entity_type = $2
         and entity_id = $3`,
      [workspaceId, entityType, entityId],
    );
  }

  /**
   * Hybrid retrieval: vector similarity when available, full-text fallback.
   *
   * Results are entity identifiers with a score. The caller reloads each
   * through the access-aware getter, so retrieval never widens what someone
   * can see.
   */
  async retrieve(input: RetrievalInput): Promise<RetrievalHit[]> {
    const limit = input.limit ?? DEFAULT_RETRIEVAL_LIMIT;
    const useVector = this.#embed && (await this.hasPgvector());

    if (useVector) {
      return this.#vectorRetrieve(input, limit);
    }
    return this.#fullTextRetrieve(input, limit);
  }

  async #vectorRetrieve(
    input: RetrievalInput,
    limit: number,
  ): Promise<RetrievalHit[]> {
    // Embed the query
    const embedResult = await this.#embed!([input.query]);
    const queryVector = embedResult.vectors[0];
    if (!queryVector) {
      return this.#fullTextRetrieve(input, limit);
    }

    const vectorStr = `[${queryVector.join(",")}]`;
    const typeFilter =
      input.entityTypes && input.entityTypes.length > 0
        ? `and entity_type = any($3)`
        : "";
    const params: unknown[] = [input.workspaceId, vectorStr];
    if (input.entityTypes && input.entityTypes.length > 0) {
      params.push(input.entityTypes);
    }

    // Hybrid: combine vector cosine similarity with full-text rank
    const result = await this.#pool.query(
      `with vector_hits as (
         select entity_type, entity_id, content,
                1 - (embedding <=> $2::vector) as vector_score
         from embeddings
         where workspace_id = $1
           ${typeFilter}
           and embedding is not null
         order by embedding <=> $2::vector
         limit ${limit * 2}
       ),
       text_hits as (
         select entity_type, entity_id, content,
                ts_rank(to_tsvector('english', content),
                        plainto_tsquery('english', $${params.length + 1})) as text_score
         from embeddings
         where workspace_id = $1
           ${typeFilter}
           and to_tsvector('english', content) @@ plainto_tsquery('english', $${params.length + 1})
         limit ${limit * 2}
       )
       select
         coalesce(v.entity_type, t.entity_type) as entity_type,
         coalesce(v.entity_id, t.entity_id) as entity_id,
         coalesce(v.content, t.content) as content,
         coalesce(v.vector_score, 0) * 0.7 + coalesce(t.text_score, 0) * 0.3 as score
       from vector_hits v
       full outer join text_hits t
         on v.entity_type = t.entity_type
         and v.entity_id = t.entity_id
         and v.content = t.content
       order by score desc
       limit ${limit}`,
      [...params, input.query],
    );

    return result.rows.map((row) => ({
      entityType: row.entity_type as string,
      entityId: row.entity_id as string,
      content: row.content as string,
      score: Number(row.score),
    }));
  }

  async #fullTextRetrieve(
    input: RetrievalInput,
    limit: number,
  ): Promise<RetrievalHit[]> {
    const typeFilter =
      input.entityTypes && input.entityTypes.length > 0
        ? "and entity_type = any($3)"
        : "";
    const params: unknown[] = [input.workspaceId, input.query];
    if (input.entityTypes && input.entityTypes.length > 0) {
      params.push(input.entityTypes);
    }

    const result = await this.#pool.query(
      `select entity_type, entity_id, content,
              ts_rank(to_tsvector('english', content),
                      plainto_tsquery('english', $2)) as score
       from embeddings
       where workspace_id = $1
         ${typeFilter}
         and to_tsvector('english', content) @@ plainto_tsquery('english', $2)
       order by score desc
       limit ${limit}`,
      params,
    );

    return result.rows.map((row) => ({
      entityType: row.entity_type as string,
      entityId: row.entity_id as string,
      content: row.content as string,
      score: Number(row.score),
    }));
  }
}
