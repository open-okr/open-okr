/**
 * The outbox-driven search indexer (TECHNICAL-PLAN §5, §9, P5-T13).
 *
 * One function, called once per `content.index` outbox row. It reads the
 * entity's current text, resolves the context that decides who may see it, and
 * writes or removes the projection.
 *
 * **Driven only by outbox rows.** Nothing here polls, scans or schedules. A
 * relay drains the outbox and calls this; the same write that enqueues an
 * embedding job enqueues this one, so the two indexes cannot disagree about
 * what exists.
 *
 * **A source row that is gone takes its projection with it.** The index is a
 * projection and not a record: a surviving entry would leak a deleted title
 * into somebody's results, which is what migration 0003's own header says.
 */
import { searchDocuments, withWorkspace } from "@openokr/db";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { OperationTx } from "../operations/operation.ts";
import {
  type IndexableType,
  indexableRowInTx,
  isIndexableType,
} from "./subjects.ts";

/** What a `content.index` outbox row carries. */
export interface IndexJob {
  readonly workspaceId: string;
  readonly entityType: string;
  readonly entityId: string;
}

export type IndexJobOutcome =
  | { readonly kind: "indexed" }
  | { readonly kind: "removed" }
  | { readonly kind: "skipped"; readonly reason: string };

/** Parses an outbox payload, or says why it is not a job this worker runs. */
export function parseIndexJob(payload: unknown): IndexJob | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const { workspaceId, entityType, entityId } = record;
  if (
    typeof workspaceId !== "string" ||
    typeof entityType !== "string" ||
    typeof entityId !== "string"
  ) {
    return null;
  }
  return { workspaceId, entityType, entityId };
}

/**
 * Runs one indexing job.
 *
 * **An unknown entity type is skipped, not thrown.** A row naming a type this
 * build cannot read would otherwise retry until it dead-letters, and a dead
 * letter is an alert about a queue rather than about the product. The reason
 * comes back so the caller can log it once.
 */
export async function runIndexJob(
  job: IndexJob,
  deps: { readonly pool: Pool },
): Promise<IndexJobOutcome> {
  if (!isIndexableType(job.entityType)) {
    return { kind: "skipped", reason: `nothing indexes a ${job.entityType}` };
  }
  const entityType: IndexableType = job.entityType;

  return withWorkspace(drizzle(deps.pool), job.workspaceId, async (rawTx) => {
    const tx = rawTx as unknown as OperationTx;
    const row = await indexableRowInTx(
      tx,
      job.workspaceId,
      entityType,
      job.entityId,
    );

    if (!row) {
      // openokr:allow-mutation: the index is a projection, refreshed by this
      // worker on its own transaction. There is no domain change to audit.
      await tx
        .delete(searchDocuments)
        .where(
          and(
            eq(searchDocuments.workspaceId, job.workspaceId),
            eq(searchDocuments.entityType, entityType),
            eq(searchDocuments.entityId, job.entityId),
          ),
        );
      return { kind: "removed" as const };
    }

    // Upsert on the unique key migration 0003 already declares, so a repeat
    // delivery costs one write rather than a duplicate row.
    // openokr:allow-mutation: a projection refresh, as above.
    await tx.execute(sql`
      insert into search_documents
        (id, workspace_id, entity_type, entity_id, title, body, context_id, updated_at)
      values
        (gen_random_uuid(), ${job.workspaceId}, ${entityType}, ${job.entityId},
         ${row.title}, ${row.body}, ${row.contextId}, now())
      on conflict (workspace_id, entity_type, entity_id) do update
         set title = excluded.title,
             body = excluded.body,
             context_id = excluded.context_id,
             updated_at = now()
    `);
    return { kind: "indexed" as const };
  });
}
