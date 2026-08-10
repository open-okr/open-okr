import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bindGroup, ensureMemberGroup } from "../src/access/contexts.ts";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import { resolveSubjectContext } from "../src/access/reads.ts";
import { callAction } from "../src/actions/registry.ts";
import { runOperation } from "../src/operations/operation.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The freeze overlay (P2-T09 test plan, TECHNICAL-PLAN §4.1, §8.2).
 *
 * "When the workspace state is not active, the permission layer collapses
 * everything to view-only except an admin recovery list." Reads are
 * unaffected by construction (a read action never opens a transaction
 * through `runOperation`), so this only has writes to exercise.
 */

const OWNER = "freeze-owner";

let workspaceId: string;

const context = (actorUserId: string) => ({
  workspaceId,
  actor: { kind: "human" as const, userId: actorUserId },
});

async function setState(
  state: "active" | "read_only" | "frozen",
): Promise<void> {
  await callAction(
    { pool: (await workerDb()).appPool, ...context(OWNER) },
    "workspace.setState",
    { state },
  );
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Freeze Owner", "freeze-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Freeze Owner",
  });
  workspaceId = provisioned.workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe.each(["read_only", "frozen"] as const)("state = %s", (state) => {
  it("refuses an ordinary write", async () => {
    await setState(state);

    await expect(
      callAction(
        { pool: (await workerDb()).appPool, ...context(OWNER) },
        "invitations.createWorkspaceLink",
        {},
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("still allows member management", async () => {
    await setState(state);

    await expect(
      callAction(
        { pool: (await workerDb()).appPool, ...context(OWNER) },
        "people.updateOwnProfile",
        { timezone: "UTC" },
      ),
    ).resolves.toBeTruthy();
  });

  it("still allows settings management", async () => {
    await setState(state);

    await expect(
      callAction(
        { pool: (await workerDb()).appPool, ...context(OWNER) },
        "settings.updateWorkspaceGeneral",
        { timezone: "UTC" },
      ),
    ).resolves.toBeTruthy();
  });

  it("still allows lifting the freeze itself", async () => {
    await setState(state);

    await expect(setState("active")).resolves.toBeUndefined();

    // Proven, not just hoped: an ordinary write works again afterwards.
    await expect(
      callAction(
        { pool: (await workerDb()).appPool, ...context(OWNER) },
        "invitations.createWorkspaceLink",
        {},
      ),
    ).resolves.toBeTruthy();
  });
});

describe("workspace.setState", () => {
  it("records the state-changed activity with the transition", async () => {
    await setState("frozen");

    const wb = await workerDb();
    const rows = await wb.admin.query<{
      payload: { from: string; to: string };
    }>(
      "select payload from activities where workspace_id = $1 and kind = 'workspace.state_changed'",
      [workspaceId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.payload).toEqual({ from: "active", to: "frozen" });
  });

  it("refuses a member who holds edit but not full access", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "insert into users (id, name, email) values ($1, $2, $3)",
      ["freeze-editor", "Editor", "freeze-editor@example.com"],
    );
    const editorResult = await wb.admin.query<{ id: string }>(
      `insert into workspace_members (id, workspace_id, user_id, name, kind, status)
       values (gen_random_uuid(), $1, 'freeze-editor', 'Editor', 'human', 'active')
       returning id`,
      [workspaceId],
    );
    const editor = editorResult.rows[0]?.id;
    if (!editor) {
      throw new Error("insert into workspace_members returned no row");
    }

    await runOperation(
      { pool: wb.appPool },
      {
        action: "test.grant-edit",
        workspaceId,
        actor: { kind: "human", userId: OWNER },
        async execute({ tx }) {
          const contextResult = await resolveSubjectContext(
            tx,
            "workspace",
            workspaceId,
            workspaceId,
          );
          const groupId = await ensureMemberGroup(tx, {
            workspaceId,
            memberId: editor,
          });
          await bindGroup(tx, {
            workspaceId,
            groupId,
            contextId: (contextResult as { contextId: string }).contextId,
            level: ACCESS_LEVELS.edit,
          });
          return {
            result: undefined,
            activity: {
              kind: "test.grant-edit",
              subjectType: "workspace_member",
              subjectId: editor,
            },
            audit: {
              action: "test.grant-edit",
              targetType: "workspace_member",
            },
          };
        },
      },
    );

    await expect(
      callAction(
        { pool: wb.appPool, ...context("freeze-editor") },
        "workspace.setState",
        { state: "frozen" },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
