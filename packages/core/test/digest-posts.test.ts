import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { dispatchOutbox, type OutboxDelivery } from "../src/outbox/handlers.ts";
import { parseKeyRing } from "../src/secrets/key-ring.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * A space's own channel, and the week's digest posted to it (AI-NATIVE-PLAN
 * §5.2, UIUX-PLAN S-22 step 4, completeness review M-23).
 *
 * §5.2 gives Slack per-space channel posts and Teams channel posts, and S-22's
 * digest step offers to post the digest to the space's channel. Nothing let a
 * space say which channel it reads, and every channel message went to one
 * member.
 *
 * The acceptance criterion, in the words these tests use: given a space linked
 * to a Slack channel on a connected workspace, when the coordinator posts the
 * closed session's digest, then one message is queued for that channel and
 * nobody else, the digest records where it went, and pressing again posts
 * nothing more.
 */

const OWNER = "digest-post-owner";
const OUTSIDER = "digest-post-outsider";

let workspaceId: string;
let spaceId: string;
let sessionId: string;
let outsiderMemberId: string;

const ring = parseKeyRing({
  current: "5UB2Ez1oQ0Rr8sT1n5x7yWl4qKcM9vHfJbGdApXeZi0=",
});

const as = (userId: string) => ({
  workspaceId,
  actor: { kind: "human" as const, userId },
  ring,
});

const call = async (name: string, input: unknown, userId = OWNER) => {
  const wb = await workerDb();
  return callAction(
    {
      pool: wb.appPool,
      ...as(userId),
      baseUrl: "https://okr.example.com/",
      instanceName: "OKR Goal",
    },
    name as never,
    input as never,
  );
};

async function channelRows() {
  const wb = await workerDb();
  const rows = await wb.admin.query(
    `select provider, member_id, payload, idempotency_key, status, error
       from channel_messages where workspace_id = $1 order by created_at`,
    [workspaceId],
  );
  return rows.rows as Array<{
    provider: string;
    member_id: string | null;
    payload: Record<string, unknown>;
    idempotency_key: string;
    status: string;
    error: string | null;
  }>;
}

async function channelJobs(): Promise<OutboxDelivery[]> {
  const wb = await workerDb();
  const rows = await wb.admin.query(
    "select topic, payload, idempotency_key, attempts from outbox where topic = 'channel.message' order by created_at",
  );
  return rows.rows.map((row) => ({
    topic: row.topic as string,
    payload: row.payload as Record<string, unknown>,
    idempotencyKey: row.idempotency_key as string,
    attempts: row.attempts as number,
  }));
}

const connect = (provider: "slack" | "teams") =>
  call("channels.connect", {
    provider,
    credentials:
      provider === "slack"
        ? "xoxb-token"
        : JSON.stringify({ appId: "app", appPassword: "secret" }),
  });

const link = (settings: Record<string, unknown>) =>
  call("spaces.updateSettings", { id: spaceId, ...settings });

const closeTheSession = async () => {
  await call("sessions.open", { id: sessionId });
  await call("sessions.close", { id: sessionId });
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, 'Ada', $2), ($3, 'Oli', $4)",
    [
      OWNER,
      "digest-post-owner@example.com",
      OUTSIDER,
      "digest-post-outsider@example.com",
    ],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Ada",
  });
  workspaceId = provisioned.workspaceId;
  // A member of the workspace who is in no space: they can read the space,
  // as every member can, and may not post for it.
  const outsider = await wb.admin.query(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Oli', 'active') returning id`,
    [workspaceId, OUTSIDER],
  );
  outsiderMemberId = outsider.rows[0].id as string;

  spaceId = ((await call("spaces.list", {})) as { id: string }[])[0]
    ?.id as string;
  const cycle = (await call("cycles.current", { mode: "quarterly" })) as {
    id: string;
  };
  const session = (await call("sessions.create", {
    spaceId,
    cycleId: cycle.id,
    kind: "weekly",
    title: "Week of 24 August",
    scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
    facilitatorId: provisioned.memberId,
  })) as { id: string };
  sessionId = session.id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the space's own channel", () => {
  it("is linked nowhere until a space says otherwise", async () => {
    const space = (await call("spaces.read", { id: spaceId })) as {
      settings: Record<string, unknown>;
    };
    expect(space.settings.slackChannel).toBeNull();
    expect(space.settings.teamsChannel).toBeNull();
  });

  it("is written by the space's own settings and read back", async () => {
    await link({ slackChannel: "C0123ABCD" });
    await link({ teamsChannel: "19:abc@thread.tacv2" });
    const space = (await call("spaces.read", { id: spaceId })) as {
      settings: Record<string, unknown>;
    };
    // One key at a time: the second write did not clear the first.
    expect(space.settings.slackChannel).toBe("C0123ABCD");
    expect(space.settings.teamsChannel).toBe("19:abc@thread.tacv2");

    await link({ slackChannel: null });
    const unlinked = (await call("spaces.read", { id: spaceId })) as {
      settings: Record<string, unknown>;
    };
    expect(unlinked.settings.slackChannel).toBeNull();
    expect(unlinked.settings.teamsChannel).toBe("19:abc@thread.tacv2");
  });

  it("refuses a channel name where an id belongs", async () => {
    // Neither API takes "#team okrs", and a link that never posts is worse
    // than being told so when it is saved.
    await expect(link({ slackChannel: "team okrs" })).rejects.toThrow();
  });

  it("is refused to a member who does not manage the space", async () => {
    await expect(
      call(
        "spaces.updateSettings",
        { id: spaceId, slackChannel: "C0123ABCD" },
        OUTSIDER,
      ),
    ).rejects.toThrow();
  });
});

describe("posting the week's digest to it", () => {
  it("posts once to the linked channel, to no member, through the outbox (acceptance)", async () => {
    await connect("slack");
    await link({ slackChannel: "C0123ABCD" });
    await closeTheSession();

    const result = (await call("sessions.postDigest", { sessionId })) as {
      posted: string[];
      alreadyPosted: string[];
    };
    expect(result).toEqual({ posted: ["slack"], alreadyPosted: [] });

    const rows = await channelRows();
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.provider).toBe("slack");
    // Nobody in particular: it is for whoever reads the channel.
    expect(row?.member_id).toBeNull();
    expect(row?.payload.target).toBe("C0123ABCD");
    expect(row?.status).toBe("queued");
    // The space's own name, where the screen says "This space".
    expect(String(row?.payload.text)).toMatch(/^[^\n]*week of/);
    expect(String(row?.payload.text)).not.toContain("This space");
    expect(row?.payload.buttons).toEqual([
      {
        label: "Open in OKR Goal",
        url: `https://okr.example.com/session/${sessionId}`,
      },
    ]);
    expect(await channelJobs()).toHaveLength(1);

    // And pressing again posts nothing more.
    const again = (await call("sessions.postDigest", { sessionId })) as {
      posted: string[];
      alreadyPosted: string[];
    };
    expect(again).toEqual({ posted: [], alreadyPosted: ["slack"] });
    expect(await channelRows()).toHaveLength(1);
    expect(await channelJobs()).toHaveLength(1);
  });

  it("records where it went on the digest, which the digest read hands back", async () => {
    await connect("slack");
    await connect("teams");
    await link({
      slackChannel: "C0123ABCD",
      teamsChannel: "19:abc@thread.tacv2",
    });
    await closeTheSession();

    const before = (await call("sessions.digest", { sessionId })) as {
      postedTo: string[];
      postableTo: string[];
    };
    expect(before.postedTo).toEqual([]);
    expect(before.postableTo).toEqual(["slack", "teams"]);

    await call("sessions.postDigest", { sessionId });

    const after = (await call("sessions.digest", { sessionId })) as {
      postedTo: string[];
    };
    expect(after.postedTo.sort()).toEqual(["slack", "teams"]);

    const wb = await workerDb();
    const digest = await wb.admin.query(
      "select published_at, channels from digests where workspace_id = $1",
      [workspaceId],
    );
    expect(digest.rows[0]?.published_at).toBeInstanceOf(Date);
  });

  it("leaves out a linked channel whose provider is not connected", async () => {
    await connect("slack");
    await link({
      slackChannel: "C0123ABCD",
      teamsChannel: "19:abc@thread.tacv2",
    });
    await closeTheSession();

    const result = (await call("sessions.postDigest", { sessionId })) as {
      posted: string[];
    };
    expect(result.posted).toEqual(["slack"]);
    expect((await channelRows()).map((row) => row.provider)).toEqual(["slack"]);
  });

  it("refuses when the space links no channel, and writes nothing", async () => {
    await connect("slack");
    await closeTheSession();

    await expect(call("sessions.postDigest", { sessionId })).rejects.toThrow(
      /no Slack or Teams channel linked/,
    );
    expect(await channelRows()).toEqual([]);
    const digest = (await call("sessions.digest", { sessionId })) as {
      postableTo: string[];
    };
    expect(digest.postableTo).toEqual([]);
  });

  it("refuses before the session closes, because the figures still move", async () => {
    await connect("slack");
    await link({ slackChannel: "C0123ABCD" });
    await call("sessions.open", { id: sessionId });

    await expect(call("sessions.postDigest", { sessionId })).rejects.toThrow(
      /once the session has closed/,
    );
    expect(await channelRows()).toEqual([]);
  });

  it("refuses a member who may not edit the space", async () => {
    await connect("slack");
    await link({ slackChannel: "C0123ABCD" });
    await closeTheSession();
    expect(outsiderMemberId).toBeDefined();

    await expect(
      call("sessions.postDigest", { sessionId }, OUTSIDER),
    ).rejects.toThrow();
    expect(await channelRows()).toEqual([]);
  });

  it("is audited with the providers and never the channel ids", async () => {
    await connect("slack");
    await link({ slackChannel: "C0123ABCD" });
    await closeTheSession();
    await call("sessions.postDigest", { sessionId });

    const wb = await workerDb();
    const audited = await wb.admin.query(
      "select payload from audit_events where workspace_id = $1 and action = 'sessions.postDigest'",
      [workspaceId],
    );
    expect(audited.rows).toHaveLength(1);
    expect(JSON.stringify(audited.rows[0].payload)).toContain("slack");
    expect(JSON.stringify(audited.rows[0].payload)).not.toContain("C0123ABCD");
  });
});

describe("delivering the post", () => {
  it("hands the relay the channel to post to, and no member", async () => {
    await connect("slack");
    await link({ slackChannel: "C0123ABCD" });
    await closeTheSession();
    await call("sessions.postDigest", { sessionId });

    const [job] = await channelJobs();
    const seen: Array<{ memberId: string | null; target?: string }> = [];
    const wb = await workerDb();
    await dispatchOutbox(job as OutboxDelivery, {
      pool: wb.appPool,
      sendChannel: async (message) => {
        seen.push({
          memberId: message.memberId,
          ...(message.target ? { target: message.target } : {}),
        });
        return { delivered: true, externalMessageId: "ts-1" };
      },
    });
    expect(seen).toEqual([{ memberId: null, target: "C0123ABCD" }]);
    expect((await channelRows())[0]?.status).toBe("sent");
  });

  it("does not mark the whole connection broken when one space's channel refuses", async () => {
    // The bot not being in one team's channel is that space's link, not the
    // connection. Marking it broken would move every member off Slack.
    await connect("slack");
    await link({ slackChannel: "C0123ABCD" });
    await closeTheSession();
    await call("sessions.postDigest", { sessionId });

    const [job] = await channelJobs();
    const wb = await workerDb();
    await expect(
      dispatchOutbox(job as OutboxDelivery, {
        pool: wb.appPool,
        sendChannel: async () => {
          throw new Error("Slack refused this permanently: not_in_channel");
        },
      }),
    ).rejects.toThrow(/not_in_channel/);

    expect((await channelRows())[0]?.status).toBe("failed");
    const connection = await wb.admin.query(
      "select state from channel_connections where workspace_id = $1 and provider = 'slack'",
      [workspaceId],
    );
    expect(connection.rows[0]?.state).toBe("connected");
  });
});
