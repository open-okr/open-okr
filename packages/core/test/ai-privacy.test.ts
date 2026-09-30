import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bindGroup, ensureMemberGroup } from "../src/access/contexts.ts";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import { resolveSubjectContext } from "../src/access/reads.ts";
import { callAction } from "../src/actions/registry.ts";
import { PRIVATE_ACTIVITY_KINDS } from "../src/activities/catalogue.ts";
import {
  recordAIEgressWithheld,
  resolveAIPrivacySettings,
} from "../src/ai/egress.ts";
import { runOperation } from "../src/operations/operation.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The privacy card's settings and the record of what they did (completeness
 * review M-10).
 *
 * The card was static text. These prove its other half: the four controls
 * resolve to a working default on every workspace, a save is read back
 * exactly and audited, only an administrator reaches either, and what a
 * control withheld is written down without the text it withheld.
 */

const OWNER = "ai-privacy-owner";
const MEMBER = "ai-privacy-member";

let workspaceId: string;

const context = (actorUserId: string) => ({
  workspaceId,
  actor: { kind: "human" as const, userId: actorUserId },
});

const DEFAULTS = {
  contextEgress: "all",
  redactPersonalData: true,
  noTraining: false,
  allowedHosts: [],
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

async function auditRows(action: string) {
  const wb = await workerDb();
  const result = await wb.admin.query<{
    actor_kind: string;
    payload: Record<string, unknown>;
  }>(
    "select actor_kind, payload from audit_events where workspace_id = $1 and action = $2 order by at",
    [workspaceId, action],
  );
  return result.rows;
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "AI Privacy Owner", `${OWNER}@example.com`],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "AI Privacy Owner",
  });
  workspaceId = provisioned.workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the four controls' defaults", () => {
  it("resolve on a fresh workspace to what today's behaviour needs, redaction on", async () => {
    const wb = await workerDb();
    expect(
      await callAction(
        { ...context(OWNER), pool: wb.appPool },
        "ai.readPrivacySettings",
        {},
      ),
    ).toEqual(DEFAULTS);
    expect(await resolveAIPrivacySettings(wb.appPool, workspaceId)).toEqual(
      DEFAULTS,
    );
  });

  it("resolve the same on a workspace provisioned before they existed", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      `update workspaces
          set settings = settings - 'aiContextEgress' - 'aiRedactPersonalData'
                                  - 'aiNoTraining' - 'aiEgressAllowList'
        where id = $1`,
      [workspaceId],
    );
    expect(await resolveAIPrivacySettings(wb.appPool, workspaceId)).toEqual(
      DEFAULTS,
    );
  });

  it("fall back to the default for a stored value that no longer parses", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      `update workspaces
          set settings = settings || '{"aiContextEgress": "sometimes", "aiEgressAllowList": ["not a host"]}'::jsonb
        where id = $1`,
      [workspaceId],
    );
    const resolved = await resolveAIPrivacySettings(wb.appPool, workspaceId);
    expect(resolved.contextEgress).toBe("all");
    expect(resolved.allowedHosts).toEqual([]);
  });
});

describe("saving the card", () => {
  it("is read back exactly, and audited with what changed", async () => {
    const wb = await workerDb();
    const call = { ...context(OWNER), pool: wb.appPool };
    await callAction(call, "ai.updatePrivacySettings", {
      contextEgress: "assists",
      redactPersonalData: false,
      noTraining: true,
      allowedHosts: ["API.Anthropic.com", "openrouter.ai", "api.anthropic.com"],
    });

    const expected = {
      contextEgress: "assists",
      redactPersonalData: false,
      noTraining: true,
      // Lower case, and once each.
      allowedHosts: ["api.anthropic.com", "openrouter.ai"],
    };
    expect(await callAction(call, "ai.readPrivacySettings", {})).toEqual(
      expected,
    );
    // And the host that builds a provider reads the same thing.
    expect(await resolveAIPrivacySettings(wb.appPool, workspaceId)).toEqual(
      expected,
    );

    const [audit] = await auditRows("ai.updatePrivacySettings");
    expect(audit?.actor_kind).toBe("human");
    expect(audit?.payload).toEqual({
      aiContextEgress: "assists",
      aiRedactPersonalData: false,
      aiNoTraining: true,
      aiEgressAllowList: ["api.anthropic.com", "openrouter.ai"],
    });
  });

  it("changes only what it is given", async () => {
    const wb = await workerDb();
    const call = { ...context(OWNER), pool: wb.appPool };
    await callAction(call, "ai.updatePrivacySettings", {
      allowedHosts: ["api.openai.com"],
    });
    expect(await callAction(call, "ai.readPrivacySettings", {})).toEqual({
      ...DEFAULTS,
      allowedHosts: ["api.openai.com"],
    });
  });

  it("refuses something that is not a host, and stores nothing", async () => {
    const wb = await workerDb();
    const call = { ...context(OWNER), pool: wb.appPool };
    await expect(
      callAction(call, "ai.updatePrivacySettings", {
        allowedHosts: ["https://api.openai.com/v1"],
      }),
    ).rejects.toThrow(/not a host name/);
    expect(await callAction(call, "ai.readPrivacySettings", {})).toEqual(
      DEFAULTS,
    );
  });

  it("is reset as one card by the general reset", async () => {
    const wb = await workerDb();
    const call = { ...context(OWNER), pool: wb.appPool };
    await callAction(call, "ai.updatePrivacySettings", {
      contextEgress: "none",
      redactPersonalData: false,
    });
    await callAction(call, "settings.resetWorkspaceSettings", {
      card: "aiPrivacy",
    });
    expect(await callAction(call, "ai.readPrivacySettings", {})).toEqual(
      DEFAULTS,
    );
  });

  it("is an administrator's decision: a member with edit reaches neither half", async () => {
    await addEditMember();
    const wb = await workerDb();
    const call = { ...context(MEMBER), pool: wb.appPool };
    await expect(
      callAction(call, "ai.readPrivacySettings", {}),
    ).rejects.toThrow();
    await expect(
      callAction(call, "ai.updatePrivacySettings", { contextEgress: "all" }),
    ).rejects.toThrow();
    expect(await auditRows("ai.updatePrivacySettings")).toEqual([]);
  });
});

describe("the record of what a control did", () => {
  it("is an audit row of counts and a host, never the text", async () => {
    const wb = await workerDb();
    await recordAIEgressWithheld(wb.appPool, {
      workspaceId,
      provider: "openrouter",
      host: "openrouter.ai",
      purpose: "assist",
      outcome: "redacted",
      emails: 2,
      phones: 1,
    });
    await recordAIEgressWithheld(wb.appPool, {
      workspaceId,
      provider: "openai",
      host: "api.openai.com",
      purpose: "retrieval",
      outcome: "refused",
      reason: "context_withheld",
      emails: 0,
      phones: 0,
    });

    const rows = await auditRows("ai.egressWithheld");
    expect(rows.map((row) => row.payload)).toEqual([
      {
        provider: "openrouter",
        host: "openrouter.ai",
        purpose: "assist",
        outcome: "redacted",
        emails: 2,
        phones: 1,
      },
      {
        provider: "openai",
        host: "api.openai.com",
        purpose: "retrieval",
        outcome: "refused",
        reason: "context_withheld",
        emails: 0,
        phones: 0,
      },
    ]);
    expect(rows.every((row) => row.actor_kind === "system")).toBe(true);
  });

  it("stays out of the workspace feed, because the request was one member's", () => {
    expect(PRIVATE_ACTIVITY_KINDS.has("ai.egress_withheld")).toBe(true);
  });
});
