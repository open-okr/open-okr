/**
 * One workspace into one archive (TECHNICAL-PLAN §7.3, P6-T05a).
 *
 * **Read through the tenant floor, not around it.** Every select runs inside
 * `withWorkspace`, so row-level security is what scopes the archive rather
 * than a `where workspace_id = ...` this file could forget on one of 96
 * tables. The `workspaces` row is the exception and is fetched by identifier,
 * because it is the row the archive is about.
 *
 * **A whole-workspace read is not an object-authorisation decision.** §7.3
 * makes this an admin action: the archive is the workspace, not a view of it,
 * so `can()` on each of thirty thousand rows would be both wrong and
 * meaningless. The registry action that calls this holds `full` on the
 * workspace, and the audit row names whoever asked.
 *
 * **Blobs travel as bytes, read through the storage port.** A blob row without
 * its bytes is a broken attachment in the receiving instance, which is worse
 * than an archive that says a file could not be read. A blob whose object is
 * missing is named in the result rather than silently skipped.
 */
import type { WorkspaceTx } from "@openokr/db";
import { sql } from "drizzle-orm";
import {
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
  ArchiveError,
  type ArchiveManifest,
  type ArchiveRecord,
  type WriteArchiveResult,
  writeArchive,
} from "./archive.ts";
import { DEFERRED_COLUMNS, EXPORTED_TABLES } from "./policy.ts";

/**
 * The one thing this needs from the storage port.
 *
 * Declared here rather than imported, because `packages/core` is domain
 * logic and does not depend on `packages/adapters`: the app wires a port in,
 * and a port with one method is a shape rather than a dependency. The real
 * `FileStorage` satisfies it structurally, so the caller passes the driver it
 * already has.
 */
interface BlobBytes {
  get(key: string): Promise<Buffer>;
}

/**
 * A transaction with the tenant setting already applied.
 *
 * **Handed in rather than opened here**, which is the whole reason this reads
 * correctly at all. Row-level security is keyed on a transaction-local
 * setting, so a select outside a transaction reads zero rows from every
 * business table: the first draft fetched the workspace row from a pool and
 * got "no such workspace" for a workspace that was plainly there. Taking the
 * caller's transaction also keeps the archive inside the Operation that
 * records it, rather than opening a second one inside the first.
 */
export interface ExportWorkspaceOptions {
  readonly tx: WorkspaceTx<Record<string, never>>;
  readonly workspaceId: string;
  /** Reads blob bytes. Omit and the archive carries rows only, and says so. */
  readonly storage?: BlobBytes;
  /** Seals the archive. */
  readonly ring: Parameters<typeof writeArchive>[0];
  /** A fingerprint naming the writing instance. Never a secret. */
  readonly instance: string;
}

export interface ExportWorkspaceResult extends WriteArchiveResult {
  readonly manifest: ArchiveManifest;
  /** Blobs whose bytes could not be read, by identifier and filename. */
  readonly missingBlobs: readonly { id: string; filename: string }[];
}

export async function exportWorkspace(
  options: ExportWorkspaceOptions,
): Promise<ExportWorkspaceResult> {
  const tx = options.tx;
  const schemaVersion = await readSchemaVersion(tx);

  {
    // The workspace row is read here and not before the transaction, because
    // there is no before: row-level security is keyed on a transaction-local
    // setting, so a select outside one reads zero rows from every business
    // table. Reading it first returned "no such workspace" for a workspace
    // that was plainly there, which is the tenant floor working exactly as
    // designed and worth a comment rather than a second attempt.
    const workspace = await workspaceRow(tx);
    // Counted first, so the manifest a reader sees before any row says how
    // many are coming. A dry-run difference on the other side reads these.
    const counts: Record<string, number> = {};
    for (const table of EXPORTED_TABLES) {
      if (table === "workspaces") {
        counts[table] = 1;
        continue;
      }
      const result = await tx.execute<{ n: string }>(
        sql`select count(*)::text as n from ${sql.identifier(table)}`,
      );
      counts[table] = Number(result.rows[0]?.n ?? 0);
    }

    const rows: ArchiveRecord[] = [];
    for (const table of EXPORTED_TABLES) {
      if (table === "workspaces") {
        rows.push({ r: "row", t: table, d: workspace });
        continue;
      }
      if (counts[table] === 0) {
        continue;
      }
      // No ordering clause: the rows of one table are unordered as far as an
      // import is concerned, and the policy list's order between tables is
      // what matters. Adding one would be a per-table decision with no reader.
      const result = await tx.execute<Record<string, unknown>>(
        sql`select * from ${sql.identifier(table)}`,
      );
      for (const row of result.rows) {
        rows.push({ r: "row", t: table, d: row });
      }
    }

    const blobRows = rows.filter(
      (record) => record.r === "row" && record.t === "blobs",
    );
    const blobs: ArchiveRecord[] = [];
    const missingBlobs: { id: string; filename: string }[] = [];
    let blobBytes = 0;
    for (const record of blobRows) {
      if (record.r !== "row") {
        continue;
      }
      const id = String(record.d.id);
      const filename = String(record.d.filename ?? "");
      const storageKey = String(record.d.storage_key ?? "");
      const status = String(record.d.status ?? "");
      if (!options.storage || storageKey === "" || status === "pending") {
        // A pending blob has no bytes yet by definition: it is the gap between
        // prepare and claim, and its row travels so the orphan sweep on the
        // other side can collect it.
        continue;
      }
      try {
        const bytes = await options.storage.get(storageKey);
        blobBytes += bytes.byteLength;
        blobs.push({ r: "blob", id, b: bytes.toString("base64") });
      } catch {
        missingBlobs.push({ id, filename });
      }
    }

    const manifest: ArchiveManifest = {
      format: ARCHIVE_FORMAT,
      version: ARCHIVE_VERSION,
      createdAt: new Date().toISOString(),
      schemaVersion,
      instance: options.instance,
      workspace: {
        id: String(workspace.id),
        slug: String(workspace.slug),
        name: String(workspace.name),
      },
      counts,
      blobs: { count: blobs.length, bytes: blobBytes },
      tables: EXPORTED_TABLES,
      deferredColumns: DEFERRED_COLUMNS,
    };

    const records: ArchiveRecord[] = [
      { r: "manifest", manifest },
      ...rows,
      ...blobs,
      { r: "end", rows: rows.length, blobs: blobs.length },
    ];

    const written = writeArchive(options.ring, records);
    return { ...written, manifest, missingBlobs };
  }
}

/**
 * The newest applied migration, which is the schema version in practice.
 *
 * An import compares it to its own and refuses an archive from a newer
 * instance, because a column it does not have is a column it cannot write.
 */
async function readSchemaVersion(
  tx: WorkspaceTx<Record<string, never>>,
): Promise<string> {
  // `_migrations` carries no workspace and no policy, so the tenant setting
  // has nothing to say about it and reading it on this transaction is fine.
  const result = await tx.execute<{ name: string }>(
    sql`select name from _migrations order by name desc limit 1`,
  );
  return result.rows[0]?.name ?? "none";
}

/**
 * The workspace's own row, read inside the transaction so the tenant floor
 * proves it is the one the setting names.
 */
async function workspaceRow(
  tx: WorkspaceTx<Record<string, never>>,
): Promise<Record<string, unknown>> {
  const result = await tx.execute<Record<string, unknown>>(
    sql`select * from workspaces`,
  );
  const [row] = result.rows;
  if (!row) {
    // Unreachable in practice: the row was read before the transaction. If it
    // happens, row-level security disagrees with the identifier, and that is
    // worth saying rather than exporting an archive with no workspace in it.
    throw new ArchiveError(
      "The workspace row is not visible inside its own tenant scope, which means the tenant setting and the identifier disagree.",
    );
  }
  return row;
}
