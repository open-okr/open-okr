import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bindGroup, ensureMemberGroup } from "../src/access/contexts.ts";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import { resolveSubjectContext } from "../src/access/reads.ts";
import { callAction } from "../src/actions/registry.ts";
import { dispatchTool } from "../src/index.ts";
import { runOperation } from "../src/operations/operation.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Actions declared by hand rather than through a builder (MCP UAT BUG-001).
 *
 * `workspace.provision` and the two import table actions write their own
 * handlers, so neither builder enforced their declared `full`. An ordinary
 * member's agent token created a workspace for another person on a live
 * instance. The imports were held only because their row limit happens to
 * read an administrator's setting first; they now check their own level.
 * These pin the refusals on the one door every surface uses, and on the agent
 * endpoint itself.
 */

const OWNER = "hand-written-owner";
const MEMBER = "hand-written-member";

let workspaceId: string;

const context = (userId: string) => ({
  workspaceId,
  actor: { kind: "human" as const, userId },
});

const TABLE = {
  entity: "goals" as const,
  table: { headers: ["Title", "Level"], rows: [["Ship the pilot", "company"]] },
  name: "goals.csv",
};

/** A member with `edit` on the workspace: every member's level, not `full`. */
async function addEditMember(): Promise<void> {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [MEMBER, "Ordinary Member", `${MEMBER}@example.com`],
  );
  const inserted = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, kind, status)
     values (gen_random_uuid(), $1, $2, 'Ordinary Member', 'human', 'active')
     returning id`,
    [workspaceId, MEMBER],
  );
  const memberId = inserted.rows[0]?.id;
  if (!memberId) {
    throw new Error("insert into workspace_members returned no row");
  }
  await runOperation(
    { pool: wb.appPool },
    {
      action: "test.grant-edit",
      workspaceId,
      actor: { kind: "human", userId: OWNER },
      async execute({ tx }) {
        const subject = await resolveSubjectContext(
          tx,
          "workspace",
          workspaceId,
          workspaceId,
        );
        const groupId = await ensureMemberGroup(tx, { workspaceId, memberId });
        await bindGroup(tx, {
          workspaceId,
          groupId,
          contextId: (subject as { contextId: string }).contextId,
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

async function count(table: string): Promise<number> {
  const wb = await workerDb();
  const result = await wb.admin.query<{ n: number }>(
    `select count(*)::int as n from ${table}`,
  );
  return result.rows[0]?.n ?? 0;
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Hand Written Owner", `${OWNER}@example.com`],
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, {
      id: OWNER,
      name: "Hand Written Owner",
    })
  ).workspaceId;
  await addEditMember();
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
});

describe("workspace.provision", () => {
  it("refuses a person, even the workspace owner, and creates nothing", async () => {
    const wb = await workerDb();
    const before = await count("workspaces");
    for (const userId of [OWNER, MEMBER]) {
      await expect(
        callAction(
          { ...context(userId), pool: wb.appPool },
          "workspace.provision",
          {
            user: { id: MEMBER, name: "Ordinary Member" },
            name: "Made through the surface",
          },
        ),
      ).rejects.toThrow(/signs up/);
    }
    expect(await count("workspaces")).toBe(before);
  });

  it("is refused on the agent endpoint", async () => {
    const wb = await workerDb();
    const before = await count("workspaces");
    const result = await dispatchTool(
      wb.appPool,
      { workspaceId, userId: MEMBER, scopes: ["read", "write", "destructive"] },
      "workspace.provision",
      { user: { id: MEMBER, name: "Ordinary Member" } },
    );
    // Not even a tool since mcp-toolsets.md §2.2; the handler refuses it too.
    expect(result.isError).toBe(true);
    expect(result.text).toBe('There is no tool called "workspace.provision".');
    expect(await count("workspaces")).toBe(before);
  });
});

describe("imports.previewTable and imports.runTable", () => {
  it("refuse a member below full before anything is recorded", async () => {
    const wb = await workerDb();
    for (const name of ["imports.previewTable", "imports.runTable"] as const) {
      await expect(
        callAction({ ...context(MEMBER), pool: wb.appPool }, name, TABLE),
      ).rejects.toThrow(`${name} needs a higher access level than you hold.`);
    }
    expect(await count("import_runs")).toBe(0);
    expect(await count("goals")).toBe(0);
  });

  it("let the owner through to the table itself", async () => {
    const wb = await workerDb();
    // The table lacks the template's required columns, so the owner's call
    // fails on the content rather than on access.
    await expect(
      callAction(
        { ...context(OWNER), pool: wb.appPool },
        "imports.previewTable",
        TABLE,
      ),
    ).rejects.toThrow(/template needs/);
  });
});
