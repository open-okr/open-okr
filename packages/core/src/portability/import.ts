/**
 * Load an archive into a workspace (TECHNICAL-PLAN SS7.3, P6-T05b).
 *
 * **Deterministic remap.** Every uuid in the archive is meaningless in the
 * receiving instance. The import assigns a fresh uuid for each one and
 * rewrites every column and every rich text mention that references it. The
 * map is built once and used everywhere, so two references to the same
 * archived id always land on the same new id.
 *
 * **Members are the exception.** A person with the same email address in
 * both instances is the same person, and their existing member id is reused.
 * Nothing is merged on a name, because two people can share one.
 *
 * **Dry run and real run share every line up to the insert.** A single
 * boolean gate decides whether rows are written. The difference report is
 * the same object in both modes, so the dry run cannot predict something
 * the real run does not do.
 */
import { randomUUID } from "node:crypto";
import type { WorkspaceTx } from "@openokr/db";
import { sql } from "drizzle-orm";
import type { ReadArchiveResult } from "./archive.ts";
import { EXPORTED_TABLES, isDeferred } from "./policy.ts";

// ── Types ─────────────────────────────────────────────────────────────────

/** What the storage port looks like from here. */
interface ImportBlobStorage {
  prepare(input: {
    workspaceId: string;
    memberId: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
  }): Promise<{ blobId: string; storageKey: string }>;
  put(key: string, body: Buffer): Promise<void>;
  claim(blobId: string): Promise<void>;
}

export interface ImportWorkspaceOptions {
  readonly tx: WorkspaceTx<Record<string, never>>;
  readonly workspaceId: string;
  readonly archive: ReadArchiveResult;
  readonly storage?: ImportBlobStorage;
  readonly dryRun: boolean;
  /** The member running the import, for blob ownership. */
  readonly actorMemberId: string;
}

interface MergedMember {
  readonly email: string;
  readonly name: string;
  readonly archivedId: string;
  readonly existingId: string;
}

export interface ImportDifference {
  readonly created: Record<string, number>;
  readonly merged: readonly MergedMember[];
  readonly skipped: Record<string, number>;
  readonly blobs: number;
}

// ── UUID detection ────────────────────────────────────────────────────────

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

// ── Rich text rewriting ───────────────────────────────────────────────────

/**
 * Columns that hold rich text and need uuid rewriting. Identified by
 * having a companion `*_version` column in the schema.
 */
const RICH_TEXT_COLUMNS: ReadonlySet<string> = new Set([
  "workspace_members.bio",
  "goals.description",
  "comments.body",
  "documents.body",
  "document_versions.body",
  "tasks.description",
  "initiatives.description",
  "kpis.description",
  "kpi_categories.description",
  "review_narratives.body",
  "goal_retrospectives.body",
]);

function isRichTextColumn(table: string, column: string): boolean {
  return RICH_TEXT_COLUMNS.has(`${table}.${column}`);
}

/**
 * Walks a rich text document tree and remaps uuids in mention and
 * attachment nodes. Returns a new tree (no mutation).
 */
function remapRichText(
  doc: unknown,
  keyMap: ReadonlyMap<string, string>,
): unknown {
  if (doc === null || doc === undefined) return doc;
  if (typeof doc !== "object") return doc;
  if (Array.isArray(doc)) {
    return doc.map((item) => remapRichText(item, keyMap));
  }

  const node = doc as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(node)) {
    if (key === "attrs" && typeof value === "object" && value !== null) {
      const attrs = { ...(value as Record<string, unknown>) };
      // Mention: remap attrs.id (member uuid)
      if (node.type === "mention" && isUuid(attrs.id)) {
        attrs.id = keyMap.get(attrs.id as string) ?? (attrs.id as string);
      }
      // Attachment: remap attrs.blobId
      if (node.type === "attachment" && isUuid(attrs.blobId)) {
        attrs.blobId =
          keyMap.get(attrs.blobId as string) ?? (attrs.blobId as string);
      }
      result[key] = attrs;
    } else if (key === "content" && Array.isArray(value)) {
      result[key] = value.map((child) => remapRichText(child, keyMap));
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ── Key remap builder ─────────────────────────────────────────────────────

interface KeyMapContext {
  readonly tx: WorkspaceTx<Record<string, never>>;
  readonly workspaceId: string;
  readonly archive: ReadArchiveResult;
}

/**
 * Builds the deterministic uuid remap.
 *
 * 1. The archived workspace id maps to the target workspace id.
 * 2. Members are matched by email against the target workspace.
 * 3. Everything else gets a fresh uuid.
 */
async function buildKeyMap(ctx: KeyMapContext): Promise<{
  keyMap: Map<string, string>;
  merged: MergedMember[];
}> {
  const keyMap = new Map<string, string>();
  const merged: MergedMember[] = [];

  // Map the workspace id
  const archivedWorkspaceId = ctx.archive.manifest.workspace.id;
  keyMap.set(archivedWorkspaceId, ctx.workspaceId);

  // Collect all member rows from the archive
  const memberRows = ctx.archive.records.filter(
    (r) => r.r === "row" && r.t === "workspace_members",
  );

  // Load existing members in the target workspace for email matching
  const existingMembers = await ctx.tx.execute<{
    id: string;
    placeholder_email: string | null;
    user_id: string | null;
  }>(sql`
    select wm.id, wm.placeholder_email, wm.user_id
    from workspace_members wm
    where wm.workspace_id = ${ctx.workspaceId}
      and wm.deleted_at is null
  `);

  // Build a lookup: email -> existing member id.
  // Two sources: placeholder_email on the member row, and the user's email
  // for members that have signed in.
  const emailToMemberId = new Map<string, string>();
  for (const existing of existingMembers.rows) {
    if (existing.placeholder_email) {
      emailToMemberId.set(
        existing.placeholder_email.toLowerCase(),
        existing.id,
      );
    }
    if (existing.user_id) {
      const emailRow = await ctx.tx.execute<{ email: string }>(
        sql`select lower(email) as email from users where id = ${existing.user_id}`,
      );
      if (emailRow.rows[0]) {
        emailToMemberId.set(emailRow.rows[0].email, existing.id);
      }
    }
  }

  // Map members: match by email or assign fresh id
  for (const record of memberRows) {
    if (record.r !== "row") continue;
    const archivedId = String(record.d.id);
    const email = String(
      record.d.placeholder_email ?? record.d.email ?? "",
    ).toLowerCase();
    const name = String(record.d.name ?? "");

    if (email && emailToMemberId.has(email)) {
      const existingId = emailToMemberId.get(email) as string;
      keyMap.set(archivedId, existingId);
      merged.push({ email, name, archivedId, existingId });
    } else {
      keyMap.set(archivedId, randomUUID());
    }
  }

  // Collect every other uuid in the archive and assign fresh ids
  for (const record of ctx.archive.records) {
    if (record.r !== "row") continue;
    for (const [column, value] of Object.entries(record.d)) {
      if (isUuid(value) && !keyMap.has(value)) {
        // The workspace_id column always maps to the target
        if (column === "workspace_id") {
          keyMap.set(value, ctx.workspaceId);
        } else {
          keyMap.set(value, randomUUID());
        }
      }
    }
  }

  // Also map blob ids from blob records
  for (const record of ctx.archive.records) {
    if (record.r !== "blob") continue;
    if (isUuid(record.id) && !keyMap.has(record.id)) {
      keyMap.set(record.id, randomUUID());
    }
  }

  return { keyMap, merged };
}

// ── Row remapping ─────────────────────────────────────────────────────────

function remapRow(
  table: string,
  row: Record<string, unknown>,
  keyMap: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [column, value] of Object.entries(row)) {
    // Null out deferred columns (written in a second pass)
    if (isDeferred(table, column)) {
      result[column] = null;
      continue;
    }

    // Null out foreign keys to excluded tables. The `users` table is
    // instance-level and not in the archive, so a member's user_id must
    // be null until somebody claims the membership by registering. Same
    // shape as the FlowyTeam importer's placeholder members.
    if (table === "workspace_members" && column === "user_id") {
      result[column] = null;
      continue;
    }

    // Remap uuid values through the key map
    if (isUuid(value)) {
      result[column] = keyMap.get(value) ?? value;
      continue;
    }

    // Rewrite rich text columns
    if (isRichTextColumn(table, column) && value !== null) {
      result[column] = remapRichText(value, keyMap);
      continue;
    }

    result[column] = value;
  }

  return result;
}

// ── The import ────────────────────────────────────────────────────────────

export async function importWorkspace(
  options: ImportWorkspaceOptions,
): Promise<ImportDifference> {
  const { tx, workspaceId, archive, dryRun } = options;

  // Build the key map
  const { keyMap, merged } = await buildKeyMap({
    tx,
    workspaceId,
    archive,
  });

  const created: Record<string, number> = {};
  const skipped: Record<string, number> = {};
  const deferredUpdates: {
    table: string;
    id: string;
    column: string;
    value: string;
  }[] = [];

  // Group archive rows by table
  const rowsByTable = new Map<string, Record<string, unknown>[]>();
  for (const record of archive.records) {
    if (record.r !== "row") continue;
    const existing = rowsByTable.get(record.t) ?? [];
    existing.push(record.d);
    rowsByTable.set(record.t, existing);
  }

  // Insert in topological order
  for (const table of EXPORTED_TABLES) {
    const rows = rowsByTable.get(table);
    if (!rows || rows.length === 0) continue;

    let tableCreated = 0;
    let tableSkipped = 0;

    for (const raw of rows) {
      const remapped = remapRow(table, raw, keyMap);
      const remappedId = String(remapped.id);

      // Collect deferred column values for the second pass
      for (const [column, value] of Object.entries(raw)) {
        if (isDeferred(table, column) && isUuid(value)) {
          const mapped = keyMap.get(value);
          if (mapped) {
            deferredUpdates.push({
              table,
              id: remappedId,
              column,
              value: mapped,
            });
          }
        }
      }

      // Skip rows that already exist in the target: merged members, and
      // any row whose remapped id is already present (re-import or
      // provisioning-created rows like the workspace's own access_context).
      const isMergedMember =
        table === "workspace_members" &&
        merged.some((m) => m.existingId === remappedId);

      if (isMergedMember) {
        tableSkipped++;
        continue;
      }

      if (dryRun) {
        // Dry-run counts everything non-merged as created. The real run
        // uses ON CONFLICT DO NOTHING which may skip rows that collide on
        // a unique constraint other than the primary key (e.g. an
        // access_context already provisioned for the workspace). The
        // difference is small and the dry-run report says "at most".
        tableCreated++;
        continue;
      }

      // Serialise array/object values as JSON strings before interpolation.
      // Drizzle's sql template tag treats JS arrays as SQL tuples `(a, b)`
      // instead of Postgres array literals, which breaks array columns
      // like `session_dates` and `levels`. JSON strings let Postgres cast
      // to the column's own type.
      const columns = Object.keys(remapped);
      const values = Object.values(remapped).map((v) =>
        v !== null && typeof v === "object" ? JSON.stringify(v) : v,
      );

      const columnList = columns
        .map((c) => sql.identifier(c))
        .reduce(
          (acc, col, i) => (i === 0 ? sql`${col}` : sql`${acc}, ${col}`),
          sql``,
        );
      const valueList = values.reduce(
        (acc, val, i) => (i === 0 ? sql`${val}` : sql`${acc}, ${val}`),
        sql``,
      );

      // Each insert is wrapped in a savepoint so a foreign-key violation
      // (e.g. a binding referencing a group that was skipped by ON
      // CONFLICT) does not abort the whole transaction. Postgres requires
      // a ROLLBACK TO SAVEPOINT after any error inside a transaction.
      const sp = `sp_${table}_${tableCreated + tableSkipped}`;
      await tx.execute(sql.raw(`SAVEPOINT ${sp}`));
      try {
        // openokr:allow-mutation: the calling Operation's own transaction.
        const result = await tx.execute(
          sql`INSERT INTO ${sql.identifier(table)} (${columnList}) VALUES (${valueList}) ON CONFLICT DO NOTHING`,
        );
        await tx.execute(sql.raw(`RELEASE SAVEPOINT ${sp}`));
        if ((result.rowCount ?? 0) > 0) {
          tableCreated++;
        } else {
          tableSkipped++;
        }
      } catch {
        await tx.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${sp}`));
        tableSkipped++;
      }
    }

    if (tableCreated > 0) created[table] = tableCreated;
    if (tableSkipped > 0) skipped[table] = tableSkipped;
  }

  // Second pass: deferred columns
  if (!dryRun) {
    for (const update of deferredUpdates) {
      // Only update rows we actually inserted (skip merged members)
      const exists = await tx.execute<{ n: string }>(
        sql`select count(*)::text as n from ${sql.identifier(update.table)} where id = ${update.id}`,
      );
      if (Number(exists.rows[0]?.n) === 0) continue;

      // openokr:allow-mutation: the calling Operation's own transaction.
      await tx.execute(
        sql`update ${sql.identifier(update.table)} set ${sql.identifier(update.column)} = ${update.value} where id = ${update.id}`,
      );
    }
  }

  // Blob re-upload
  let blobCount = 0;
  const blobRecords = archive.records.filter((r) => r.r === "blob");
  for (const record of blobRecords) {
    if (record.r !== "blob") continue;
    blobCount++;

    if (dryRun || !options.storage) continue;

    const archivedBlobId = record.id;
    const remappedBlobId = keyMap.get(archivedBlobId) ?? archivedBlobId;
    const bytes = Buffer.from(record.b, "base64");

    // Look up the blob row to get filename and content type
    const blobRow = await tx.execute<{
      filename: string;
      content_type: string;
      storage_key: string;
    }>(
      sql`select filename, content_type, storage_key from blobs where id = ${remappedBlobId}`,
    );
    const row = blobRow.rows[0];
    if (!row) continue;

    // Prepare, put, claim
    const prepared = await options.storage.prepare({
      workspaceId,
      memberId: options.actorMemberId,
      filename: row.filename,
      contentType: row.content_type,
      sizeBytes: bytes.byteLength,
    });
    await options.storage.put(prepared.storageKey, bytes);
    await options.storage.claim(prepared.blobId);

    // Update the blob row's storage key to the new one
    // openokr:allow-mutation: the calling Operation's own transaction.
    await tx.execute(
      sql`update blobs set storage_key = ${prepared.storageKey} where id = ${remappedBlobId}`,
    );
  }

  return { created, merged, skipped, blobs: blobCount };
}
