/**
 * Queues one piece of content for both indexes, inside the caller's
 * transaction (AI-NATIVE-PLAN.md §9, P4-T13a; TECHNICAL-PLAN §9, P5-T13).
 *
 * **For writes that create several things at once.** The pipeline queues what
 * an activity names, and one activity names one thing. The carry of kept
 * objectives creates a draft and its key results for every objective kept, and
 * a KPI's recovery creates an objective and its key results, so neither can be
 * said in one `activity.embed`. The function that creates the rows queues each
 * one here instead, the way an archive import already does, so no caller of it
 * has to remember.
 *
 * Every other write still goes through the pipeline. Queueing here as well
 * would only add jobs the workers skip: they re-read the text and an unchanged
 * hash writes nothing.
 */
import { randomUUID } from "node:crypto";
import { enqueueOutbox } from "@openokr/db";
import { EMBED_TOPIC, isEmbeddableType } from "../embeddings/subjects.ts";
import { INDEX_TOPIC, isIndexableType } from "../search/subjects.ts";
import type { OperationTx } from "./operation.ts";

export async function queueContentInTx(
  tx: OperationTx,
  workspaceId: string,
  entityType: string,
  entityId: string,
): Promise<void> {
  const payload = { workspaceId, entityType, entityId };
  // The same key shape as the pipeline's: a timestamp and a fresh identifier,
  // so a second write arriving while the relay holds the first never collides.
  if (isEmbeddableType(entityType)) {
    await enqueueOutbox(tx, {
      topic: EMBED_TOPIC,
      payload,
      idempotencyKey: `${EMBED_TOPIC}:${entityType}:${entityId}:${Date.now()}:${randomUUID()}`,
    });
  }
  if (isIndexableType(entityType)) {
    await enqueueOutbox(tx, {
      topic: INDEX_TOPIC,
      payload,
      idempotencyKey: `${INDEX_TOPIC}:${entityType}:${entityId}:${Date.now()}:${randomUUID()}`,
    });
  }
}
