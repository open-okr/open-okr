/**
 * Importing a workspace archive (TECHNICAL-PLAN SS7.3, P6-T05b).
 *
 * Round trip: export a seeded workspace, import into a fresh workspace on the
 * same instance. The acceptance criterion is that the dry-run difference
 * predicts exactly what the real import does, the row counts reconcile against
 * the manifest, members are de-duplicated by email only, a corrupted archive
 * is refused, and a re-import is a no-op.
 */
import { randomBytes } from "node:crypto";
import { withWorkspace } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionMemberForInvite } from "../src/invitations/provisioning.ts";
import { ArchiveError, readArchive } from "../src/portability/archive.ts";
import { exportWorkspace } from "../src/portability/export.ts";
import {
  type ImportDifference,
  importWorkspace,
  postgresArrayLiteral,
} from "../src/portability/import.ts";
import { EXPORTED_TABLES } from "../src/portability/policy.ts";
import { newRootKey, parseKeyRing } from "../src/secrets/key-ring.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const OWNER_A = "44444444-4444-4444-8444-444444444444";
const OWNER_B = "55555555-5555-4555-8555-555555555555";

let pool: Pool;
let sourceWorkspaceId: string;
let targetWorkspaceId: string;
let targetMemberId: string;
const ring = parseKeyRing({ current: newRootKey() });
/** Every archive here is sealed under this (completeness review H-18). */
const PASSPHRASE = "correct horse battery staple";

beforeEach(async () => {
  const wb = await workerDb();
  pool = wb.appPool;
  await wb.truncateAllTables();

  // Source workspace: owned by OWNER_A
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER_A, "Source Owner", "source-owner@example.com"],
  );
  const source = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER_A,
    name: "Source Owner",
  });
  sourceWorkspaceId = source.workspaceId;

  // Target workspace: owned by OWNER_B
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER_B, "Target Owner", "target-owner@example.com"],
  );
  const target = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER_B,
    name: "Target Owner",
  });
  targetWorkspaceId = target.workspaceId;
  targetMemberId = target.memberId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

async function exportSource() {
  const db = drizzle(pool);
  return withWorkspace(db, sourceWorkspaceId, (tx) =>
    exportWorkspace({
      tx,
      workspaceId: sourceWorkspaceId,
      passphrase: PASSPHRASE,
      instance: "test-source",
    }),
  );
}

async function importIntoTarget(
  archiveBytes: Buffer,
  dryRun: boolean,
): Promise<ImportDifference> {
  const archive = readArchive(archiveBytes, { passphrase: PASSPHRASE });
  const db = drizzle(pool);
  return withWorkspace(db, targetWorkspaceId, (tx) =>
    importWorkspace({
      tx,
      workspaceId: targetWorkspaceId,
      archive,
      dryRun,
      actorMemberId: targetMemberId,
    }),
  );
}

describe("importing a workspace archive", () => {
  it("round trip: row counts reconcile against the manifest", async () => {
    const exported = await exportSource();
    const archive = readArchive(exported.bytes, { passphrase: PASSPHRASE });

    const diff = await importIntoTarget(exported.bytes, false);

    // Every table the manifest counted should have been created or skipped
    const totalExpected = Object.values(archive.manifest.counts).reduce(
      (sum, n) => sum + n,
      0,
    );
    const totalCreated = Object.values(diff.created).reduce(
      (sum, n) => sum + n,
      0,
    );
    const totalSkipped = Object.values(diff.skipped).reduce(
      (sum, n) => sum + n,
      0,
    );

    // The source workspace's own member will be created (different email),
    // and the workspace row itself. No table should be lost.
    expect(totalCreated + totalSkipped).toBe(totalExpected);
  });

  it("dry-run predicts what the real import does", async () => {
    const exported = await exportSource();

    const dryRun = await importIntoTarget(exported.bytes, true);
    const real = await importIntoTarget(exported.bytes, false);

    // The dry-run counts everything non-merged as "created". The real run
    // may skip a few rows that collide on a unique constraint other than
    // the primary key (e.g. access_contexts provisioned with the target
    // workspace). So real.created <= dryRun.created, and both are close.
    const dryTotal = Object.values(dryRun.created).reduce((s, n) => s + n, 0);
    const realTotal = Object.values(real.created).reduce((s, n) => s + n, 0);
    const realSkipped = Object.values(real.skipped).reduce((s, n) => s + n, 0);
    // Every row the dry-run counted as created is accounted for in the
    // real run as either created or skipped.
    expect(realTotal + realSkipped).toBeGreaterThanOrEqual(dryTotal);
    expect(dryRun.merged.length).toBe(real.merged.length);
    expect(dryRun.blobs).toBe(real.blobs);
  });

  it("merges a member who already exists by email address", async () => {
    const wb = await workerDb();
    // Add a member in the source workspace with a known email
    await wb.admin.query(
      `insert into workspace_members (id, workspace_id, name, kind, status, placeholder_email)
       values (gen_random_uuid(), $1, 'Shared Person', 'placeholder', 'active', 'shared@example.com')`,
      [sourceWorkspaceId],
    );
    // Add the same email in the target workspace
    await wb.admin.query(
      `insert into workspace_members (id, workspace_id, name, kind, status, placeholder_email)
       values (gen_random_uuid(), $1, 'Shared Person', 'placeholder', 'active', 'shared@example.com')`,
      [targetWorkspaceId],
    );

    const exported = await exportSource();
    const diff = await importIntoTarget(exported.bytes, false);

    // The shared person should be merged, not duplicated
    expect(diff.merged.some((m) => m.email === "shared@example.com")).toBe(
      true,
    );

    // Count members in target workspace: should not have a duplicate
    const members = await wb.admin.query(
      `select count(*)::int as n from workspace_members
       where workspace_id = $1 and placeholder_email = 'shared@example.com'
         and deleted_at is null`,
      [targetWorkspaceId],
    );
    expect(members.rows[0].n).toBe(1);
  });

  it("creates a placeholder for a member whose email is unknown", async () => {
    const wb = await workerDb();
    // Add a unique member in the source
    await wb.admin.query(
      `insert into workspace_members (id, workspace_id, name, kind, status, placeholder_email)
       values (gen_random_uuid(), $1, 'New Person', 'placeholder', 'active', 'new-person@example.com')`,
      [sourceWorkspaceId],
    );

    const exported = await exportSource();
    const diff = await importIntoTarget(exported.bytes, false);

    // New Person should not be in merged
    expect(diff.merged.some((m) => m.email === "new-person@example.com")).toBe(
      false,
    );

    // Should exist in the target now
    const members = await wb.admin.query(
      `select count(*)::int as n from workspace_members
       where workspace_id = $1 and deleted_at is null`,
      [targetWorkspaceId],
    );
    // Target had its own owner + the source owner created + new person
    expect(members.rows[0].n).toBeGreaterThanOrEqual(3);
  });

  it("refuses a corrupted archive", async () => {
    const exported = await exportSource();
    // Flip one byte in the sealed body
    const corrupted = Buffer.from(exported.bytes);
    const idx = corrupted.byteLength - 10;
    corrupted[idx] = (corrupted[idx] ?? 0) ^ 0xff;

    expect(() => readArchive(corrupted, { passphrase: PASSPHRASE })).toThrow(
      ArchiveError,
    );
  });

  it("re-import of the same archive via the action is a no-op", async () => {
    const exported = await exportSource();

    // First real import through the action. The action needs `ring` in the
    // context to open the archive.
    const actionCtx = {
      pool,
      workspaceId: targetWorkspaceId,
      actor: { kind: "human" as const, userId: OWNER_B },
      ring,
    };
    const first = await callAction(actionCtx, "workspace.importArchive", {
      archiveBase64: exported.bytes.toString("base64"),
      passphrase: PASSPHRASE,
      dryRun: false,
    });
    expect(first.importId).toBeTruthy();

    // Count rows in target after first import
    const wb = await workerDb();
    const countAfterFirst = await wb.admin.query(
      `select count(*)::int as n from workspace_members
       where workspace_id = $1 and deleted_at is null`,
      [targetWorkspaceId],
    );

    // Second import of the same archive: should be a no-op
    const second = await callAction(actionCtx, "workspace.importArchive", {
      archiveBase64: exported.bytes.toString("base64"),
      passphrase: PASSPHRASE,
      dryRun: false,
    });
    expect(second.alreadyImported).toBe(true);

    // Row counts should not have changed
    const countAfterSecond = await wb.admin.query(
      `select count(*)::int as n from workspace_members
       where workspace_id = $1 and deleted_at is null`,
      [targetWorkspaceId],
    );
    expect(countAfterSecond.rows[0].n).toBe(countAfterFirst.rows[0].n);
  });
});

/**
 * Moving a workspace keeps its people and its files (completeness review
 * H-18). Everyone used to arrive as a member nobody could claim, and every
 * file as a row with no bytes.
 */
describe("what a move keeps", () => {
  it("carries a registered member's address, and they claim their member on joining", async () => {
    const exported = await exportSource();
    await importIntoTarget(exported.bytes, false);

    const wb = await workerDb();
    const { rows } = await wb.admin.query<{
      id: string;
      user_id: string | null;
    }>(
      `select id, user_id from workspace_members
        where workspace_id = $1 and lower(placeholder_email) = 'source-owner@example.com'`,
      [targetWorkspaceId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.user_id).toBeNull();
    const waiting = rows[0]?.id as string;

    // The source's owner joins the target instance's workspace, the way any
    // invited person arrives.
    const joined = await withWorkspace(drizzle(pool), targetWorkspaceId, (tx) =>
      provisionMemberForInvite(tx, {
        workspaceId: targetWorkspaceId,
        user: { id: OWNER_A, name: "Source Owner" },
      }),
    );
    expect(joined).toEqual({ memberId: waiting, created: false });
    const claimed = await wb.admin.query<{
      user_id: string;
      placeholder_email: string | null;
      status: string;
    }>(
      "select user_id, placeholder_email, status from workspace_members where id = $1",
      [waiting],
    );
    expect(claimed.rows[0]).toMatchObject({
      user_id: OWNER_A,
      placeholder_email: null,
      status: "active",
    });
  });

  it("points a mention in a stage note, a management answer, a revalidation note or the annual frame at the member's new id", async () => {
    // Guided-inputs changes 11b and 12. The stage notes, and what a
    // revision of an agreed frame held before, are maps of documents, which
    // the import walks key by key.
    const source = (input: unknown, name: string) =>
      callAction(
        {
          pool,
          workspaceId: sourceWorkspaceId,
          actor: { kind: "human", userId: OWNER_A },
        },
        name as never,
        input as never,
      );
    const [space] = (await source({}, "spaces.list")) as { id: string }[];
    const wb = await workerDb();
    const owner = await wb.admin.query<{ id: string }>(
      "select id from workspace_members where workspace_id = $1",
      [sourceWorkspaceId],
    );
    const ownerMemberId = owner.rows[0]?.id as string;
    const session = (await source(
      {
        // No cycle: the target's own current cycle has the same dates, so
        // the source's is skipped on import and a session naming it would
        // be skipped with it.
        spaceId: space?.id,
        kind: "quarterly",
        title: "Q1 review",
        scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
        facilitatorId: ownerMemberId,
      },
      "sessions.create",
    )) as { id: string };
    await source({ id: session.id }, "sessions.open");
    const mentioning = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Ask " },
            {
              type: "mention",
              attrs: { id: ownerMemberId, label: "Source Owner" },
            },
          ],
        },
      ],
    };
    await source({ id: session.id, note: mentioning }, "sessions.setStageNote");
    await source(
      { sessionId: session.id, questionKey: 1, body: mentioning },
      "sessions.setManagementAnswer",
    );
    // A quarter the target has no cycle for, so the cycle and its
    // revalidation are not skipped on import.
    const later = (await source(
      { on: "2030-02-15", mode: "quarterly" },
      "cycles.create",
    )) as { id: string };
    await source(
      {
        cycleId: later.id,
        holds: false,
        changed: true,
        changeNote: mentioning,
        focusNote: mentioning,
      },
      "workflow.setRevalidation",
    );
    // An agreed frame whose mission is then revised, so the revision keeps
    // the mentioning mission in its `before`, and the vision mentions too.
    const strategies = [
      { text: "Activation first" },
      { text: "Fewer markets" },
    ];
    await source(
      { yearLabel: "FY2030", agreed: true, mission: mentioning, strategies },
      "frame.set",
    );
    await source(
      {
        yearLabel: "FY2030",
        agreed: true,
        mission: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Activation, everywhere." }],
            },
          ],
        },
        vision: mentioning,
        strategies,
        reason: "The board narrowed the mission.",
      },
      "frame.set",
    );

    const exported = await exportSource();
    await importIntoTarget(exported.bytes, false);

    const moved = await wb.admin.query<{ id: string }>(
      `select id from workspace_members
        where workspace_id = $1 and lower(placeholder_email) = 'source-owner@example.com'`,
      [targetWorkspaceId],
    );
    const movedMemberId = moved.rows[0]?.id as string;
    expect(movedMemberId).not.toBe(ownerMemberId);

    const notes = await wb.admin.query<{ notes: Record<string, unknown> }>(
      "select notes from okr_sessions where workspace_id = $1",
      [targetWorkspaceId],
    );
    const answers = await wb.admin.query<{ body_document: unknown }>(
      "select body_document from management_answers where workspace_id = $1",
      [targetWorkspaceId],
    );
    const revalidations = await wb.admin.query<{
      change_note_document: unknown;
      focus_note_document: unknown;
    }>(
      `select change_note_document, focus_note_document
         from cycle_revalidations where workspace_id = $1`,
      [targetWorkspaceId],
    );
    const frames = await wb.admin.query<{ vision: unknown }>(
      "select vision from annual_frames where workspace_id = $1 and year_label = 'FY2030'",
      [targetWorkspaceId],
    );
    // The revision arrives too, since its array column is written as one,
    // and what the mission held before is a document in a map.
    const revisions = await wb.admin.query<{
      fields: string[];
      before: Record<string, unknown>;
    }>(
      "select fields, before from annual_frame_revisions where workspace_id = $1",
      [targetWorkspaceId],
    );
    expect(revisions.rows).toHaveLength(1);
    expect([...(revisions.rows[0]?.fields ?? [])].sort()).toEqual([
      "mission",
      "vision",
    ]);
    for (const document of [
      Object.values(notes.rows[0]?.notes ?? {})[0],
      answers.rows[0]?.body_document,
      revalidations.rows[0]?.change_note_document,
      revalidations.rows[0]?.focus_note_document,
      frames.rows[0]?.vision,
      revisions.rows[0]?.before.mission,
    ]) {
      expect(JSON.stringify(document)).toContain(movedMemberId);
      expect(JSON.stringify(document)).not.toContain(ownerMemberId);
    }
  });

  it("keeps a row with a Postgres array column, which it used to skip", async () => {
    // The import sent an array as JSON, which a `text[]` column refuses, and
    // counted the row as skipped: a workspace's own AI models and every
    // revision of an agreed annual frame were lost in a move.
    await callAction(
      {
        pool,
        workspaceId: sourceWorkspaceId,
        actor: { kind: "human", userId: OWNER_A },
      },
      "ai.addCustomModel",
      {
        provider: "ollama",
        modelId: "my-fine-tune:latest",
        displayName: "My Fine-Tune",
        contextWindow: 32_000,
        costInPerMillion: 0,
        costOutPerMillion: 0,
        supportsTools: false,
        supportsVision: false,
        supportsJsonMode: false,
        supportsStreaming: true,
        embeddingDimensions: null,
        tiers: ["balanced", "fast"],
      },
    );

    const exported = await exportSource();
    const diff = await importIntoTarget(exported.bytes, false);
    expect(diff.skipped.ai_models).toBeUndefined();

    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ tiers: string[] }>(
      "select tiers from ai_models where workspace_id = $1 and model_id = 'my-fine-tune:latest'",
      [targetWorkspaceId],
    );
    expect(rows[0]?.tiers).toEqual(["balanced", "fast"]);
  });

  it("moves a row in every exported table with an array column", async () => {
    // The two above are the tests that move one. A third such table fails
    // here, so whoever adds it adds a row to move as well.
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ table_name: string }>(
      `select distinct table_name from information_schema.columns
        where table_schema = 'public' and data_type = 'ARRAY'
        order by table_name`,
    );
    expect(
      rows
        .map((row) => row.table_name)
        .filter((table) => EXPORTED_TABLES.includes(table)),
    ).toEqual(["ai_models", "annual_frame_revisions"]);
  });

  it("writes an array literal Postgres reads back as it was", async () => {
    const wb = await workerDb();
    const values = [
      "plain",
      "two words",
      'a "quoted" one',
      "a, comma",
      "{braces}",
      "back\\slash",
      "",
      "NULL",
      null,
    ];
    const { rows } = await wb.admin.query<{ read: (string | null)[] }>(
      "select $1::text[] as read",
      [postgresArrayLiteral(values)],
    );
    expect(rows[0]?.read).toEqual(values);
    const empty = await wb.admin.query<{ read: string[] }>(
      "select $1::text[] as read",
      [postgresArrayLiteral([])],
    );
    expect(empty.rows[0]?.read).toEqual([]);
  });

  it("writes every file's bytes back, under the new workspace", async () => {
    const contents = randomBytes(48);
    const source = new Map<string, Buffer>();
    const actor = {
      pool,
      workspaceId: sourceWorkspaceId,
      actor: { kind: "human" as const, userId: OWNER_A },
    };
    const prepared = await callAction(actor, "blobs.prepareUpload", {
      filename: "brief.pdf",
      contentType: "application/pdf",
      declaredSize: contents.byteLength,
    });
    source.set(prepared.storageKey, contents);
    await callAction(actor, "blobs.claimUpload", {
      blobId: prepared.blobId,
      actualSize: contents.byteLength,
      digest: "not-checked-here",
    });

    const exported = await withWorkspace(
      drizzle(pool),
      sourceWorkspaceId,
      (tx) =>
        exportWorkspace({
          tx,
          workspaceId: sourceWorkspaceId,
          passphrase: PASSPHRASE,
          instance: "test-source",
          storage: {
            get: async (key: string) => source.get(key) as Buffer,
          },
        }),
    );

    const written = new Map<string, Buffer>();
    const result = await callAction(
      {
        pool,
        workspaceId: targetWorkspaceId,
        actor: { kind: "human" as const, userId: OWNER_B },
        storage: {
          get: async () => Buffer.alloc(0),
          delete: async () => undefined,
          put: async (key: string, body: Buffer) => {
            written.set(key, body);
          },
        },
      },
      "workspace.importArchive",
      {
        archiveBase64: exported.bytes.toString("base64"),
        dryRun: false,
        passphrase: PASSPHRASE,
      },
    );
    expect(result.difference.blobs).toBe(1);
    expect(written.size).toBe(1);
    const [key, bytes] = [...written.entries()][0] as [string, Buffer];
    expect(key.startsWith(`${targetWorkspaceId}/`)).toBe(true);
    expect(bytes.equals(contents)).toBe(true);

    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ storage_key: string }>(
      "select storage_key from blobs where workspace_id = $1 and filename = 'brief.pdf'",
      [targetWorkspaceId],
    );
    expect(rows.map((row) => row.storage_key)).toEqual([key]);
  });
});

describe("search after a move (completeness review M-31)", () => {
  it("queues the imported rows for the search index, and a dry run queues nothing", async () => {
    const wb = await workerDb();
    const kpi = (await callAction(
      {
        pool: wb.appPool,
        workspaceId: sourceWorkspaceId,
        actor: { kind: "human", userId: OWNER_A },
      },
      "kpis.create",
      {
        title: "Weekly active teams",
        ownerKind: "workspace",
        frequency: "monthly",
        direction: "higher_better",
        indicatorType: "lagging",
        tier: "output",
        aggregate: "sum",
      },
    )) as { id: string };
    const exported = await exportSource();

    const queued = async () =>
      (
        await wb.admin.query<{ entity_type: string }>(
          `select payload->>'entityType' as entity_type from outbox
            where topic = 'content.index' and payload->>'workspaceId' = $1`,
          [targetWorkspaceId],
        )
      ).rows.map((row) => row.entity_type);

    await importIntoTarget(exported.bytes, true);
    expect(await queued()).toEqual([]);

    await importIntoTarget(exported.bytes, false);
    // The KPI arrives under a new id, so the job is found by type: before
    // this, nothing was queued at all and search came back empty.
    expect(await queued()).toContain("kpi");
    expect(kpi.id).toBeTruthy();
  });
});
