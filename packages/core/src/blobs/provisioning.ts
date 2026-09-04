/**
 * Prepare, upload, claim (TECHNICAL-PLAN §4.9, P2-T05).
 *
 * The bytes themselves never pass through here: `prepareBlob` reserves a row
 * and a storage key before anything is written to the storage port, and
 * `claimBlob` finalises that row once the caller has already called
 * `FileStorage.put` with the key this returned. Core stays adapter-agnostic
 * (CLAUDE.md: vendor SDKs and the ports that wrap them live only in
 * `packages/adapters`), so the actual `put`/`delete` calls belong to
 * whichever app route drives an upload, not to this module.
 */

import { randomUUID } from "node:crypto";
import { activeOnly, blobs, type WorkspaceTx } from "@openokr/db";
import { and, eq, lt } from "drizzle-orm";
import {
  bindGroup,
  ensureContext,
  ensureMemberGroup,
} from "../access/contexts.ts";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { bindImporterInTx } from "../imports/binding.ts";
import { checkQuota, usedBytes } from "./quota.ts";
import { validateUpload } from "./validation.ts";

type AnyTx<TSchema extends Record<string, unknown> = Record<string, never>> =
  WorkspaceTx<TSchema>;

const EXTENSION = /\.[A-Za-z0-9]{1,10}$/;

/** A storage key with no relation to the original filename beyond its extension, so a hostile filename cannot walk the path. */
export function generateStorageKey(
  workspaceId: string,
  filename: string,
): string {
  const match = EXTENSION.exec(filename);
  return `${workspaceId}/${randomUUID()}${match ? match[0] : ""}`;
}

export class QuotaExceededError extends Error {
  constructor(usedAfterBytes: number, quotaBytes: number) {
    super(
      `This upload would use ${usedAfterBytes} of ${quotaBytes} bytes ` +
        `allowed. Free up space or raise the workspace quota first.`,
    );
    this.name = "QuotaExceededError";
  }
}

export class ValidationFailedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ValidationFailedError";
  }
}

export interface PrepareBlobInput {
  readonly workspaceId: string;
  readonly memberId: string;
  readonly filename: string;
  readonly contentType: string;
  /** The browser's own report of the file's size. Re-checked at claim. */
  readonly declaredSize: number;
  readonly quotaBytes: number;
  /**
   * The source row this file came from, for an import (P6-T04c).
   *
   * Two files can share a name, a size and even a digest and still be two
   * uploads, so the digest is not an identity: the source's own id is. Its
   * presence is also what says "an import did this", which is what decides
   * whether the actor gets a binding of its own below.
   */
  readonly legacy?: { readonly type: string; readonly id: string };
  /**
   * The member the run acts as, when it is not `memberId`.
   *
   * `memberId` is whoever uploaded the file in the source, and a placeholder
   * cannot sign in, so binding only them leaves a blob nobody can read and an
   * `attachments.attach` that refuses. The same narrow fix `bindImporterInTx`
   * makes everywhere else.
   */
  readonly actingMemberId?: string;
}

export interface PreparedBlob {
  readonly blobId: string;
  readonly storageKey: string;
}

/**
 * Validates and reserves. Throws `ValidationFailedError` or
 * `QuotaExceededError` rather than returning a result the caller might
 * forget to check — a rejected prepare must never look like a normal one.
 */
export async function prepareBlob<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: PrepareBlobInput): Promise<PreparedBlob> {
  const validation = validateUpload({
    contentType: input.contentType,
    size: input.declaredSize,
  });
  if (!validation.ok) {
    throw new ValidationFailedError(validation.reason ?? "Invalid upload.");
  }

  const before = await usedBytes(tx, input.workspaceId);
  const quota = checkQuota({
    usedBeforeBytes: before,
    newFileBytes: input.declaredSize,
    quotaBytes: input.quotaBytes,
  });
  if (quota.overQuota) {
    throw new QuotaExceededError(quota.usedAfterBytes, input.quotaBytes);
  }

  const storageKey = generateStorageKey(input.workspaceId, input.filename);
  // openokr:allow-mutation: this helper is called only from inside an
  // Operation's execute (blobs.prepareUpload), on the transaction that
  // Operation opened.
  const [row] = await tx
    .insert(blobs)
    .values({
      workspaceId: input.workspaceId,
      filename: input.filename,
      contentType: input.contentType,
      storageKey,
      authorMemberId: input.memberId,
      status: "pending",
      ...(input.legacy
        ? { legacyType: input.legacy.type, legacyId: input.legacy.id }
        : {}),
    })
    .returning({ id: blobs.id });
  const blobId = (row as { id: string }).id;

  const contextId = await ensureContext(tx, {
    workspaceId: input.workspaceId,
    resourceType: "blob",
    resourceId: blobId,
  });
  const groupId = await ensureMemberGroup(tx, {
    workspaceId: input.workspaceId,
    memberId: input.memberId,
  });
  await bindGroup(tx, {
    workspaceId: input.workspaceId,
    groupId,
    contextId,
    level: ACCESS_LEVELS.full,
  });

  if (input.legacy) {
    await bindImporterInTx(tx, {
      workspaceId: input.workspaceId,
      memberId: input.actingMemberId,
      contextId,
      alreadyBound: input.memberId,
    });
  }

  return { blobId, storageKey };
}

export interface ClaimBlobInput {
  readonly workspaceId: string;
  readonly blobId: string;
  readonly actualSize: number;
  readonly digest: string;
  readonly quotaBytes: number;
  readonly width?: number;
  readonly height?: number;
  /**
   * Set when a scan hook is configured. No scanner is wired in yet — this is
   * the flag it will set, so the state machine does not have to change
   * shape when one lands. Recorded in STATUS.md as scaffolding, not a
   * built capability.
   */
  readonly requiresScan?: boolean;
}

export interface ClaimedBlob {
  readonly status: "ok" | "scanning";
  readonly warningCrossed: boolean;
  readonly usedAfterBytes: number;
}

export async function claimBlob<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: ClaimBlobInput): Promise<ClaimedBlob> {
  const [pending] = await tx
    .select({ id: blobs.id, contentType: blobs.contentType })
    .from(blobs)
    .where(
      activeOnly(
        blobs,
        eq(blobs.id, input.blobId),
        eq(blobs.workspaceId, input.workspaceId),
        eq(blobs.status, "pending"),
      ),
    )
    .limit(1);
  if (!pending) {
    throw new ValidationFailedError(
      "No pending upload with that id, or it was already claimed.",
    );
  }

  const validation = validateUpload({
    contentType: pending.contentType,
    size: input.actualSize,
  });
  if (!validation.ok) {
    throw new ValidationFailedError(validation.reason ?? "Invalid upload.");
  }

  const before = await usedBytes(tx, input.workspaceId);
  const quota = checkQuota({
    usedBeforeBytes: before,
    newFileBytes: input.actualSize,
    quotaBytes: input.quotaBytes,
  });
  if (quota.overQuota) {
    // The bytes already exist in storage at this point; the caller is
    // responsible for deleting the object at the storage key it holds
    // before or after this throws. Discarding it here would need the
    // storage port, which this module deliberately does not reach.
    throw new QuotaExceededError(quota.usedAfterBytes, input.quotaBytes);
  }

  const status = input.requiresScan ? "scanning" : "ok";
  // openokr:allow-mutation: this helper is called only from inside an
  // Operation's execute (blobs.claimUpload), on the transaction that
  // Operation opened.
  await tx
    .update(blobs)
    .set({
      status,
      filesize: input.actualSize,
      digest: input.digest,
      width: input.width ?? null,
      height: input.height ?? null,
      updatedAt: new Date(),
    })
    .where(activeOnly(blobs, eq(blobs.id, input.blobId)));

  return {
    status,
    warningCrossed: quota.warningCrossed,
    usedAfterBytes: quota.usedAfterBytes,
  };
}

export interface OrphanedBlob {
  readonly id: string;
  readonly storageKey: string;
}

/**
 * Pending rows older than `olderThanMinutes`: a prepare that was never
 * claimed, whether the upload failed, the tab closed, or the browser gave
 * up. Returns the storage key too, since deleting the orphan's bytes is what
 * the caller — a scheduled job wiring this to `FileStorage.delete`, not yet
 * built — actually does with the answer.
 */
export async function findOrphanedBlobs<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  olderThanMinutes: number,
): Promise<OrphanedBlob[]> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
  return tx
    .select({ id: blobs.id, storageKey: blobs.storageKey })
    .from(blobs)
    .where(
      and(
        activeOnly(
          blobs,
          eq(blobs.workspaceId, workspaceId),
          eq(blobs.status, "pending"),
        ),
        lt(blobs.createdAt, cutoff),
      ),
    );
}

/**
 * Soft-deletes an orphan's row. The storage object is the caller's job.
 *
 * Unwired scaffolding, like `findOrphanedBlobs` above: nothing schedules the
 * cleanup job that would call this yet. Whoever wires it must call it from
 * inside an Operation's execute, the same as `prepareBlob` and `claimBlob`,
 * so the removal gets its own activity and audit row.
 */
export async function discardOrphanedBlob<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, workspaceId: string, blobId: string): Promise<void> {
  // openokr:allow-mutation: see the function comment above.
  await tx
    .update(blobs)
    .set({ deletedAt: new Date() })
    .where(
      activeOnly(
        blobs,
        eq(blobs.id, blobId),
        eq(blobs.workspaceId, workspaceId),
      ),
    );
}
