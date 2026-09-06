import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { buildMessage } from "../src/channels/builder.ts";
import {
  openConnection,
  parseWhatsAppSecret,
} from "../src/channels/connections.ts";
import { workspaceForProviderTeam } from "../src/channels/inbound.ts";
import { routeCommand } from "../src/channels/router.ts";
import { parseKeyRing } from "../src/secrets/key-ring.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * WhatsApp on the shared path (P5-T04a).
 *
 * The fourth provider, and again nothing in `packages/core` needed changing to
 * add it: the installation lookup, the router, the access check and the audit
 * row are the code the other three reach. The acceptance criterion is the last
 * test.
 *
 * The driver's own half, the Cloud API calls and the signature, is
 * `packages/adapters/test/channel-whatsapp.test.ts`. The conversation window,
 * which is the only thing about this provider that is genuinely its own, is
 * P5-T04b.
 */

const MEMBER = "whatsapp-member";
const PHONE_NUMBER_ID = "123456789012345";

let workspaceId: string;
let memberId: string;

const ring = parseKeyRing({
  current: Buffer.alloc(32, 9).toString("base64"),
  previous: [],
});

const asMember = () => ({
  workspaceId,
  actor: { kind: "human" as const, userId: MEMBER },
});

const connect = async () => {
  const wb = await workerDb();
  return callAction(
    { pool: wb.appPool, ...asMember(), ring },
    "channels.connect",
    {
      provider: "whatsapp",
      credentials: JSON.stringify({
        accessToken: "a-permanent-token-nobody-should-see",
        appSecret: "an-app-secret-nobody-should-see",
        verifyToken: "the-token-the-admin-chose",
      }),
      config: { teamId: PHONE_NUMBER_ID },
    },
  );
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [MEMBER, "Member", "whatsapp-member@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: MEMBER,
    name: "Member",
  });
  workspaceId = provisioned.workspaceId;
  const member = await wb.admin.query(
    "select id from workspace_members where workspace_id = $1 and user_id = $2",
    [workspaceId, MEMBER],
  );
  memberId = member.rows[0].id as string;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("connecting", () => {
  it("stores three credentials encrypted, and reads them back", async () => {
    const wb = await workerDb();
    await connect();

    const rows = await wb.admin.query(
      "select ciphertext from channel_connections where workspace_id = $1 and provider = 'whatsapp'",
      [workspaceId],
    );
    expect(rows.rows).toHaveLength(1);
    const ciphertext = rows.rows[0].ciphertext as string;
    expect(ciphertext).not.toContain("a-permanent-token-nobody-should-see");
    expect(ciphertext).not.toContain("an-app-secret-nobody-should-see");
    expect(ciphertext).not.toContain("the-token-the-admin-chose");

    const opened = await openConnection(wb.appPool, ring, {
      workspaceId,
      provider: "whatsapp",
    });
    const parsed = opened ? parseWhatsAppSecret(opened.secret) : null;
    expect(parsed?.accessToken).toBe("a-permanent-token-nobody-should-see");
    expect(parsed?.appSecret).toBe("an-app-secret-nobody-should-see");
    expect(parsed?.verifyToken).toBe("the-token-the-admin-chose");
  });

  it("refuses a stored string missing any of the three", () => {
    expect(parseWhatsAppSecret("not json")).toBeNull();
    expect(
      parseWhatsAppSecret(JSON.stringify({ accessToken: "a", appSecret: "b" })),
    ).toBeNull();
    // A Teams secret is not a WhatsApp one, and parsing is what says so.
    expect(
      parseWhatsAppSecret(JSON.stringify({ appId: "a", appPassword: "b" })),
    ).toBeNull();
  });

  it("finds the workspace from the business number, before a tenant is known", async () => {
    const wb = await workerDb();
    await connect();

    expect(
      await workspaceForProviderTeam(wb.appPool, {
        provider: "whatsapp",
        teamId: PHONE_NUMBER_ID,
      }),
    ).toBe(workspaceId);
    expect(
      await workspaceForProviderTeam(wb.appPool, {
        provider: "whatsapp",
        teamId: "999999999999999",
      }),
    ).toBeNull();
  });

  it("keeps the business number where outbound can find it", async () => {
    const wb = await workerDb();
    await connect();
    const opened = await openConnection(wb.appPool, ring, {
      workspaceId,
      provider: "whatsapp",
    });
    // A reply is sent *from* this number, and the body's copy of it is only
    // what routed the request in.
    expect(opened?.config.teamId).toBe(PHONE_NUMBER_ID);
  });
});

describe("what the builder makes of a message for this provider", () => {
  it("folds the actions into the text as the words to reply", () => {
    const message = buildMessage(
      {
        text: "A dependency blocker has been open for 26 hours.",
        blocks: [{ type: "FactSet", facts: [] }],
        buttons: [
          { label: "Resolve", url: "okr:resolve abc" },
          { label: "Open the board", url: "https://okr.example/spaces/1" },
        ],
      },
      "whatsapp",
    );

    // No buttons and no cards on this provider, so both degrade. What arrives
    // is the instruction a person can literally follow here.
    expect(message.buttons).toBeUndefined();
    expect(message.blocks).toBeUndefined();
    expect(message.text).toContain('Resolve: reply "resolve abc"');
    expect(message.text).toContain("Open the board: https://okr.example");
    expect(message.degraded).toEqual([
      "whatsapp has no rich cards, so the blocks were dropped",
      "whatsapp has no buttons, so they were appended as links",
    ]);
  });

  it("refuses to send outside the window with no template, and says so", () => {
    // The window itself is P5-T04b. The builder has known how to answer this
    // since P5-T01b-b, and this is the assertion that it still does.
    const message = buildMessage(
      { text: "Your check-in is due." },
      "whatsapp",
      { insideConversationWindow: false },
    );
    expect(message.text).toBe("");
    expect(message.degraded[0]).toContain("needs an approved template");
  });

  it("sends the template and drops the body outside the window", () => {
    const message = buildMessage(
      { text: "Your check-in is due.", templateKey: "checkin_due" },
      "whatsapp",
      { insideConversationWindow: false },
    );
    expect(message.templateKey).toBe("checkin_due");
    expect(message.text).toBe("");
  });
});

describe("the command surface", () => {
  const say = async (text: string) => {
    const wb = await workerDb();
    return routeCommand({
      pool: wb.appPool,
      workspaceId,
      provider: "whatsapp",
      memberId,
      userId: MEMBER,
      text,
      now: new Date(),
    });
  };

  it("answers help from the same catalogue every provider reads", async () => {
    const reply = await say("help");
    expect(reply.text).toContain("checkin");
    expect(reply.text).toContain("resolve");
  });

  /**
   * The acceptance criterion, in the words the task states it.
   */
  it("acts on a command exactly as Slack would, with the channel audited (acceptance)", async () => {
    const wb = await workerDb();
    const nudge = await wb.admin.query<{ id: string }>(
      `insert into nudges
         (id, workspace_id, kind, subject_type, subject_id, recipient_member_id,
          rule_key, channel, scheduled_for)
       values (gen_random_uuid(), $1, 'rhythm', 'goal', gen_random_uuid(), $2,
               'R-CHECKIN-DUE', 'in_app', now())
       returning id`,
      [workspaceId, memberId],
    );
    const nudgeId = nudge.rows[0]?.id as string;

    const reply = await say(`snooze ${nudgeId} 24`);
    expect(reply.kind).toBe("done");

    const snoozed = await wb.admin.query(
      "select snoozed_until from nudges where id = $1",
      [nudgeId],
    );
    expect(snoozed.rows[0]?.snoozed_until).not.toBeNull();

    const audited = await wb.admin.query(
      "select payload from audit_events where workspace_id = $1 and action = 'nudges.snooze'",
      [workspaceId],
    );
    expect(audited.rows).toHaveLength(1);
    expect((audited.rows[0].payload as Record<string, unknown>).channel).toBe(
      "whatsapp",
    );
  });
});
