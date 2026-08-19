/**
 * Outbox dispatch handler for the embedding pipeline (AI-NATIVE-PLAN.md §9,
 * P4-T13).
 *
 * Every entity write that produces embeddable text inserts an outbox row with
 * topic `embedding.index` or `embedding.remove`. The OutboxRelay in
 * `packages/adapters` drains those rows and calls the handler returned here.
 *
 * Wiring in the consuming layer (apps/web, packages/agents):
 *
 *   const embeddingService = new EmbeddingService(pool, embedFn);
 *   const relay = new OutboxRelay(pool, {
 *     dispatch: createEmbeddingDispatch(pool, embeddingService),
 *   });
 *   relay.start();
 *
 * The handler is idempotent: indexing the same content twice is a no-op
 * because `EmbeddingService.index()` skips unchanged content hashes.
 *
 * Topics:
 *   embedding.index  — chunk and embed an entity. Payload:
 *                      { workspaceId, entityType, entityId }
 *   embedding.remove — delete all chunks for an entity. Payload:
 *                      { workspaceId, entityType, entityId }
 *
 * Unknown topics are silently ignored so this handler can be composed with
 * other dispatch handlers without each one needing to know about the others.
 */
import {
  activeOnly,
  checkIns,
  goals,
  keyResults,
  withWorkspace,
} from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { excerptRichText } from "../rich-text/excerpt.ts";
import type { RichTextDocument } from "../rich-text/schema.ts";
import type { EmbeddingService } from "./service.ts";

/** Minimum shape the OutboxRelay passes to its dispatch function. */
export interface EmbeddingOutboxRecord {
  readonly topic: string;
  readonly payload: Record<string, unknown>;
  readonly idempotencyKey: string;
}

/** Validated payload for both embedding topics. */
interface EmbeddingPayload {
  workspaceId: string;
  entityType: string;
  entityId: string;
}

function parsePayload(
  payload: Record<string, unknown>,
): EmbeddingPayload | null {
  const { workspaceId, entityType, entityId } = payload;
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
 * Extracts plain text from an entity, or null when the entity is not found
 * (soft-deleted or already gone). The caller removes stale embeddings in
 * that case rather than indexing a missing entity.
 */
async function extractText(
  pool: Pool,
  { workspaceId, entityType, entityId }: EmbeddingPayload,
): Promise<string | null> {
  const db = drizzle(pool);

  switch (entityType) {
    case "goal": {
      const [row] = await withWorkspace(db, workspaceId, async (tx) =>
        tx
          .select({ title: goals.title, description: goals.description })
          .from(goals)
          .where(activeOnly(goals, eq(goals.id, entityId)))
          .limit(1),
      );
      if (!row) return null;
      const parts = [row.title];
      if (row.description) {
        parts.push(
          excerptRichText(
            row.description as RichTextDocument,
            Number.MAX_SAFE_INTEGER,
          ),
        );
      }
      return parts.filter(Boolean).join("\n\n");
    }

    case "key_result": {
      const [row] = await withWorkspace(db, workspaceId, async (tx) =>
        tx
          .select({ title: keyResults.title })
          .from(keyResults)
          .where(activeOnly(keyResults, eq(keyResults.id, entityId)))
          .limit(1),
      );
      return row?.title ?? null;
    }

    case "check_in": {
      const [row] = await withWorkspace(db, workspaceId, async (tx) =>
        tx
          .select({ narrative: checkIns.narrative })
          .from(checkIns)
          .where(activeOnly(checkIns, eq(checkIns.id, entityId)))
          .limit(1),
      );
      if (!row) return null;
      if (!row.narrative) return null;
      return excerptRichText(
        row.narrative as RichTextDocument,
        Number.MAX_SAFE_INTEGER,
      );
    }

    default:
      // Entity type not yet supported. Return null so the caller skips
      // rather than errors. As more entity types gain write actions they
      // will be added here.
      return null;
  }
}

/**
 * Returns a dispatch function compatible with `OutboxRelay`'s `dispatch`
 * option. Pass it the same pool the relay uses so text extraction runs as
 * the application role and respects row-level security.
 */
export function createEmbeddingDispatch(
  pool: Pool,
  service: EmbeddingService,
): (record: EmbeddingOutboxRecord) => Promise<void> {
  return async (record) => {
    if (
      record.topic !== "embedding.index" &&
      record.topic !== "embedding.remove"
    ) {
      return;
    }

    const parsed = parsePayload(record.payload);
    if (!parsed) {
      // Malformed payload — skip rather than retry forever. The idempotency
      // key is unique per write, so this row will not be re-delivered.
      return;
    }

    if (record.topic === "embedding.remove") {
      await service.remove(
        parsed.workspaceId,
        parsed.entityType,
        parsed.entityId,
      );
      return;
    }

    // embedding.index: load the entity's plain text first.
    const text = await extractText(pool, parsed);

    if (text === null) {
      // Entity not found — clean up any stale chunks from a previous index.
      await service.remove(
        parsed.workspaceId,
        parsed.entityType,
        parsed.entityId,
      );
      return;
    }

    await service.index({
      workspaceId: parsed.workspaceId,
      entityType: parsed.entityType,
      entityId: parsed.entityId,
      content: text,
    });
  };
}
