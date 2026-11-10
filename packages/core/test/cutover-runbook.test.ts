import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The migration cutover, walked through the actions its runbook calls
 * (docs/runbooks/migration-cutover.md, plan 0.7.0 B9).
 *
 * This replaces `deploy/docker/cutover-rehearsal.sh`, which could not run: it
 * required TypeScript packages from `node -e` at the repository root, where
 * they do not resolve, called the export and the import without the
 * passphrase the archive needs, and discarded every error with `|| true`.
 * Nothing ran it, so nobody saw. As a test it runs on every change.
 *
 * Two workspaces stand for the source and the target instance. The archive is
 * sealed under a passphrase, not under either instance's root key, which is
 * what lets one instance open what another wrote.
 */

const SOURCE_OWNER = "cutover-source-owner";
const TARGET_OWNER = "cutover-target-owner";
const PASSPHRASE = "a passphrase for the move only";

let source: string;
let target: string;

const as = async (userId: string, workspaceId: string) => ({
  pool: (await workerDb()).appPool,
  workspaceId,
  actor: { kind: "human" as const, userId },
});

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $1, $2), ($3, $3, $4)",
    [
      SOURCE_OWNER,
      "cutover-source@example.com",
      TARGET_OWNER,
      "cutover-target@example.com",
    ],
  );
  source = (
    await provisionWorkspaceForUser(wb.appPool, {
      id: SOURCE_OWNER,
      name: SOURCE_OWNER,
    })
  ).workspaceId;
  target = (
    await provisionWorkspaceForUser(wb.appPool, {
      id: TARGET_OWNER,
      name: TARGET_OWNER,
    })
  ).workspaceId;
  // Something of the source's own to move, beyond what provisioning writes.
  await callAction(
    await as(SOURCE_OWNER, source),
    "invitations.createWorkspaceLink",
    {},
  );
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the migration cutover runbook", () => {
  it("freezes, exports, predicts the import exactly, imports, and can roll back", async () => {
    const sourceOwner = await as(SOURCE_OWNER, source);
    const targetOwner = await as(TARGET_OWNER, target);

    // Phase 1: freeze the source.
    await callAction(sourceOwner, "workspace.setState", { state: "frozen" });

    // Phase 3: export from the frozen source (B5 made this possible).
    const exported = await callAction(sourceOwner, "workspace.exportArchive", {
      includeFiles: true,
      passphrase: PASSPHRASE,
    });
    expect(exported.archiveBase64.length).toBeGreaterThan(0);
    expect(Object.values(exported.counts).some((count) => count > 0)).toBe(
      true,
    );

    // Phase 3: the dry run on the target writes nothing it reports.
    const dryRun = await callAction(targetOwner, "workspace.importArchive", {
      archiveBase64: exported.archiveBase64,
      passphrase: PASSPHRASE,
      dryRun: true,
    });

    // Phase 4: the real import, whose report must match the dry run exactly.
    const real = await callAction(targetOwner, "workspace.importArchive", {
      archiveBase64: exported.archiveBase64,
      passphrase: PASSPHRASE,
      dryRun: false,
    });
    // Every row the dry run counted is accounted for, table by table: created,
    // or skipped because the target already has it (its own workspace row,
    // rhythm settings, roles). The dry run cannot know those collide without
    // writing, which is why it counts them as created.
    for (const [table, count] of Object.entries(dryRun.difference.created)) {
      expect(
        (real.difference.created[table] ?? 0) +
          (real.difference.skipped[table] ?? 0),
        table,
      ).toBe(count);
    }
    expect(real.difference.merged).toEqual(dryRun.difference.merged);
    expect(real.difference.blobs).toBe(dryRun.difference.blobs);
    expect(real.alreadyImported).toBe(false);

    // A second real import is a no-op, so a retried cutover cannot double it.
    const again = await callAction(targetOwner, "workspace.importArchive", {
      archiveBase64: exported.archiveBase64,
      passphrase: PASSPHRASE,
      dryRun: false,
    });
    expect(again.alreadyImported).toBe(true);

    // Phase 7: the rollback. The source unfreezes and takes writes again.
    await callAction(sourceOwner, "workspace.setState", { state: "active" });
    await expect(
      callAction(sourceOwner, "invitations.createWorkspaceLink", {}),
    ).resolves.toBeTruthy();
  });

  it("refuses the archive without its passphrase", async () => {
    const sourceOwner = await as(SOURCE_OWNER, source);
    await callAction(sourceOwner, "workspace.setState", { state: "frozen" });
    const exported = await callAction(sourceOwner, "workspace.exportArchive", {
      includeFiles: false,
      passphrase: PASSPHRASE,
    });
    await expect(
      callAction(await as(TARGET_OWNER, target), "workspace.importArchive", {
        archiveBase64: exported.archiveBase64,
        passphrase: "not the one it was sealed with",
        dryRun: true,
      }),
    ).rejects.toThrow();
  });
});
