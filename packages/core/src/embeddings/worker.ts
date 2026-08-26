/**
 * The outbox-driven embedding worker (AI-NATIVE-PLAN.md §9, P4-T13a).
 *
 * One function, called once per `content.embed` outbox row. It reads the entity's
 * current text, chunks it and embeds the chunks whose content hash changed.
 *
 * **Driven only by outbox rows, which is a test-plan line and not a preference.**
 * Nothing here polls, scans or schedules. A relay drains the outbox and calls
 * this; until a relay host exists the rows accumulate and nothing is embedded,
 * the same honest position `session.stageChanged` has carried since P4-T10a-a.
 * A test calls it directly, which is what the acceptance criterion needs.
 *
 * **The text is read here, not carried on the row.** A row written three edits
 * ago would otherwise embed text the product no longer holds. The row names what
 * changed; this asks what it currently says.
 *
 * **An unknown entity type is dropped, not thrown.** A row naming a type this
 * build cannot read would otherwise retry until it dead-letters, and a dead
 * letter is an alert about a queue rather than about the product. The reason
 * comes back so the caller can log it once.
 */

import { withWorkspace } from "@openokr/db";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { OperationTx } from "../operations/operation.ts";
import type { EmbedFunction } from "./service.ts";
import { EmbeddingService } from "./service.ts";
import {
  type EmbeddableType,
  embeddableTextInTx,
  isEmbeddableType,
} from "./subjects.ts";

/** What a `content.embed` outbox row carries. */
export interface EmbedJob {
  readonly workspaceId: string;
  readonly entityType: string;
  readonly entityId: string;
}

export type EmbedJobOutcome =
  | { readonly kind: "embedded" }
  | { readonly kind: "skipped"; readonly reason: string };

/** Parses an outbox payload, or says why it is not a job this worker runs. */
export function parseEmbedJob(payload: unknown): EmbedJob | null {
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

export async function runEmbedJob(
  job: EmbedJob,
  deps: {
    readonly pool: Pool;
    readonly embed: EmbedFunction;
  },
): Promise<EmbedJobOutcome> {
  if (!isEmbeddableType(job.entityType)) {
    return {
      kind: "skipped",
      reason: `nothing embeds a ${job.entityType}`,
    };
  }
  const entityType: EmbeddableType = job.entityType;

  // Read inside the tenant setting, like every other read: the worker holds no
  // ambient authority and row-level security is the floor here too.
  const content = await withWorkspace(
    drizzle(deps.pool),
    job.workspaceId,
    async (rawTx) =>
      embeddableTextInTx(
        rawTx as unknown as OperationTx,
        job.workspaceId,
        entityType,
        job.entityId,
      ),
  );

  if (content === null) {
    // Deleted, unpublished, or an entity whose only text was removed. All three
    // are ordinary and none is an error: a row for something with nothing to say
    // is a row that has done its job.
    return { kind: "skipped", reason: "no text to embed" };
  }

  const service = new EmbeddingService(deps.pool, deps.embed);
  await service.index({
    workspaceId: job.workspaceId,
    entityType,
    entityId: job.entityId,
    content,
  });
  return { kind: "embedded" };
}
