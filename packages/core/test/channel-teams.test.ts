import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import {
  openConnection,
  parseTeamsSecret,
  rememberConnectionConfig,
} from "../src/channels/connections.ts";
import { workspaceForProviderTeam } from "../src/channels/inbound.ts";
import { routeCommand } from "../src/channels/router.ts";
import { parseKeyRing } from "../src/secrets/key-ring.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Teams on the shared path (P5-T03a).
 *
 * **What this file exists to prove is that almost nothing is Teams-specific.**
 * The installation lookup, the command router, the access check and the audit
 * row are the same code Slack and Telegram reach; a third provider that needed
 * its own copies of any of them would mean the design in
 * `docs/design/p5-t00-channel-design.md` had not held. The acceptance criterion
 * is the last test: the same command, refused or acted on the same way, with the
 * channel named on the audit row.
 *
 * The driver's own half, the Bot Framework calls and the token verification, is
 * `packages/adapters/test/channel-teams.test.ts`.
 */

const MEMBER = "teams-member";
const TENANT = "72f988bf-1111-2222-3333-444444444444";

let workspaceId: string;
let memberId: string;

const ring = parseKeyRing({
  current: Buffer.alloc(32, 7).toString("base64"),
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
      provider: "teams",
      credentials: JSON.stringify({
        appId: "11111111-2222-3333-4444-555555555555",
        appPassword: "a-secret-nobody-should-see",
      }),
      config: { teamId: TENANT },
    },
  );
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [MEMBER, "Member", "teams-member@example.com"],
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
  it("stores the credentials encrypted, and reads them back as a Teams secret", async () => {
    const wb = await workerDb();
    await connect();

    const rows = await wb.admin.query(
      "select ciphertext, config from channel_connections where workspace_id = $1 and provider = 'teams'",
      [workspaceId],
    );
    expect(rows.rows).toHaveLength(1);
    // Not the secret, and not the application id either.
    expect(rows.rows[0].ciphertext).not.toContain("a-secret-nobody-should-see");

    const opened = await openConnection(wb.appPool, ring, {
      workspaceId,
      provider: "teams",
    });
    const parsed = opened ? parseTeamsSecret(opened.secret) : null;
    expect(parsed?.appId).toBe("11111111-2222-3333-4444-555555555555");
    expect(parsed?.appPassword).toBe("a-secret-nobody-should-see");
  });

  it("refuses a stored string that is not a Teams secret", () => {
    expect(parseTeamsSecret("not json")).toBeNull();
    expect(parseTeamsSecret(JSON.stringify({ appId: "only-one" }))).toBeNull();
    expect(
      parseTeamsSecret(JSON.stringify({ botToken: "x", signingSecret: "y" })),
    ).toBeNull();
  });

  it("finds the workspace from the directory tenant, before a tenant is known", async () => {
    const wb = await workerDb();
    await connect();

    // The same lookup Slack uses, with a different provider. An inbound
    // activity has no session and no workspace; this is what gives it one.
    expect(
      await workspaceForProviderTeam(wb.appPool, {
        provider: "teams",
        teamId: TENANT,
      }),
    ).toBe(workspaceId);
    expect(
      await workspaceForProviderTeam(wb.appPool, {
        provider: "teams",
        teamId: "some-other-directory",
      }),
    ).toBeNull();
  });
});

describe("the service URL, which is the one thing Teams needs and nothing else does", () => {
  it("is recorded from an inbound activity and read back for outbound", async () => {
    const wb = await workerDb();
    await connect();

    await rememberConnectionConfig(wb.appPool, {
      workspaceId,
      provider: "teams",
      patch: { serviceUrl: "https://smba.trafficmanager.net/emea/" },
    });

    const opened = await openConnection(wb.appPool, ring, {
      workspaceId,
      provider: "teams",
    });
    expect(opened?.config.serviceUrl).toBe(
      "https://smba.trafficmanager.net/emea/",
    );
    // And the tenant it was connected with is still there beside it.
    expect(opened?.config.teamId).toBe(TENANT);
  });

  it("does not touch the row when nothing moved", async () => {
    const wb = await workerDb();
    await connect();
    const patch = { serviceUrl: "https://smba.trafficmanager.net/emea/" };

    await rememberConnectionConfig(wb.appPool, {
      workspaceId,
      provider: "teams",
      patch,
    });
    const first = await wb.admin.query(
      "select updated_at from channel_connections where workspace_id = $1 and provider = 'teams'",
      [workspaceId],
    );

    await rememberConnectionConfig(wb.appPool, {
      workspaceId,
      provider: "teams",
      patch,
    });
    const second = await wb.admin.query(
      "select updated_at from channel_connections where workspace_id = $1 and provider = 'teams'",
      [workspaceId],
    );

    // Every inbound message would otherwise write the same value again.
    expect(second.rows[0].updated_at).toEqual(first.rows[0].updated_at);
  });

  it("says nothing for a provider that is not connected", async () => {
    const wb = await workerDb();
    await expect(
      rememberConnectionConfig(wb.appPool, {
        workspaceId,
        provider: "teams",
        patch: { serviceUrl: "https://x.example" },
      }),
    ).resolves.toBeUndefined();
  });
});

describe("the command surface", () => {
  const say = async (text: string) => {
    const wb = await workerDb();
    return routeCommand({
      pool: wb.appPool,
      workspaceId,
      provider: "teams",
      memberId,
      userId: MEMBER,
      text,
      now: new Date(),
    });
  };

  it("answers help from the same catalogue every provider reads", async () => {
    const reply = await say("help");
    expect(reply.text).toContain("checkin");
    expect(reply.text).toContain("blocker");
    expect(reply.text).toContain("snooze");
  });

  it("names what it has when the command is not one", async () => {
    const reply = await say("deploy the thing");
    expect(reply.kind).toBe("reply");
    expect(reply.text).toContain("deploy");
  });

  /**
   * The acceptance criterion, in the words the task states it.
   */
  it("acts on a command exactly as Slack would, with the channel audited (acceptance)", async () => {
    const wb = await workerDb();

    // A nudge to snooze, so there is something real to act on. Written
    // directly rather than through the due engine: what this test is about is
    // the provider, and `chat-commands.test.ts` already proves the whole
    // rhythm path for Slack.
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
    // The channel, put there once by the Operation pipeline rather than by any
    // action remembering to. This is the whole claim of the third provider.
    expect((audited.rows[0].payload as Record<string, unknown>).channel).toBe(
      "teams",
    );
  });
});
