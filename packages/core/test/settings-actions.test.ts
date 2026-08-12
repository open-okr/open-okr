import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bindGroup, ensureMemberGroup } from "../src/access/contexts.ts";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import { resolveSubjectContext } from "../src/access/reads.ts";
import { callAction } from "../src/actions/registry.ts";
import { runOperation } from "../src/operations/operation.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Workspace settings actions (P2-T08 test plan, TECHNICAL-PLAN §4.14).
 *
 * Every setting resolving to its documented default on a fresh workspace is
 * already covered in settings.test.ts and provisioning.test.ts, which walk
 * the live registry. This file covers the other half: writing a value,
 * reading it back, and resetting it — by key and by card — exactly.
 */

const OWNER = "settings-owner";

let workspaceId: string;

async function addMember(name: string): Promise<string> {
  const wb = await workerDb();
  const result = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, name, kind, status)
     values (gen_random_uuid(), $1, $2, 'human', 'active')
     returning id`,
    [workspaceId, name],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("insert into workspace_members returned no row");
  }
  return row.id;
}

/** Like `addMember`, but with a real `users` row behind it, for the read
 * action, which resolves its member from a user id the way workspace.overview
 * does. */
async function addMemberWithUser(
  name: string,
  userId: string,
): Promise<string> {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [userId, name, `${userId}@example.com`],
  );
  const result = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, kind, status)
     values (gen_random_uuid(), $1, $2, $3, 'human', 'active')
     returning id`,
    [workspaceId, userId, name],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("insert into workspace_members returned no row");
  }
  return row.id;
}

/** Gives a member an `edit` binding on the workspace's own context: enough
 * to reach a view- or edit-declared action, not enough to reach a
 * full-declared one. */
async function grantEditOnWorkspace(memberId: string): Promise<void> {
  const wb = await workerDb();
  await runOperation(
    { pool: wb.appPool },
    {
      action: "test.grant-edit",
      workspaceId,
      actor: { kind: "human", userId: OWNER },
      async execute({ tx }) {
        const context = await resolveSubjectContext(
          tx,
          "workspace",
          workspaceId,
          workspaceId,
        );
        const groupId = await ensureMemberGroup(tx, { workspaceId, memberId });
        await bindGroup(tx, {
          workspaceId,
          groupId,
          contextId: (context as { contextId: string }).contextId,
          level: ACCESS_LEVELS.edit,
        });
        return {
          result: undefined,
          activity: {
            kind: "test.grant-edit",
            subjectType: "workspace_member",
            subjectId: memberId,
          },
          audit: { action: "test.grant-edit", targetType: "workspace_member" },
        };
      },
    },
  );
}

const context = (actorUserId: string) => ({
  workspaceId,
  actor: { kind: "human" as const, userId: actorUserId },
});

async function readSettings(): Promise<Record<string, unknown>> {
  const wb = await workerDb();
  const row = await wb.admin.query(
    "select settings from workspaces where id = $1",
    [workspaceId],
  );
  return row.rows[0].settings as Record<string, unknown>;
}

async function readActivityKinds(): Promise<string[]> {
  const wb = await workerDb();
  const rows = await wb.admin.query<{ kind: string }>(
    "select kind from activities where workspace_id = $1 order by at asc",
    [workspaceId],
  );
  return rows.rows.map((row) => row.kind);
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Settings Owner", "settings-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Settings Owner",
  });
  workspaceId = provisioned.workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("settings.readWorkspaceSettings", () => {
  it("reads back the workspace's own settings", async () => {
    const read = await callAction(
      { pool: (await workerDb()).appPool, ...context(OWNER) },
      "settings.readWorkspaceSettings",
      {},
    );
    expect(read.settings.timezone).toBe("UTC");
  });

  it("refuses a member who holds edit but not full access", async () => {
    const editor = await addMemberWithUser("Editor", "settings-editor");
    await grantEditOnWorkspace(editor);

    await expect(
      callAction(
        { pool: (await workerDb()).appPool, ...context("settings-editor") },
        "settings.readWorkspaceSettings",
        {},
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("settings.updateWorkspaceGeneral", () => {
  it("changes only the keys it was given", async () => {
    const before = await readSettings();

    await callAction(
      { pool: (await workerDb()).appPool, ...context(OWNER) },
      "settings.updateWorkspaceGeneral",
      { timezone: "Asia/Kuala_Lumpur" },
    );

    const after = await readSettings();
    expect(after.timezone).toBe("Asia/Kuala_Lumpur");
    expect(after.language).toBe(before.language);
    expect(after.trustedEmailDomains).toEqual(before.trustedEmailDomains);
  });

  it("records the general-settings-updated activity with the changed keys", async () => {
    await callAction(
      { pool: (await workerDb()).appPool, ...context(OWNER) },
      "settings.updateWorkspaceGeneral",
      { language: "fr", trustedEmailDomains: ["example.com"] },
    );

    expect(await readActivityKinds()).toContain(
      "workspace.general_settings_updated",
    );
  });

  it("rejects a timezone the runtime does not know, before touching the row", async () => {
    await expect(
      callAction(
        { pool: (await workerDb()).appPool, ...context(OWNER) },
        "settings.updateWorkspaceGeneral",
        { timezone: "Mars/Olympus" },
      ),
    ).rejects.toBeTruthy();

    const after = await readSettings();
    expect(after.timezone).not.toBe("Mars/Olympus");
  });

  it("rejects a domain that looks like an email address, not a domain", async () => {
    await expect(
      callAction(
        { pool: (await workerDb()).appPool, ...context(OWNER) },
        "settings.updateWorkspaceGeneral",
        { trustedEmailDomains: ["person@example.com"] },
      ),
    ).rejects.toBeTruthy();
  });

  it("refuses a member who holds edit but not full access", async () => {
    const editor = await addMember("Editor");
    await grantEditOnWorkspace(editor);

    await expect(
      callAction(
        {
          pool: (await workerDb()).appPool,
          workspaceId,
          actor: { kind: "human", memberId: editor },
        },
        "settings.updateWorkspaceGeneral",
        { timezone: "UTC" },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("settings.updateWorkspaceBranding", () => {
  it("replaces the branding object wholesale", async () => {
    await callAction(
      { pool: (await workerDb()).appPool, ...context(OWNER) },
      "settings.updateWorkspaceBranding",
      { branding: { primaryColor: "#336699" } },
    );

    const after = await readSettings();
    expect(after.branding).toEqual({ primaryColor: "#336699" });
  });

  it("records the branding-updated activity", async () => {
    await callAction(
      { pool: (await workerDb()).appPool, ...context(OWNER) },
      "settings.updateWorkspaceBranding",
      { branding: {} },
    );

    expect(await readActivityKinds()).toContain("workspace.branding_updated");
  });

  it("rejects a primary colour that is not a hex triplet", async () => {
    await expect(
      callAction(
        { pool: (await workerDb()).appPool, ...context(OWNER) },
        "settings.updateWorkspaceBranding",
        { branding: { primaryColor: "blue" } },
      ),
    ).rejects.toBeTruthy();
  });
});

describe("settings.resetWorkspaceSettings", () => {
  it("resets one key to exactly its registry default", async () => {
    await callAction(
      { pool: (await workerDb()).appPool, ...context(OWNER) },
      "settings.updateWorkspaceGeneral",
      { timezone: "Asia/Kuala_Lumpur" },
    );
    expect((await readSettings()).timezone).toBe("Asia/Kuala_Lumpur");

    await callAction(
      { pool: (await workerDb()).appPool, ...context(OWNER) },
      "settings.resetWorkspaceSettings",
      { key: "timezone" },
    );
    expect((await readSettings()).timezone).toBe("UTC");
  });

  it("resets a whole card to exactly its registry defaults", async () => {
    await callAction(
      { pool: (await workerDb()).appPool, ...context(OWNER) },
      "settings.updateWorkspaceGeneral",
      {
        timezone: "Asia/Kuala_Lumpur",
        language: "fr",
        trustedEmailDomains: ["example.com"],
      },
    );

    await callAction(
      { pool: (await workerDb()).appPool, ...context(OWNER) },
      "settings.resetWorkspaceSettings",
      { card: "general" },
    );

    const after = await readSettings();
    expect(after.timezone).toBe("UTC");
    expect(after.language).toBe("en");
    expect(after.trustedEmailDomains).toEqual([]);
  });

  it("leaves settings on other cards untouched by a card reset", async () => {
    await callAction(
      { pool: (await workerDb()).appPool, ...context(OWNER) },
      "settings.updateWorkspaceBranding",
      { branding: { primaryColor: "#336699" } },
    );

    await callAction(
      { pool: (await workerDb()).appPool, ...context(OWNER) },
      "settings.resetWorkspaceSettings",
      { card: "general" },
    );

    expect((await readSettings()).branding).toEqual({
      primaryColor: "#336699",
    });
  });

  it("refuses a key outside the registry", async () => {
    await expect(
      callAction(
        { pool: (await workerDb()).appPool, ...context(OWNER) },
        "settings.resetWorkspaceSettings",
        { key: "doesNotExist" },
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("refuses a card nothing is on", async () => {
    await expect(
      callAction(
        { pool: (await workerDb()).appPool, ...context(OWNER) },
        "settings.resetWorkspaceSettings",
        { card: "no-such-card" },
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
