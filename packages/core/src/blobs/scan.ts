/**
 * The virus scan hook (REQUIREMENTS §4 Files, P2-T05, completeness review
 * M-24).
 *
 * **Off unless an operator names a scanner.** `scan.clamd.host` is empty by
 * default, and empty means a claimed file is `ok` at once, exactly as before
 * this existed. Postgres stays the only service the product needs.
 *
 * **With one, a file is held until the scan says otherwise.** The claim moves
 * the blob to `scanning` and writes a `blob.scan` outbox row in the same
 * transaction. The relay delivers it: this module reads the bytes back through
 * the storage port, hands them to the scanner, and records the verdict through
 * the Operation pipeline, so a quarantine has an activity row and an audit row
 * like any other change. A `scanning` or `quarantined` file is never served.
 *
 * **Asynchronous, because the scanner is a separate service.** Scanning inside
 * the upload request would make every upload wait on clamd and fail whenever
 * clamd is down. Here a scanner that cannot be reached throws, the relay backs
 * off and tries again, and the file waits: late, never unscanned.
 *
 * **Fail closed.** A file clamd will not scan (over its stream limit, say) and
 * a file whose bytes are gone are both quarantined rather than released,
 * because "could not check" is not "checked". The signature or the reason goes
 * on the audit row, where an administrator can read why.
 */
import {
  activeOnly,
  blobs,
  type OutboxMessage,
  systemSettings,
  withWorkspace,
} from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { OperationError } from "../operations/errors.ts";
import { type OperationTx, runOperation } from "../operations/operation.ts";
import {
  environmentValue,
  getInstanceSetting,
} from "../secrets/instance-registry.ts";
import { readSetting, resolveSetting } from "../secrets/instance-settings.ts";

/** The outbox topic a claim writes when the file must be scanned. */
export const BLOB_SCAN_TOPIC = "blob.scan";

const CLAMD_HOST_KEY = "scan.clamd.host";
const CLAMD_PORT_KEY = "scan.clamd.port";

/** clamd's own default TCP port. */
const DEFAULT_CLAMD_PORT = 3310;

export interface ClamdSettings {
  readonly host: string;
  readonly port: number;
}

/** Reads one stored instance setting, or undefined when none is stored. */
export type ReadStoredSetting = (key: string) => Promise<unknown | undefined>;

type Environment = Record<string, string | undefined>;

function resolved(
  key: string,
  stored: unknown,
  environment: Environment,
): unknown {
  const definition = getInstanceSetting(key);
  if (!definition) {
    throw new Error(`${key} is not declared in the instance registry`);
  }
  return resolveSetting(
    stored,
    environmentValue(definition, environment),
    definition.fallback,
  ).value;
}

/**
 * The scanner this instance is configured with, or null for none.
 *
 * Resolved the way every instance setting is: the stored value, then the
 * environment, then the registry's empty default. A blank host is no scanner,
 * because a Compose file that interpolates an unset variable produces one.
 */
export async function resolveClamdSettings(
  read: ReadStoredSetting,
  environment: Environment = process.env,
): Promise<ClamdSettings | null> {
  const host = resolved(
    CLAMD_HOST_KEY,
    await read(CLAMD_HOST_KEY),
    environment,
  );
  if (typeof host !== "string" || host.trim() === "") {
    return null;
  }
  const port = Number(
    resolved(CLAMD_PORT_KEY, await read(CLAMD_PORT_KEY), environment),
  );
  return {
    host: host.trim(),
    port:
      Number.isInteger(port) && port > 0 && port < 65536
        ? port
        : DEFAULT_CLAMD_PORT,
  };
}

/** The stored settings, read through a pool. What the relay uses. */
export function readSettingsFrom(pool: Pool): ReadStoredSetting {
  return (key) => readSetting(pool, key);
}

/**
 * The stored settings, read inside a transaction the caller already holds.
 *
 * What a claim uses, so deciding whether to scan does not ask the pool for a
 * second connection while the claim is holding its first. `system_settings`
 * is readable by the application role (migration 0007), so no opt-in is
 * needed.
 */
export function readSettingsIn(tx: OperationTx): ReadStoredSetting {
  return async (key) => {
    const [row] = await tx
      .select({ value: systemSettings.value })
      .from(systemSettings)
      .where(eq(systemSettings.key, key))
      .limit(1);
    return row?.value ?? undefined;
  };
}

/** The outbox row that asks the relay to scan one blob. */
export function scanJobFor(workspaceId: string, blobId: string): OutboxMessage {
  return {
    topic: BLOB_SCAN_TOPIC,
    payload: { workspaceId, blobId },
    // A blob is claimed once, pending to scanning, so one row per blob.
    idempotencyKey: `${BLOB_SCAN_TOPIC}:${blobId}`,
  };
}

export interface ScanJob {
  readonly workspaceId: string;
  readonly blobId: string;
}

/** Parses an outbox payload, or says it is not a scan job. */
export function parseScanJob(payload: unknown): ScanJob | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const { workspaceId, blobId } = payload as Record<string, unknown>;
  if (typeof workspaceId !== "string" || typeof blobId !== "string") {
    return null;
  }
  return { workspaceId, blobId };
}

/**
 * A scanner's verdict. The `FileScanner` port's own shape, declared here
 * because `packages/core` does not import `packages/adapters`.
 */
export type ScanOutcome =
  | { readonly verdict: "clean" }
  | { readonly verdict: "found"; readonly signature: string }
  | { readonly verdict: "refused"; readonly reason: string };

/** Scans one file. Throws when the scanner cannot be reached. */
export type ScanFile = (body: Buffer) => Promise<ScanOutcome>;

/** What the relay hands the job. */
export interface ScanJobDeps {
  readonly pool: Pool;
  /** The stored bytes, or null when the object is gone. */
  readonly getFile: (key: string) => Promise<Buffer | null>;
  readonly scanFile: ScanFile;
}

export type ScanJobResult =
  | { readonly kind: "released" }
  | {
      readonly kind: "quarantined";
      readonly verdict: "found" | "refused" | "missing";
    }
  | { readonly kind: "skipped"; readonly reason: string };

type Recorded = ScanOutcome | { readonly verdict: "missing" };

/**
 * Scans one held file and records what the scanner said.
 *
 * **Safe to run twice.** A blob that is no longer `scanning` is left alone, so
 * a redelivered row costs one read. The update is also guarded on the status,
 * so two relays that raced past the first check record one verdict.
 */
export async function runScanJob(
  job: ScanJob,
  deps: ScanJobDeps,
): Promise<ScanJobResult> {
  const [blob] = await withWorkspace(
    drizzle(deps.pool),
    job.workspaceId,
    (tx) =>
      tx
        .select({ status: blobs.status, storageKey: blobs.storageKey })
        .from(blobs)
        .where(
          activeOnly(
            blobs,
            eq(blobs.workspaceId, job.workspaceId),
            eq(blobs.id, job.blobId),
          ),
        )
        .limit(1),
  );
  if (!blob) {
    return { kind: "skipped", reason: "the file no longer exists" };
  }
  if (blob.status !== "scanning") {
    return { kind: "skipped", reason: `the file is already ${blob.status}` };
  }

  const bytes = await deps.getFile(blob.storageKey);
  // The scanner throwing is the one outcome not recorded: it is an outage, and
  // the relay's retry is what answers it.
  const verdict: Recorded =
    bytes === null ? { verdict: "missing" } : await deps.scanFile(bytes);

  try {
    await recordVerdict(deps.pool, job, verdict);
  } catch (error) {
    if (error instanceof OperationError && error.code === "not_found") {
      return {
        kind: "skipped",
        reason: "another delivery recorded this file's verdict first",
      };
    }
    throw error;
  }

  return verdict.verdict === "clean"
    ? { kind: "released" }
    : { kind: "quarantined", verdict: verdict.verdict };
}

/**
 * Writes the verdict, with its activity and audit rows.
 *
 * As the system rather than as the uploader: nobody chose this outcome, and an
 * imported file's uploader is a placeholder who cannot act at all. The same
 * principal the staleness sweep and the usage recorder write as.
 */
async function recordVerdict(
  pool: Pool,
  job: ScanJob,
  verdict: Recorded,
): Promise<void> {
  const status = verdict.verdict === "clean" ? "ok" : "quarantined";
  await runOperation(
    { pool },
    {
      action: "blobs.recordScan",
      workspaceId: job.workspaceId,
      actor: { kind: "system" },
      async execute({ tx, workspaceId }) {
        // openokr:allow-mutation: this is the operation's own execute, on the
        // transaction runOperation opened. Guarded on `scanning` so a verdict
        // is recorded once.
        const updated = await tx
          .update(blobs)
          .set({ status, updatedAt: new Date() })
          .where(
            activeOnly(
              blobs,
              eq(blobs.workspaceId, workspaceId),
              eq(blobs.id, job.blobId),
              eq(blobs.status, "scanning"),
            ),
          )
          .returning({ id: blobs.id });
        if (updated.length === 0) {
          // Rolls the activity and audit rows back with it: nothing changed.
          throw new OperationError(
            "not_found",
            "No file waiting for a scan with that id.",
          );
        }

        return {
          result: undefined,
          activity: {
            kind: "blob.scanned",
            subjectType: "blob",
            subjectId: job.blobId,
            payload: { verdict: verdict.verdict },
          },
          audit: {
            action: "blobs.recordScan",
            targetType: "blob",
            targetId: job.blobId,
            payload: {
              verdict: verdict.verdict,
              status,
              // The scanner's own words, for whoever has to decide what to do
              // with a held file. On the audit row only: the activity feed is
              // read by members and a signature name means nothing to them.
              ...(verdict.verdict === "found"
                ? { signature: verdict.signature }
                : {}),
              ...(verdict.verdict === "refused"
                ? { reason: verdict.reason }
                : {}),
            },
          },
        };
      },
    },
  );
}
