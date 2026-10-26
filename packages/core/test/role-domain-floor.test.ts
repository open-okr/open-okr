import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bindGroup, ensureMemberGroup } from "../src/access/contexts.ts";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import { resolveSubjectContext } from "../src/access/reads.ts";
import { callAction } from "../src/actions/registry.ts";
import { runOperation } from "../src/operations/operation.ts";
import type { RichTextDocument } from "../src/rich-text/schema.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * A write that creates in a domain asks the role for that domain
 * (docs/design/workspace-roles.md §11, MCP UAT BUG-002).
 *
 * Every member holds `edit` on the workspace's own context for self-service,
 * and a write that named no subject was measured there, so a Viewer created
 * comments and KPIs. These hold the acceptance criteria of §11.
 */

const OWNER = "role-domain-owner";
const PERSON = "role-domain-person";

let workspaceId: string;
let cycleId: string;

const as = async (userId: string) => ({
  pool: (await workerDb()).appPool,
  workspaceId,
  actor: { kind: "human" as const, userId },
});

/** A member as an invitation leaves one: `edit` on the workspace context. */
async function addMember(role: "member" | "viewer"): Promise<void> {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [PERSON, "Role Domain Person", `${PERSON}@example.com`],
  );
  const inserted = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, kind, status, role_id)
     values (gen_random_uuid(), $1, $2, 'Role Domain Person', 'human', 'active',
             (select id from workspace_roles where workspace_id = $1 and builtin_key = $3))
     returning id`,
    [workspaceId, PERSON, role],
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

const hi: RichTextDocument = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }],
};

const comment = () => ({
  subjectType: "cycle" as const,
  subjectId: cycleId,
  body: hi,
});

const kpi = {
  title: "Setup completion rate",
  indicatorType: "lagging" as const,
  aggregate: "sum" as const,
  ownerKind: "workspace" as const,
  frequency: "monthly" as const,
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Role Domain Owner", `${OWNER}@example.com`],
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, {
      id: OWNER,
      name: "Role Domain Owner",
    })
  ).workspaceId;
  const cycle = await callAction(await as(OWNER), "cycles.ensureCurrent", {});
  cycleId = (cycle as { id: string }).id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
});

describe("a member holding Viewer", () => {
  beforeEach(() => addMember("viewer"));

  it("cannot comment, though the workspace binding grants edit", async () => {
    await expect(
      callAction(await as(PERSON), "comments.create", comment()),
    ).rejects.toThrow(
      "comments.create needs a higher access level than you hold.",
    );
  });

  it("cannot create a KPI", async () => {
    await expect(
      callAction(await as(PERSON), "kpis.create", kpi),
    ).rejects.toThrow("kpis.create needs a higher access level than you hold.");
  });

  it("still serves themself", async () => {
    await expect(
      callAction(await as(PERSON), "people.updateOwnProfile", {
        timezone: "Asia/Jakarta",
      }),
    ).resolves.toBeDefined();
  });
});

describe("a member holding Member", () => {
  beforeEach(() => addMember("member"));

  it("comments and creates a KPI as before", async () => {
    await expect(
      callAction(await as(PERSON), "comments.create", comment()),
    ).resolves.toBeDefined();
    await expect(
      callAction(await as(PERSON), "kpis.create", kpi),
    ).resolves.toBeDefined();
  });
});
