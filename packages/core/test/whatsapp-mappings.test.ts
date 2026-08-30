import { withWorkspace } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import {
  replyCommandFor,
  resolveBindings,
} from "../src/channels/template-bindings.ts";
import {
  CONVERSATION_WINDOW_MS,
  insideConversationWindow,
  whatsAppEnvelope,
} from "../src/channels/whatsapp-window.ts";
import { parseKeyRing } from "../src/secrets/key-ring.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Which template answers which reminder, and when one is needed (P5-T04b-b).
 *
 * Three properties, and each of them is a different way the same reminder fails
 * to arrive:
 *
 * | Property | What it stops |
 * |---|---|
 * | The count is checked when the mapping is saved | Meta refusing a send at seven in the morning |
 * | A withdrawn or unapproved template stops resolving | A mapping that looks fine and silently sends nothing |
 * | The window is read from the member's own last message | A free-form send Meta bounces |
 */

const ADMIN = "mapping-admin";
const PHONE_NUMBER_ID = "123456789012345";

let workspaceId: string;
let memberId: string;

const ring = parseKeyRing({
  current: Buffer.alloc(32, 12).toString("base64"),
  previous: [],
});

const context = async () => {
  const wb = await workerDb();
  return {
    pool: wb.appPool,
    workspaceId,
    actor: { kind: "human" as const, userId: ADMIN },
    ring,
  };
};

const sync = async (templates: Record<string, unknown>[]) =>
  callAction(await context(), "channels.syncTemplates", {
    templates: templates as never,
  });

const templateNamed = async (name: string) => {
  const { templates } = await callAction(
    await context(),
    "channels.templates",
    {},
  );
  const found = templates.find((row) => row.name === name);
  if (!found) {
    throw new Error(`no template named ${name}`);
  }
  return found;
};

const save = async (ruleKey: string, templateId: string, bindings: string[]) =>
  callAction(await context(), "channels.saveTemplateMapping", {
    ruleKey,
    templateId,
    bindings,
  });

const mappings = async () =>
  (await callAction(await context(), "channels.templateMappings", {})).mappings;

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [ADMIN, "Ada", "mapping-admin@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: ADMIN,
    name: "Ada",
  });
  workspaceId = provisioned.workspaceId;
  memberId = provisioned.memberId;

  await callAction(await context(), "channels.connect", {
    provider: "whatsapp",
    credentials: JSON.stringify({
      accessToken: "a-token",
      appSecret: "a-secret",
      verifyToken: "a-verify-token",
    }),
    config: { teamId: PHONE_NUMBER_ID },
  });

  await sync([
    {
      metaId: "meta-1",
      name: "checkin_due",
      language: "en",
      status: "APPROVED",
      category: "UTILITY",
      bodyText: "Hi {{1}}, your check-in is due. Reply {{2}}.",
      variables: 2,
    },
    {
      metaId: "meta-2",
      name: "not_yet",
      language: "en",
      status: "PENDING",
      category: "UTILITY",
      bodyText: "Hello {{1}}.",
      variables: 1,
    },
  ]);
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("saving a mapping", () => {
  it("saves one source per placeholder and reads it back", async () => {
    const template = await templateNamed("checkin_due");
    await save("checkin.due", template.id, ["member.name", "reply.command"]);

    const [stored] = await mappings();
    expect(stored?.ruleKey).toBe("checkin.due");
    expect(stored?.templateName).toBe("checkin_due");
    expect(stored?.withdrawn).toBe(false);
    expect(stored?.bindings).toEqual(["member.name", "reply.command"]);
  });

  it("refuses a source count that does not match the template", async () => {
    const template = await templateNamed("checkin_due");
    await expect(
      save("checkin.due", template.id, ["member.name"]),
    ).rejects.toThrow(/2 variables/);
    expect(await mappings()).toHaveLength(0);
  });

  it("refuses a template Meta has not approved", async () => {
    const template = await templateNamed("not_yet");
    await expect(
      save("checkin.due", template.id, ["member.name"]),
    ).rejects.toThrow(/not approved/i);
  });

  it("refuses a source this product cannot fill in", async () => {
    const template = await templateNamed("checkin_due");
    await expect(
      save("checkin.due", template.id, ["member.name", "member.salary"]),
    ).rejects.toThrow(/member\.salary/);
  });

  it("replaces the mapping for a rule rather than adding a second", async () => {
    const template = await templateNamed("checkin_due");
    await save("checkin.due", template.id, ["member.name", "reply.command"]);
    await save("checkin.due", template.id, ["workspace.name", "rule.key"]);

    const all = await mappings();
    expect(all).toHaveLength(1);
    expect(all[0]?.bindings).toEqual(["workspace.name", "rule.key"]);
  });

  it("removes a mapping, and refuses to remove one that is not there", async () => {
    const template = await templateNamed("checkin_due");
    await save("checkin.due", template.id, ["member.name", "reply.command"]);

    await callAction(await context(), "channels.removeTemplateMapping", {
      ruleKey: "checkin.due",
    });
    expect(await mappings()).toHaveLength(0);

    await expect(
      callAction(await context(), "channels.removeTemplateMapping", {
        ruleKey: "checkin.due",
      }),
    ).rejects.toThrow(/no template mapped/);
  });
});

describe("a mapping whose template Meta withdrew", () => {
  it("keeps the mapping, says so, and stops resolving", async () => {
    const template = await templateNamed("checkin_due");
    await save("checkin.due", template.id, ["member.name", "reply.command"]);

    // Meta stops listing it. The administrator's decision survives.
    await sync([
      {
        metaId: "meta-2",
        name: "not_yet",
        language: "en",
        status: "PENDING",
        category: "UTILITY",
        bodyText: "Hello {{1}}.",
        variables: 1,
      },
    ]);

    const [stored] = await mappings();
    expect(stored?.ruleKey).toBe("checkin.due");
    expect(stored?.withdrawn).toBe(true);

    const wb = await workerDb();
    const envelope = await withWorkspace(
      drizzle(wb.appPool),
      workspaceId,
      (tx) =>
        whatsAppEnvelope(tx, {
          workspaceId,
          memberId,
          ruleKey: "checkin.due",
          subjectType: "goal",
          subjectId: memberId,
          now: new Date(),
        }),
    );
    expect(envelope.templateKey).toBeUndefined();
  });
});

describe("the conversation window", () => {
  const identity = async (lastInboundAt: Date | null) => {
    const wb = await workerDb();
    await wb.admin.query(
      `insert into channel_identities
         (id, workspace_id, member_id, provider, external_id, last_inbound_at)
       values (gen_random_uuid(), $1, $2, 'whatsapp', '447700900000', $3)`,
      [workspaceId, memberId, lastInboundAt],
    );
  };

  const inside = async (now: Date) => {
    const wb = await workerDb();
    return withWorkspace(drizzle(wb.appPool), workspaceId, (tx) =>
      insideConversationWindow(tx, { workspaceId, memberId, now }),
    );
  };

  it("is closed for a member who has never written in", async () => {
    await identity(null);
    expect(await inside(new Date())).toBe(false);
  });

  it("is open just inside twenty-four hours and closed just outside", async () => {
    const wrote = new Date("2026-03-01T09:00:00Z");
    await identity(wrote);

    expect(
      await inside(new Date(wrote.getTime() + CONVERSATION_WINDOW_MS - 1)),
    ).toBe(true);
    expect(
      await inside(new Date(wrote.getTime() + CONVERSATION_WINDOW_MS)),
    ).toBe(false);
  });

  it("sends the body inside the window and never looks a template up", async () => {
    await identity(new Date());
    const wb = await workerDb();
    const envelope = await withWorkspace(
      drizzle(wb.appPool),
      workspaceId,
      (tx) =>
        whatsAppEnvelope(tx, {
          workspaceId,
          memberId,
          ruleKey: "checkin.due",
          subjectType: "goal",
          subjectId: memberId,
          now: new Date(),
        }),
    );
    expect(envelope).toEqual({ insideConversationWindow: true });
  });
});

describe("what fills a placeholder", () => {
  it("never resolves to an empty string, because Meta refuses one", () => {
    const values = resolveBindings(
      ["member.name", "workspace.name", "subject.title", "reply.command"],
      {
        memberName: null,
        workspaceName: null,
        subjectTitle: null,
        ruleKey: "digest.weekly",
        subjectType: "workspace",
        subjectId: "w-1",
      },
    );
    expect(values).toEqual(["you", "your workspace", "your goal", "help"]);
  });

  it("carries the identifier, which is the only way a phone can answer", () => {
    expect(
      replyCommandFor({
        memberName: "Ada",
        workspaceName: "Acme",
        subjectTitle: "Ship it",
        ruleKey: "checkin.due",
        subjectType: "goal",
        subjectId: "g-1",
      }),
    ).toBe("checkin g-1");
    expect(
      replyCommandFor({
        memberName: "Ada",
        workspaceName: "Acme",
        subjectTitle: "Waiting on legal",
        ruleKey: "blocker.overdue",
        subjectType: "blocker",
        subjectId: "b-1",
      }),
    ).toBe("resolve b-1");
  });
});
