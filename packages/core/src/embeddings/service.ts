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
import { embeddings, newId, withWorkspace } from "@openokr/db";
import { and, eq, gte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { type ChunkOptions, chunkText, contentHash } from "./chunker.ts";

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

export type EmbedFunction = (input: readonly string[]) => Promise<{
  readonly vectors: readonly (readonly number[])[];
  readonly dimensions: number;
  readonly model: string;
}>;

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

    // `withWorkspace` rather than a checked-out client and `set_config`.
    // `set_config(..., true)` is transaction-local, and these statements ran
    // outside any transaction, so the setting was discarded the moment the
    // statement that set it committed. Every query after it therefore ran with
    // no workspace at all, which only went unnoticed while the table's
    // row-level security was not forced.
    await withWorkspace(drizzle(this.#pool), input.workspaceId, async (tx) => {
      for (const chunk of chunks) {
        const hash = contentHash(chunk.content);

        // Check if this chunk already exists with the same hash
        const [existingRow] = await tx
          .select({ id: embeddings.id, contentHash: embeddings.contentHash })
          .from(embeddings)
          .where(
            and(
              eq(embeddings.workspaceId, input.workspaceId),
              eq(embeddings.entityType, input.entityType),
              eq(embeddings.entityId, input.entityId),
              eq(embeddings.chunkIndex, chunk.index),
            ),
          )
          .limit(1);

        if (existingRow?.contentHash === hash) {
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
          // openokr:allow-mutation: an embedding is derived, not a domain
          // change. It carries no audit, activity or outbox row for the same
          // reason a recompute does not: nobody decided it, and a feed entry
          // per chunk would drown the one the author's own edit produced.
          await tx
            .update(embeddings)
            .set({
              content: chunk.content,
              contentHash: hash,
              embedding: embeddingValue,
              model,
              dimensions,
              updatedAt: new Date(),
            })
            .where(eq(embeddings.id, existingRow.id));
        } else {
          // openokr:allow-mutation: derived, as above.
          await tx.insert(embeddings).values({
            id: newId(),
            workspaceId: input.workspaceId,
            entityType: input.entityType,
            entityId: input.entityId,
            chunkIndex: chunk.index,
            content: chunk.content,
            contentHash: hash,
            embedding: embeddingValue,
            model,
            dimensions,
          });
        }
      }

      // Remove stale chunks (entity was re-chunked with fewer chunks). A hard
      // delete, per the marker on the table: a soft-deleted chunk would still
      // sit in the vector index and still come back from a search.
      // openokr:allow-mutation: derived, as above.
      await tx
        .delete(embeddings)
        .where(
          and(
            eq(embeddings.workspaceId, input.workspaceId),
            eq(embeddings.entityType, input.entityType),
            eq(embeddings.entityId, input.entityId),
            gte(embeddings.chunkIndex, chunks.length),
          ),
        );
    });
  }

  /**
   * Remove all embeddings for an entity (on delete).
   */
  async remove(
    workspaceId: string,
    entityType: string,
    entityId: string,
  ): Promise<void> {
    // Through `withWorkspace` as well: this ran on the pool with no workspace
    // set at all, so with the floor forced it would now delete nothing.
    await withWorkspace(drizzle(this.#pool), workspaceId, async (tx) => {
      // openokr:allow-mutation: derived data, cleaned up after its source.
      await tx
        .delete(embeddings)
        .where(
          and(
            eq(embeddings.workspaceId, workspaceId),
            eq(embeddings.entityType, entityType),
            eq(embeddings.entityId, entityId),
          ),
        );
    });
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
