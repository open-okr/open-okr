/**
 * The worker that builds a large export (TECHNICAL-PLAN §4.9, §4.13, P5-T15).
 *
 * **It re-reads the list as the member who asked, and that is the whole design
 * decision.** The request that queued the run has already returned, so the
 * bytes are produced here, later, by a process with no session. Producing them
 * as anybody else, or with the tenant floor alone, would put rows in a file
 * that the person's own access never reached: an export is the one act that
 * takes data out of the product, and the boundary has to be theirs. So the
 * worker builds a caller context for that member's user and calls `gather`,
 * the same read half `exports.list` uses, which reads every list through the
 * action the screen reads it through.
 *
 * **Access is re-evaluated at build time, not at request time.** A member
 * suspended between asking and building gets nothing, and one who lost a space
 * gets a file without it. That is later than the ask and is the safe direction:
 * an export can only narrow while it waits.
 *
 * **Safe to run twice.** The run's state is the ledger. A delivery for a run
 * already `ready` returns without touching it, and one that is `building`
 * rebuilds, because a relay that died mid-build left a run nobody will finish.
 * The storage key is derived from the run's own identifier, so a rebuild
 * overwrites its own file rather than leaving an orphan.
 *
 * **Storage arrives as a function, not as a port.** `packages/core` may not
 * import `packages/adapters`, so the host passes `putFile`, exactly as it
 * already passes `sendMail` and `embed`.
 */
import {
  activeOnly,
  blobs,
  exportRuns,
  newId,
  withWorkspace,
  workspaceMembers,
} from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { callAction } from "../actions/registry.ts";
import type { OperationTx } from "../operations/operation.ts";
import { EXPORTABLE, type Exportable } from "./kinds.ts";
import { gather, render } from "./lists.ts";

/** What the host supplies so a built file can be kept. */
export type PutFile = (input: {
  readonly key: string;
  readonly body: Buffer;
  readonly contentType: string;
}) => Promise<{ readonly key: string; readonly size: number }>;

export interface ExportJob {
  readonly workspaceId: string;
  readonly runId: string;
}

export type ExportJobOutcome =
  | { readonly kind: "built"; readonly rowCount: number }
  | { readonly kind: "already_ready" }
  | { readonly kind: "skipped"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string };

/** Parses an outbox payload, or says it is not a job this worker runs. */
export function parseExportJob(payload: unknown): ExportJob | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const { workspaceId, runId } = record;
  if (typeof workspaceId !== "string" || typeof runId !== "string") {
    return null;
  }
  return { workspaceId, runId };
}

/** The MIME type a browser needs to save the file as what it is. */
const CONTENT_TYPES = {
  csv: "text/csv;charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;

export async function runExportJob(
  job: ExportJob,
  deps: { readonly pool: Pool; readonly putFile: PutFile },
): Promise<ExportJobOutcome> {
  const run = await loadRun(deps.pool, job);
  if (!run) {
    return { kind: "skipped", reason: "no such export run" };
  }
  if (run.state === "ready") {
    return { kind: "already_ready" };
  }
  if (!run.userId) {
    return await fail(
      deps.pool,
      job,
      "The member who asked for this export no longer has an account.",
    );
  }
  if (run.memberStatus !== "active") {
    return await fail(
      deps.pool,
      job,
      "The member who asked for this export is no longer active in this workspace.",
    );
  }

  await setState(deps.pool, job, "building");

  try {
    if (!isExportable(run.list)) {
      return await fail(
        deps.pool,
        job,
        `This build no longer exports "${run.list}".`,
      );
    }

    // **`gather`, not `exports.list`.** The action would audit a second
    // export and, above the limit, queue a second run: it is the thing that
    // asked for this work, so calling it here would ask again. `gather` is the
    // read half, and it reads through the same actions the screen reads, as the
    // member who asked, so the file holds exactly their rows.
    const table = await gather(
      callAction,
      {
        pool: deps.pool,
        workspaceId: job.workspaceId,
        actor: { kind: "human", userId: run.userId },
      },
      {
        list: run.list,
        ...(run.cycleId ? { cycleId: run.cycleId } : {}),
        ...(run.spaceId ? { spaceId: run.spaceId } : {}),
      },
    );

    const rendered = await render(table, run.format);
    const bytes =
      rendered.xlsxBase64 === null
        ? Buffer.from(rendered.csv ?? "", "utf8")
        : Buffer.from(rendered.xlsxBase64, "base64");
    const rowCount = table.rows.length;

    // Keyed on the run, so a rebuild overwrites its own file. The workspace
    // prefix is the storage port's own rule: one workspace's blobs never
    // collide with another's.
    const key = `${job.workspaceId}/exports/${job.runId}/${run.filename}`;
    const stored = await deps.putFile({
      key,
      body: bytes,
      contentType: CONTENT_TYPES[run.format],
    });

    await finish(deps.pool, job, {
      storageKey: stored.key,
      size: stored.size,
      filename: run.filename,
      contentType: CONTENT_TYPES[run.format],
      rowCount,
      requestedById: run.requestedById,
    });
    return { kind: "built", rowCount };
  } catch (error) {
    // The reason is written on the run, where the person who asked will read
    // it. A failure that only reached a log would leave them watching a row
    // that says "being prepared" forever.
    return await fail(
      deps.pool,
      job,
      error instanceof Error ? error.message : "The export could not be built.",
    );
  }
}

interface LoadedRun {
  readonly state: string;
  readonly list: string;
  readonly format: "csv" | "xlsx";
  readonly cycleId: string | null;
  readonly spaceId: string | null;
  readonly filename: string;
  readonly requestedById: string;
  readonly userId: string | null;
  readonly memberStatus: string | null;
}

async function loadRun(pool: Pool, job: ExportJob): Promise<LoadedRun | null> {
  return withWorkspace(drizzle(pool), job.workspaceId, async (rawTx) => {
    const tx = rawTx as unknown as OperationTx;
    const [row] = await tx
      .select({
        state: exportRuns.state,
        list: exportRuns.list,
        format: exportRuns.format,
        cycleId: exportRuns.cycleId,
        spaceId: exportRuns.spaceId,
        filename: exportRuns.filename,
        requestedById: exportRuns.requestedById,
        userId: workspaceMembers.userId,
        memberStatus: workspaceMembers.status,
      })
      .from(exportRuns)
      .leftJoin(
        workspaceMembers,
        eq(workspaceMembers.id, exportRuns.requestedById),
      )
      .where(
        activeOnly(
          exportRuns,
          eq(exportRuns.workspaceId, job.workspaceId),
          eq(exportRuns.id, job.runId),
        ),
      )
      .limit(1);
    return row ?? null;
  });
}

async function setState(
  pool: Pool,
  job: ExportJob,
  state: "building",
): Promise<void> {
  await withWorkspace(drizzle(pool), job.workspaceId, async (rawTx) => {
    const tx = rawTx as unknown as OperationTx;
    // openokr:allow-mutation: the run's own progress, written by the worker
    // that owns it. There is no domain change here to audit; the export itself
    // was audited when it was asked for.
    await tx
      .update(exportRuns)
      .set({ state, updatedAt: new Date() })
      .where(
        activeOnly(
          exportRuns,
          eq(exportRuns.workspaceId, job.workspaceId),
          eq(exportRuns.id, job.runId),
        ),
      );
  });
}

async function fail(
  pool: Pool,
  job: ExportJob,
  reason: string,
): Promise<ExportJobOutcome> {
  await withWorkspace(drizzle(pool), job.workspaceId, async (rawTx) => {
    const tx = rawTx as unknown as OperationTx;
    // openokr:allow-mutation: as above.
    await tx
      .update(exportRuns)
      .set({
        state: "failed",
        error: reason,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        activeOnly(
          exportRuns,
          eq(exportRuns.workspaceId, job.workspaceId),
          eq(exportRuns.id, job.runId),
        ),
      );
  });
  return { kind: "failed", reason };
}

async function finish(
  pool: Pool,
  job: ExportJob,
  file: {
    readonly storageKey: string;
    readonly size: number;
    readonly filename: string;
    readonly contentType: string;
    readonly rowCount: number;
    readonly requestedById: string;
  },
): Promise<void> {
  await withWorkspace(drizzle(pool), job.workspaceId, async (rawTx) => {
    const tx = rawTx as unknown as OperationTx;
    const blobId = newId();
    // openokr:allow-mutation: the blob and the run's completion are one fact
    // written together by the worker that produced the file. The bytes are
    // already in storage; a row pointing at them is what makes them reachable.
    await tx.insert(blobs).values({
      id: blobId,
      workspaceId: job.workspaceId,
      filename: file.filename,
      contentType: file.contentType,
      filesize: file.size,
      storageKey: file.storageKey,
      authorMemberId: file.requestedById,
      status: "ok",
    });
    // openokr:allow-mutation: as above, same transaction.
    await tx
      .update(exportRuns)
      .set({
        state: "ready",
        blobId,
        rowCount: file.rowCount,
        error: null,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        activeOnly(
          exportRuns,
          eq(exportRuns.workspaceId, job.workspaceId),
          eq(exportRuns.id, job.runId),
        ),
      );
  });
}

/** Whether this build still knows how to read that list. */
function isExportable(list: string): list is Exportable {
  return (EXPORTABLE as readonly string[]).includes(list);
}
