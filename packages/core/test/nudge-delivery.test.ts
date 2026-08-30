import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { routeCommand } from "../src/channels/router.ts";
import { parseKeyRing } from "../src/secrets/key-ring.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Nudge delivery: where a message goes and what happens when it cannot get
 * there (AI-NATIVE-PLAN.md §5.4, P5-T01b-b).
 *
 * The acceptance criterion is the last test: a member whose primary channel is
 * unreachable gets the message by email, the fallback is on the log row, and
 * they are told once that their channel needs reconnecting however many nudges
 * fail that day.
 *
 * Everything is driven through `nudges.run` with an explicit `now`, because the
 * engine never reads a clock and that is what makes a fortnight testable in a
 * second.
 */

const OWNER = "delivery-owner";
const SECOND = "delivery-second";

let workspaceId: string;
let ownerMemberId: string;
let secondMemberId: string;
let goalId: string;
let dueOn: string;

const ring = parseKeyRing({
  current: "5UB2Ez1oQ0Rr8sT1n5x7yWl4qKcM9vHfJbGdApXeZi0=",
});

const context = () => ({
  workspaceId,
  actor: { kind: "human" as const, userId: OWNER },
  ring,
});

const runAt = async (iso: string) => {
  const wb = await workerDb();
  return callAction({ pool: wb.appPool, ...context() }, "nudges.run", {
    now: iso,
  });
};

async function nudgeRows() {
  const wb = await workerDb();
  const found = await wb.admin.query(
    `select rule_key, channel, sent_at, scheduled_for, suppressed_reason
     from nudges where workspace_id = $1 order by rule_key`,
    [workspaceId],
  );
  return found.rows as Array<{
    rule_key: string;
    channel: string;
    sent_at: Date | null;
    scheduled_for: Date;
    suppressed_reason: string | null;
  }>;
}

async function messageRows() {
  const wb = await workerDb();
  const found = await wb.admin.query(
    "select provider, status, payload, idempotency_key from channel_messages where workspace_id = $1 order by created_at",
    [workspaceId],
  );
  return found.rows as Array<{
    provider: string;
    status: string;
    payload: Record<string, unknown>;
    idempotency_key: string;
  }>;
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [
      OWNER,
      "Owner",
      "delivery-owner@example.com",
      SECOND,
      "Second",
      "delivery-second@example.com",
    ],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;

  const member = await wb.admin.query(
    "select id from workspace_members where workspace_id = $1 and user_id = $2",
    [workspaceId, OWNER],
  );
  ownerMemberId = member.rows[0].id as string;
  const second = await wb.admin.query(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Second', 'active') returning id`,
    [workspaceId, SECOND],
  );
  secondMemberId = second.rows[0].id as string;

  // No quiet window unless a test sets one, so "now" means now. Both members,
  // because a goal has a champion and a reviewer and the ladder reaches both.
  await wb.admin.query(
    "update workspace_members set timezone = 'UTC', quiet_hours = null where workspace_id = $1",
    [workspaceId],
  );

  const cycle = await callAction(
    { pool: wb.appPool, ...context() },
    "cycles.current",
    { mode: "quarterly" },
  );
  const goal = (await callAction(
    { pool: wb.appPool, ...context() },
    "goals.create",
    {
      cycleId: cycle?.id as string,
      level: "company",
      title: "Become the preferred platform for mid-market teams",
      ownerKind: "workspace",
      championId: ownerMemberId,
      reviewerId: secondMemberId,
      weight: 1,
    },
  )) as { id: string };
  goalId = goal.id;
  const due = await wb.admin.query(
    "select (next_check_in_at at time zone 'UTC')::date::text as next from goals where id = $1",
    [goalId],
  );
  dueOn = due.rows[0].next as string;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("where a nudge goes", () => {
  it("takes email by default, and writes one message row per nudge", async () => {
    const result = await runAt(`${dueOn}T09:00:00Z`);
    expect(result.delivered).toBeGreaterThan(0);
    expect(result.toChannel).toBe(result.delivered);

    const messages = await messageRows();
    expect(messages.length).toBe(result.delivered);
    expect(messages.every((row) => row.provider === "email")).toBe(true);
    // The rule key travels with the message, which is what every proactive
    // message is required to carry.
    expect(String(messages[0]?.payload.text)).toMatch(/Rule: /);
  });

  it("sends nothing outside the product for a member who asked for in-app only", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set primary_channel = 'app' where id = $1",
      [ownerMemberId],
    );

    const result = await runAt(`${dueOn}T09:00:00Z`);
    expect(result.delivered).toBeGreaterThan(0);
    expect(result.toChannel).toBe(0);
    expect(await messageRows()).toEqual([]);

    // The inbox row is still written. §5.4: the channel is where the product
    // goes to find somebody; the product is where the obligation lives.
    const inbox = await wb.admin.query(
      "select count(*)::int as count from notifications where workspace_id = $1",
      [workspaceId],
    );
    expect(inbox.rows[0].count).toBeGreaterThan(0);
  });

  it("takes the primary channel once the workspace connects it and the member links it", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set primary_channel = 'slack' where id = $1",
      [ownerMemberId],
    );
    await callAction({ pool: wb.appPool, ...context() }, "channels.connect", {
      provider: "slack",
      credentials: "xoxb-token",
    });
    await callAction(
      { pool: wb.appPool, ...context() },
      "channels.linkIdentity",
      { provider: "slack", externalId: "U-owner" },
    );

    await runAt(`${dueOn}T09:00:00Z`);
    const messages = await messageRows();
    expect(messages.every((row) => row.provider === "slack")).toBe(true);
    expect((await nudgeRows())[0]?.channel).toBe("slack");
  });

  it("writes one message however many delivery passes run over one nudge", async () => {
    await runAt(`${dueOn}T09:00:00Z`);
    const first = await messageRows();
    // A second run an hour later. Deduplication stops a second nudge, and the
    // nudge's own id stops a second message for the one that already went.
    await runAt(`${dueOn}T10:00:00Z`);
    expect(await messageRows()).toHaveLength(first.length);
  });
});

describe("quiet hours defer rather than drop", () => {
  it("holds until the window ends and delivers in the morning", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      `update workspace_members
       set quiet_hours = '{"start":"22:00","end":"07:00"}'::jsonb
       where id = $1`,
      [ownerMemberId],
    );

    const night = await runAt(`${dueOn}T02:00:00Z`);
    expect(night.recorded).toBeGreaterThan(0);
    expect(night.delivered).toBe(0);
    expect(await messageRows()).toEqual([]);

    const held = (await nudgeRows())[0];
    expect(held?.suppressed_reason).toBeNull();
    expect(held?.sent_at).toBeNull();

    const morning = await runAt(`${dueOn}T08:00:00Z`);
    expect(morning.delivered).toBeGreaterThan(0);
    expect((await messageRows()).length).toBeGreaterThan(0);
  });
});

describe("a channel that cannot be reached", () => {
  /**
   * The acceptance criterion, in the words the task states it.
   */
  it("arrives by email, logs why, and tells the member once (acceptance)", async () => {
    const wb = await workerDb();
    // Their primary channel is Slack and they never linked an account, which
    // is the same state as a Slack identity that has been deactivated: the
    // product has nowhere to send it.
    await wb.admin.query(
      "update workspace_members set primary_channel = 'slack' where id = $1",
      [ownerMemberId],
    );
    await callAction({ pool: wb.appPool, ...context() }, "channels.connect", {
      provider: "slack",
      credentials: "xoxb-token",
    });

    await runAt(`${dueOn}T09:00:00Z`);

    // It arrived by email.
    const messages = await messageRows();
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.every((row) => row.provider === "email")).toBe(true);

    // The failure is on the row, in words rather than a code.
    expect(String(messages[0]?.payload.fallbackReason)).toMatch(
      /has not linked their slack account/,
    );

    // And they were told, once.
    const notices = (await nudgeRows()).filter(
      (row) => row.rule_key === "channel.reconnect_needed",
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]?.sent_at).not.toBeNull();
    expect(notices[0]?.channel).toBe("email");
  });

  it("tells them once a day however many nudges fall the same way", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set primary_channel = 'slack' where id = $1",
      [ownerMemberId],
    );

    await runAt(`${dueOn}T09:00:00Z`);
    await runAt(`${dueOn}T11:00:00Z`);
    await runAt(`${dueOn}T13:00:00Z`);

    const notices = (await nudgeRows()).filter(
      (row) => row.rule_key === "channel.reconnect_needed",
    );
    // Told once: one notice was delivered and the later runs were held against
    // it. §11's own deduplication does that work rather than a counter in the
    // channel code, which is why the held rows are here with a reason on them
    // rather than absent. A silence the product can explain is the point of
    // writing a row for a message it decided not to send.
    expect(notices.filter((row) => row.sent_at !== null)).toHaveLength(1);
    expect(
      notices.filter((row) => row.suppressed_reason === "dedup"),
    ).toHaveLength(2);
  });

  it("says nothing when the primary channel works", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set primary_channel = 'slack' where id = $1",
      [ownerMemberId],
    );
    await callAction({ pool: wb.appPool, ...context() }, "channels.connect", {
      provider: "slack",
      credentials: "xoxb-token",
    });
    await callAction(
      { pool: wb.appPool, ...context() },
      "channels.linkIdentity",
      { provider: "slack", externalId: "U-owner" },
    );

    await runAt(`${dueOn}T09:00:00Z`);
    expect(
      (await nudgeRows()).filter(
        (row) => row.rule_key === "channel.reconnect_needed",
      ),
    ).toEqual([]);
  });

  it("routes around a connection the last send broke", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set primary_channel = 'slack' where id = $1",
      [ownerMemberId],
    );
    await callAction({ pool: wb.appPool, ...context() }, "channels.connect", {
      provider: "slack",
      credentials: "xoxb-token",
    });
    await callAction(
      { pool: wb.appPool, ...context() },
      "channels.linkIdentity",
      { provider: "slack", externalId: "U-owner" },
    );
    // What the relay does to a connection whose send failed.
    await wb.admin.query(
      "update channel_connections set state = 'error', error = 'account_inactive' where workspace_id = $1",
      [workspaceId],
    );

    await runAt(`${dueOn}T09:00:00Z`);
    const messages = await messageRows();
    expect(messages.every((row) => row.provider === "email")).toBe(true);
    expect(String(messages[0]?.payload.fallbackReason)).toMatch(
      /not connected/,
    );
  });
});

/**
 * WhatsApp's conversation window (P5-T04b-b).
 *
 * The one provider with a clock on it. Inside twenty-four hours of the member's
 * own last message the ordinary body goes; outside it Meta carries only an
 * approved template, and a rule with none mapped reaches the inbox and stops
 * there rather than being sent as something Meta bounces.
 */
describe("WhatsApp outside the window", () => {
  const connectWhatsApp = async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set primary_channel = 'whatsapp' where id = $1",
      [ownerMemberId],
    );
    await callAction({ pool: wb.appPool, ...context() }, "channels.connect", {
      provider: "whatsapp",
      credentials: JSON.stringify({
        accessToken: "a-token",
        appSecret: "a-secret",
        verifyToken: "a-verify-token",
      }),
      config: { teamId: "123456789012345" },
    });
    await callAction(
      { pool: wb.appPool, ...context() },
      "channels.linkIdentity",
      { provider: "whatsapp", externalId: "447700900000" },
    );
  };

  const wroteInAt = async (at: string | null) => {
    const wb = await workerDb();
    await wb.admin.query(
      "update channel_identities set last_inbound_at = $1 where member_id = $2 and provider = 'whatsapp'",
      [at, ownerMemberId],
    );
  };

  const mapEveryRule = async (bindings: string[]) => {
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...context() },
      "channels.syncTemplates",
      {
        templates: [
          {
            metaId: "meta-1",
            name: "reminder",
            language: "en",
            status: "APPROVED",
            category: "UTILITY",
            bodyText: "Hi {{1}}, reply {{2}}.",
            variables: bindings.length,
          },
        ],
      },
    );
    const { templates } = await callAction(
      { pool: wb.appPool, ...context() },
      "channels.templates",
      {},
    );
    const templateId = templates[0]?.id as string;
    // Every rule the run could fire, because which one fires first is the
    // engine's business and this test is about the window.
    for (const rule of ["checkin.due_soon", "checkin.due", "checkin.overdue"]) {
      await callAction(
        { pool: wb.appPool, ...context() },
        "channels.saveTemplateMapping",
        { ruleKey: rule, templateId, bindings },
      );
    }
  };

  it("sends the body when the member wrote in an hour ago", async () => {
    await connectWhatsApp();
    await wroteInAt(`${dueOn}T08:00:00Z`);

    await runAt(`${dueOn}T09:00:00Z`);
    const messages = await messageRows();
    expect(messages.length).toBeGreaterThan(0);
    expect(String(messages[0]?.payload.text)).toMatch(/Rule: /);
    expect(messages[0]?.payload.templateKey).toBeUndefined();
  });

  it("sends the mapped template, filled in, when they have not", async () => {
    await connectWhatsApp();
    await wroteInAt(null);
    await mapEveryRule(["member.name", "reply.command"]);

    await runAt(`${dueOn}T09:00:00Z`);
    const messages = await messageRows();
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]?.payload.templateKey).toBe("reminder");
    // The name is the member's own, and the command carries the goal's id,
    // because a phone has no other way to know it.
    expect(messages[0]?.payload.templateParameters).toEqual([
      "Owner",
      `checkin ${goalId}`,
    ]);
    // The body is not sent beside it: Meta will not carry it.
    expect(messages[0]?.payload.text).toBe("");
  });

  it("writes the inbox row and queues nothing when no template is mapped", async () => {
    await connectWhatsApp();
    await wroteInAt(null);

    const result = await runAt(`${dueOn}T09:00:00Z`);
    expect(result.delivered).toBeGreaterThan(0);
    expect(await messageRows()).toEqual([]);

    const wb = await workerDb();
    const inbox = await wb.admin.query(
      "select count(*)::int as count from notifications where workspace_id = $1",
      [workspaceId],
    );
    expect(inbox.rows[0].count).toBeGreaterThan(0);
  });
});

/**
 * The acceptance criterion, end to end (P5-T04b-b).
 *
 * A member whose primary channel is WhatsApp and who has not written in gets
 * the approved template, and the words it tells them to reply are the words
 * that start the check-in. The two halves are built in different files, so the
 * one test that proves they meet is worth having.
 */
describe("a check-in asked for and answered over WhatsApp", () => {
  it("sends the template, and its own reply starts the conversation", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set primary_channel = 'whatsapp' where id = $1",
      [ownerMemberId],
    );
    await callAction({ pool: wb.appPool, ...context() }, "channels.connect", {
      provider: "whatsapp",
      credentials: JSON.stringify({
        accessToken: "a-token",
        appSecret: "a-secret",
        verifyToken: "a-verify-token",
      }),
      config: { teamId: "123456789012345" },
    });
    await callAction(
      { pool: wb.appPool, ...context() },
      "channels.linkIdentity",
      { provider: "whatsapp", externalId: "447700900000" },
    );
    await callAction(
      { pool: wb.appPool, ...context() },
      "channels.syncTemplates",
      {
        templates: [
          {
            metaId: "meta-1",
            name: "checkin_due",
            language: "en",
            status: "APPROVED",
            category: "UTILITY",
            bodyText: "Hi {{1}}, your check-in is due. Reply {{2}}.",
            variables: 2,
          },
        ],
      },
    );
    const { templates } = await callAction(
      { pool: wb.appPool, ...context() },
      "channels.templates",
      {},
    );
    for (const rule of ["checkin.due_soon", "checkin.due", "checkin.overdue"]) {
      await callAction(
        { pool: wb.appPool, ...context() },
        "channels.saveTemplateMapping",
        {
          ruleKey: rule,
          templateId: templates[0]?.id as string,
          bindings: ["member.name", "reply.command"],
        },
      );
    }

    await runAt(`${dueOn}T09:00:00Z`);
    const [message] = await messageRows();
    expect(message?.payload.templateKey).toBe("checkin_due");

    // The words the member is told to reply, sent back as a member would.
    const told = (message?.payload.templateParameters as string[])[1] as string;
    const reply = await routeCommand({
      pool: wb.appPool,
      workspaceId,
      provider: "whatsapp",
      memberId: ownerMemberId,
      userId: OWNER,
      text: told,
      now: new Date(`${dueOn}T09:05:00Z`),
    });
    expect(reply.text).toMatch(/How is it going/);
  });
});
