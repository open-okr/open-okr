/**
 * A FlowyTeam import run as a background job (docs/design/flowyteam-connect.md
 * §2 Q4, card C4).
 *
 * `imports.flowyteamPreview` and `imports.flowyteamRun` record the run row and
 * an outbox row in one transaction. The relay hands the outbox row to the jobs
 * port; the scheduler's worker runs this. The token is unsealed here and
 * nowhere else, and never leaves this function except in the request to
 * FlowyTeam.
 *
 * **A real run longer than the job expiry continues in a follow-up job** from
 * the first domain it had not started. Every domain is idempotent by legacy
 * key, so a domain repeated after an expiry writes nothing twice. A preview
 * is never split: the rows it plans live in this process, so a preview past
 * the expiry is retried from the start.
 */
import {
  activeOnly,
  importConnections,
  importRuns,
  withWorkspace,
} from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { callAction } from "../../actions/registry.ts";
import { decryptSecret, type KeyRing } from "../../secrets/key-ring.ts";
import type { BlobStorage, FetchedSourceFile } from "./files.ts";
import { fetchedFileReader } from "./files.ts";
import type { DomainReconciliation } from "./mappers/reconcile.ts";
import { flowyteamQueryCatalogue } from "./queries.ts";
import type { FlowyteamReport } from "./report.ts";
import { type FlowyteamCarried, runFlowyteamEngine } from "./run.ts";
import type { Source } from "./source.ts";

/** The outbox topic, and the job name the relay enqueues it under. */
export const FLOWYTEAM_IMPORT_TOPIC = "imports.flowyteamImport";

/** The realtime channel the card listens on for one workspace. */
export const flowyteamImportChannel = (workspaceId: string): string =>
  `workspace:${workspaceId}:imports:flowyteam`;

/**
 * How long one job runs domains before handing over to a follow-up: under
 * the jobs port's fifteen-minute expiry, with room for the domain in flight.
 */
const FLOWYTEAM_JOB_BUDGET_MS = 10 * 60 * 1000;

/**
 * Whether anything on this instance consumes background jobs. `off` means no
 * process runs the scheduler, so an import job would wait forever.
 */
export function backgroundJobsRun(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.OPENOKR_SCHEDULER !== "off";
}

export interface FlowyteamImportJob {
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly runId: string;
  /** The member who pressed the button; every write is authorised as them. */
  readonly userId: string;
  readonly write: boolean;
  readonly acceptBroaderVisibility: boolean;
  /** A follow-up job's first domain. */
  readonly startAt?: string;
  readonly carried?: FlowyteamCarried;
}

export function parseFlowyteamImportJob(
  payload: Record<string, unknown>,
): FlowyteamImportJob | null {
  const { workspaceId, connectionId, runId, userId, write } = payload;
  if (
    typeof workspaceId !== "string" ||
    typeof connectionId !== "string" ||
    typeof runId !== "string" ||
    typeof userId !== "string" ||
    typeof write !== "boolean"
  ) {
    return null;
  }
  const carried = payload.carried as FlowyteamCarried | undefined;
  return {
    workspaceId,
    connectionId,
    runId,
    userId,
    write,
    acceptBroaderVisibility: payload.acceptBroaderVisibility === true,
    ...(typeof payload.startAt === "string"
      ? { startAt: payload.startAt }
      : {}),
    ...(carried &&
    Array.isArray(carried.reconciliation) &&
    Array.isArray(carried.notes)
      ? { carried }
      : {}),
  };
}

/** What the host gives the job. Functions, because the drivers live in `packages/adapters`. */
export interface FlowyteamImportJobDeps {
  readonly pool: Pool;
  readonly ring: KeyRing;
  /** Opens the HTTP source: `createHttpFlowyteamSource`. */
  readonly openSource: (input: {
    readonly baseUrl: string;
    readonly accessToken: string;
    readonly version: string;
    readonly label: string;
  }) => Source;
  /** Fetches one task file: `createHttpFlowyteamFiles`. Absent, files are reported by name. */
  readonly fileFetcher?: (input: {
    readonly baseUrl: string;
    readonly accessToken: string;
  }) => (taskFileId: number) => Promise<FetchedSourceFile>;
  readonly storage?: BlobStorage;
  readonly publish?: (
    channel: string,
    event: string,
    data: Record<string, unknown>,
  ) => Promise<void>;
  /** Queues the next part of a real run. Absent, a real run is not split. */
  readonly enqueueFollowUp?: (job: FlowyteamImportJob) => Promise<void>;
  readonly budgetMs?: number;
  readonly now?: () => number;
}

export type FlowyteamImportJobOutcome =
  | { readonly kind: "completed"; readonly report: FlowyteamReport }
  | { readonly kind: "continued"; readonly next: string }
  | {
      readonly kind: "failed";
      readonly reason: string;
      readonly failure: string;
    }
  | { readonly kind: "skipped"; readonly reason: string };

/** A failure the export source typed: `version_mismatch`, `unauthorised` and so on. */
function failureOf(error: unknown): string {
  const failure = (error as { failure?: unknown } | null)?.failure;
  return typeof failure === "string" ? failure : "error";
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message.slice(0, 2000)
    : "The import failed.";
}

export async function runFlowyteamImportJob(
  job: FlowyteamImportJob,
  deps: FlowyteamImportJobDeps,
): Promise<FlowyteamImportJobOutcome> {
  const db = drizzle(deps.pool);
  const now = deps.now ?? Date.now;
  const started = now();

  const [run] = await withWorkspace(db, job.workspaceId, (tx) =>
    tx
      .select({ status: importRuns.status })
      .from(importRuns)
      .where(
        activeOnly(
          importRuns,
          eq(importRuns.workspaceId, job.workspaceId),
          eq(importRuns.id, job.runId),
        ),
      )
      .limit(1),
  );
  if (run?.status !== "running") {
    // Delivered again after it closed: nothing left to do.
    return { kind: "skipped", reason: "the run is no longer running" };
  }

  const context = {
    pool: deps.pool,
    workspaceId: job.workspaceId,
    actor: { kind: "human" as const, userId: job.userId },
    bulk: true,
  };
  const publish = async (event: string, data: Record<string, unknown>) => {
    await deps
      .publish?.(flowyteamImportChannel(job.workspaceId), event, {
        runId: job.runId,
        ...data,
      })
      .catch(() => undefined);
  };
  const fail = async (
    failure: string,
    reason: string,
  ): Promise<FlowyteamImportJobOutcome> => {
    await callAction(context, "imports.finishRun", {
      id: job.runId,
      status: "failed",
      rowsRead: 0,
      rowsWritten: 0,
      rowsSkipped: 0,
      report: { source: "flowyteam", via: "export", failure },
      error: reason,
    });
    await publish("imports.flowyteam.finished", { status: "failed", failure });
    return { kind: "failed", failure, reason };
  };

  const [connection] = await withWorkspace(db, job.workspaceId, (tx) =>
    tx
      .select()
      .from(importConnections)
      .where(
        activeOnly(
          importConnections,
          eq(importConnections.id, job.connectionId),
        ),
      )
      .limit(1),
  );
  if (
    !connection ||
    connection.deletedAt ||
    connection.revokedAt ||
    !connection.tokenCiphertext ||
    !connection.tokenDataKey ||
    !connection.tokenKeyId
  ) {
    return fail(
      "unauthorised",
      "The FlowyTeam connection was disconnected or revoked before the import ran. Connect again from the import page.",
    );
  }

  const accessToken = decryptSecret(deps.ring, {
    ciphertext: connection.tokenCiphertext,
    dataKey: connection.tokenDataKey,
    keyId: connection.tokenKeyId,
  });
  const source = deps.openSource({
    baseUrl: connection.baseUrl,
    accessToken,
    version: flowyteamQueryCatalogue().version,
    label: connection.companyName,
  });
  const fetchFile = deps.fileFetcher?.({
    baseUrl: connection.baseUrl,
    accessToken,
  });

  let answered = false;
  try {
    const result = await runFlowyteamEngine({
      pool: deps.pool,
      workspaceId: job.workspaceId,
      userId: job.userId,
      companyId: Number(connection.companyId),
      source,
      write: job.write,
      acceptBroaderVisibility: job.acceptBroaderVisibility,
      runId: job.runId,
      via: "export",
      ...(deps.storage ? { storage: deps.storage } : {}),
      ...(fetchFile ? { files: fetchedFileReader(fetchFile) } : {}),
      ...(job.startAt ? { startAt: job.startAt } : {}),
      ...(job.carried ? { carried: job.carried } : {}),
      ...(job.write && deps.enqueueFollowUp
        ? { deadline: started + (deps.budgetMs ?? FLOWYTEAM_JOB_BUDGET_MS) }
        : {}),
      now,
      onDomain(domain, index, total) {
        answered = true;
        void publish("imports.flowyteam.progress", { domain, index, total });
      },
    });
    answered = true;
    if (result.paused && deps.enqueueFollowUp) {
      await deps.enqueueFollowUp({
        ...job,
        startAt: result.paused.next,
        carried: {
          reconciliation: result.paused
            .reconciliation as DomainReconciliation[],
          notes: result.paused.notes,
        },
      });
      return { kind: "continued", next: result.paused.next };
    }
    await publish("imports.flowyteam.finished", {
      status: "completed",
      written: result.report.written,
    });
    return { kind: "completed", report: result.report };
  } catch (error) {
    const failure = failureOf(error);
    if (failure === "unauthorised") {
      // FlowyTeam refused the token: the card offers Connect again.
      // openokr:allow-mutation: delivery-side bookkeeping on the connection,
      // like the relay clearing a revoked token. The failed run row carries
      // the audit of what happened.
      await withWorkspace(db, job.workspaceId, (tx) =>
        tx
          .update(importConnections)
          .set({ revokedAt: new Date(), updatedAt: new Date() })
          .where(
            activeOnly(
              importConnections,
              eq(importConnections.id, job.connectionId),
            ),
          ),
      );
    } else if (failure !== "unreachable") {
      answered = true;
    }
    return await fail(failure, messageOf(error));
  } finally {
    await source.close().catch(() => undefined);
    if (answered) {
      // openokr:allow-mutation: when FlowyTeam last answered this
      // connection, for the card. Not a domain write.
      await withWorkspace(db, job.workspaceId, (tx) =>
        tx
          .update(importConnections)
          .set({ lastReadAt: new Date() })
          .where(
            activeOnly(
              importConnections,
              eq(importConnections.id, job.connectionId),
            ),
          ),
      );
    }
  }
}

/**
 * The KPIs a preview said may become more visible: the flags the KPI shares
 * domain raises, one per KPI. A run is refused without the admin's tick while
 * the latest preview names any (§5, AC 4).
 */
export function restrictedKpisIn(report: Record<string, unknown>): number {
  const reconciliation = report.reconciliation;
  if (!Array.isArray(reconciliation)) {
    return 0;
  }
  let count = 0;
  for (const domain of reconciliation as DomainReconciliation[]) {
    for (const flag of domain.flags ?? []) {
      if (
        flag.source.startsWith("indicators:") &&
        flag.reason.startsWith("May become more visible")
      ) {
        count += 1;
      }
    }
  }
  return count;
}
