import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { newId } from "../src/id.ts";
import {
  type AccessRoleTag,
  accessBindings,
  accessContexts,
  accessGroups,
} from "../src/schema/access.ts";
import { workspaces } from "../src/schema/workspaces.ts";
import { withWorkspace } from "../src/tenant.ts";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";

describe("access_bindings tag constraint", () => {
  let contextId: string;
  let groupId: string;

  beforeEach(async () => {
    const wb = await workerDb();
    await wb.truncateAllTables();
    contextId = newId();
    groupId = newId();

    await withWorkspace(wb.db, WORKSPACE_ID, async (tx) => {
      await tx.insert(workspaces).values({
        id: WORKSPACE_ID,
        name: "Test Workspace",
        slug: `test-workspace-${Date.now()}`,
      });
      await tx.insert(accessContexts).values({
        id: contextId,
        workspaceId: WORKSPACE_ID,
        resourceType: "workspace",
        resourceId: WORKSPACE_ID,
      });
      await tx.insert(accessGroups).values({
        id: groupId,
        workspaceId: WORKSPACE_ID,
        kind: "workspace_standard",
      });
    });
  });

  afterAll(async () => {
    const wb = await workerDb();
    await wb.close();
  });

  it("inserts a binding with tag 'owner'", async () => {
    const wb = await workerDb();
    const bindingId = newId();
    await withWorkspace(wb.db, WORKSPACE_ID, async (tx) => {
      await tx.insert(accessBindings).values({
        id: bindingId,
        workspaceId: WORKSPACE_ID,
        groupId,
        contextId,
        level: 100,
        tag: "owner",
      });
    });

    const rows = await withWorkspace(wb.db, WORKSPACE_ID, async (tx) =>
      tx.select().from(accessBindings),
    );
    expect(rows.some((r) => r.id === bindingId && r.tag === "owner")).toBe(
      true,
    );
  });

  it("inserts a binding with tag 'share'", async () => {
    const wb = await workerDb();
    const bindingId = newId();
    await withWorkspace(wb.db, WORKSPACE_ID, async (tx) => {
      await tx.insert(accessBindings).values({
        id: bindingId,
        workspaceId: WORKSPACE_ID,
        groupId,
        contextId,
        level: 70,
        tag: "share",
      });
    });

    const rows = await withWorkspace(wb.db, WORKSPACE_ID, async (tx) =>
      tx.select().from(accessBindings),
    );
    expect(rows.some((r) => r.id === bindingId && r.tag === "share")).toBe(
      true,
    );
  });

  it("refuses a binding with tag 'other' via access_bindings_tag_check", async () => {
    const wb = await workerDb();
    const bindingId = newId();
    let thrownError: unknown = null;

    try {
      await withWorkspace(wb.db, WORKSPACE_ID, async (tx) => {
        await tx.insert(accessBindings).values({
          id: bindingId,
          workspaceId: WORKSPACE_ID,
          groupId,
          contextId,
          level: 70,
          tag: "other" as unknown as AccessRoleTag,
        });
      });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).not.toBeNull();
    const fullMessage = String(
      (
        thrownError as {
          cause?: { message?: string; constraint?: string };
          message?: string;
        }
      )?.cause?.message ||
        (thrownError as { cause?: { constraint?: string } })?.cause
          ?.constraint ||
        (thrownError as Error)?.message ||
        thrownError,
    );
    expect(fullMessage).toContain("access_bindings_tag_check");
  });
});
