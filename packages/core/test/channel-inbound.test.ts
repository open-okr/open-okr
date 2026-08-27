import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import {
  handleInbound,
  hashLinkCode,
  type InboundRequestFacts,
  workspaceForProviderTeam,
} from "../src/channels/inbound.ts";
import { parseKeyRing } from "../src/secrets/key-ring.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Inbound channel messages, steps three to six (AI-NATIVE-PLAN.md §6,
 * P5-T02a).
 *
 * The property under test throughout is silence. Steps four and five answer a
 * stranger with nothing, because a helpful error confirms the workspace exists,
 * and a test that only checked "it did not act" would pass for a handler that
 * replied "no such member". So each one asserts the outcome kind *and* that
 * nothing was written beyond the log row.
 */

const OWNER = "inbound-owner";
const SECOND = "inbound-second";
/**
 * Real time, not a fixed instant.
 *
 * A fixed `now` looked tidier and broke the link-code tests: `startLink` sets
 * `expires_at` from the database clock, and a `now` on the other side of that
 * clock made every live code look expired. The codes are the one thing here
 * that has to agree with the wall clock.
 */
const NOW = new Date();

let workspaceId: string;
let ownerMemberId: string;
let secondMemberId: string;

const ring = parseKeyRing({
  current: "5UB2Ez1oQ0Rr8sT1n5x7yWl4qKcM9vHfJbGdApXeZi0=",
});

const asOwner = () => ({
  workspaceId,
  actor: { kind: "human" as const, userId: OWNER },
  ring,
});

const facts = (
  over: Partial<InboundRequestFacts> = {},
): InboundRequestFacts => ({
  workspaceId,
  provider: "slack",
  deliveryId: "Ev-1",
  externalSenderId: "U-owner",
  text: "status",
  now: NOW,
  ...over,
});

async function inboundRows() {
  const wb = await workerDb();
  const rows = await wb.admin.query(
    "select provider, direction, member_id, status, idempotency_key, payload from channel_messages where direction = 'in' order by created_at",
  );
  return rows.rows as Array<{
    provider: string;
    direction: string;
    member_id: string | null;
    status: string;
    idempotency_key: string;
    payload: Record<string, unknown>;
  }>;
}

async function identityRows() {
  const wb = await workerDb();
  const rows = await wb.admin.query(
    "select member_id, provider, external_id, verified_at from channel_identities order by created_at",
  );
  return rows.rows as Array<{
    member_id: string;
    provider: string;
    external_id: string;
    verified_at: Date | null;
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
      "inbound-owner@example.com",
      SECOND,
      "Second",
      "inbound-second@example.com",
    ],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;

  const owner = await wb.admin.query(
    "select id from workspace_members where workspace_id = $1 and user_id = $2",
    [workspaceId, OWNER],
  );
  ownerMemberId = owner.rows[0].id as string;

  const second = await wb.admin.query(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Second', 'active') returning id`,
    [workspaceId, SECOND],
  );
  secondMemberId = second.rows[0].id as string;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("step three: the duplicate check", () => {
  it("records the first delivery and ignores a repeat of it", async () => {
    const wb = await workerDb();
    const first = await handleInbound(wb.appPool, facts());
    const second = await handleInbound(wb.appPool, facts());

    expect(first.kind).not.toBe("duplicate");
    expect(second).toEqual({ kind: "duplicate" });
    // One row, because the log row is the duplicate check.
    expect(await inboundRows()).toHaveLength(1);
  });

  it("treats a different delivery id as a different delivery", async () => {
    const wb = await workerDb();
    await handleInbound(wb.appPool, facts({ deliveryId: "Ev-1" }));
    await handleInbound(wb.appPool, facts({ deliveryId: "Ev-2" }));
    expect(await inboundRows()).toHaveLength(2);
  });
});

describe("step four: who sent it", () => {
  it("answers a stranger with nothing at all", async () => {
    const wb = await workerDb();
    const outcome = await handleInbound(
      wb.appPool,
      facts({ externalSenderId: "U-nobody" }),
    );
    expect(outcome).toEqual({
      kind: "ignored",
      reason: "no identity for this sender",
    });
    // The delivery is recorded, which is what makes a replay a duplicate, and
    // it names no member because none was resolved.
    const rows = await inboundRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.member_id).toBeNull();
  });

  it("gives an unverified identity the same silence as no identity", async () => {
    const wb = await workerDb();
    // An identity row with `verified_at` null: somebody's claim, not a proof.
    await wb.admin.query(
      `insert into channel_identities (id, workspace_id, member_id, provider, external_id)
       values (gen_random_uuid(), $1, $2, 'slack', 'U-claimed')`,
      [workspaceId, ownerMemberId],
    );

    const outcome = await handleInbound(
      wb.appPool,
      facts({ externalSenderId: "U-claimed" }),
    );
    expect(outcome).toEqual({
      kind: "ignored",
      reason: "this identity was never verified",
    });
  });

  it("accepts a verified sender and names them on the log row", async () => {
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...asOwner() },
      "channels.linkIdentity",
      { provider: "slack", externalId: "U-owner" },
    );

    const outcome = await handleInbound(wb.appPool, facts());
    // The user id is on the outcome as well (P5-T06a): the router calls a
    // registry action, and access is resolved for a human actor by user.
    expect(outcome).toEqual({
      kind: "accepted",
      memberId: ownerMemberId,
      userId: OWNER,
    });
    expect((await inboundRows())[0]?.member_id).toBe(ownerMemberId);
  });

  it("resolves by the provider's own id and never by a handle", async () => {
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...asOwner() },
      "channels.linkIdentity",
      { provider: "slack", externalId: "U-owner", externalHandle: "@owner" },
    );

    // The handle, sent as the sender id. A handle is changeable, reusable and
    // sometimes shared, so matching on it is how one person's nudge reaches
    // another person.
    const outcome = await handleInbound(
      wb.appPool,
      facts({ externalSenderId: "@owner" }),
    );
    expect(outcome.kind).toBe("ignored");
  });
});

describe("step five: whether they are still a member", () => {
  it("answers a suspended member with nothing", async () => {
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...asOwner() },
      "channels.linkIdentity",
      { provider: "slack", externalId: "U-owner" },
    );
    await wb.admin.query(
      "update workspace_members set status = 'suspended' where id = $1",
      [ownerMemberId],
    );

    expect(await handleInbound(wb.appPool, facts())).toEqual({
      kind: "ignored",
      reason: "this member is not active",
    });
  });
});

describe("step six: the rate limit", () => {
  it("reports the limit rather than acting", async () => {
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...asOwner() },
      "channels.linkIdentity",
      { provider: "slack", externalId: "U-owner" },
    );

    const outcome = await handleInbound(
      wb.appPool,
      facts({ withinRateLimit: async () => false }),
    );
    expect(outcome).toEqual({ kind: "rate_limited" });
  });

  it("is only reached once the sender is somebody the product knows", async () => {
    const wb = await workerDb();
    let asked = 0;
    await handleInbound(
      wb.appPool,
      facts({
        externalSenderId: "U-nobody",
        withinRateLimit: async () => {
          asked++;
          return true;
        },
      }),
    );
    // An unknown sender must not be able to consume anybody's budget, which is
    // why identity resolution comes first.
    expect(asked).toBe(0);
  });

  it("accepts when no limiter is configured at all", async () => {
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...asOwner() },
      "channels.linkIdentity",
      { provider: "slack", externalId: "U-owner" },
    );
    // An instance with no cache should still take messages.
    expect((await handleInbound(wb.appPool, facts())).kind).toBe("accepted");
  });
});

describe("linking by short code", () => {
  const codeFor = async () => {
    const wb = await workerDb();
    const issued = await callAction(
      { pool: wb.appPool, ...asOwner() },
      "channels.startLink",
      { provider: "slack" },
    );
    return issued.code;
  };

  it("turns a code the sender typed into a verified identity", async () => {
    const wb = await workerDb();
    const code = await codeFor();

    const outcome = await handleInbound(
      wb.appPool,
      facts({ externalSenderId: "U-fresh", text: `link ${code}` }),
    );
    expect(outcome).toEqual({ kind: "linked", memberId: ownerMemberId });

    const identities = await identityRows();
    expect(identities).toHaveLength(1);
    expect(identities[0]?.external_id).toBe("U-fresh");
    expect(identities[0]?.verified_at).toBeInstanceOf(Date);
  });

  it("never stores the code in the clear", async () => {
    const wb = await workerDb();
    const code = await codeFor();
    const rows = await wb.admin.query(
      "select code_hash from channel_link_codes",
    );
    expect(rows.rows[0].code_hash).not.toBe(code);
    expect(rows.rows[0].code_hash).toBe(hashLinkCode(code));
  });

  it("works once, and the second time is a stranger again", async () => {
    const wb = await workerDb();
    const code = await codeFor();
    await handleInbound(
      wb.appPool,
      facts({ deliveryId: "Ev-1", externalSenderId: "U-a", text: code }),
    );

    // The same code from a different account. A single-use code that worked
    // twice would be a way for a second person to become the first.
    const outcome = await handleInbound(
      wb.appPool,
      facts({ deliveryId: "Ev-2", externalSenderId: "U-b", text: code }),
    );
    expect(outcome.kind).toBe("ignored");
  });

  it("refuses an expired code", async () => {
    const wb = await workerDb();
    const code = await codeFor();
    await wb.admin.query(
      "update channel_link_codes set expires_at = now() - interval '1 minute'",
    );

    expect(
      (
        await handleInbound(
          wb.appPool,
          facts({ externalSenderId: "U-late", text: code }),
        )
      ).kind,
    ).toBe("ignored");
  });

  it("replaces the previous code when a member asks again", async () => {
    const wb = await workerDb();
    const first = await codeFor();
    const second = await codeFor();
    expect(first).not.toBe(second);

    // The first one no longer works, which is what pressing the button twice
    // means: the last one, please, not two live ways to become me.
    expect(
      (
        await handleInbound(
          wb.appPool,
          facts({ deliveryId: "Ev-old", externalSenderId: "U-x", text: first }),
        )
      ).kind,
    ).toBe("ignored");
    expect(
      (
        await handleInbound(
          wb.appPool,
          facts({
            deliveryId: "Ev-new",
            externalSenderId: "U-y",
            text: second,
          }),
        )
      ).kind,
    ).toBe("linked");
  });

  it("ignores a message that merely contains six digits", async () => {
    const wb = await workerDb();
    await codeFor();
    expect(
      (
        await handleInbound(
          wb.appPool,
          facts({
            externalSenderId: "U-z",
            text: "revenue is 123456 this month",
          }),
        )
      ).kind,
    ).toBe("ignored");
  });

  it("moves an existing identity to the account that proved the code", async () => {
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...asOwner() },
      "channels.linkIdentity",
      { provider: "slack", externalId: "U-old-account" },
    );
    const code = await codeFor();

    await handleInbound(
      wb.appPool,
      facts({ externalSenderId: "U-new-account", text: code }),
    );

    const identities = await identityRows();
    // One row, not two: a member has one identity per provider, and the new
    // account is the one they just proved they hold.
    expect(identities).toHaveLength(1);
    expect(identities[0]?.external_id).toBe("U-new-account");
  });
});

describe("finding the workspace a provider team belongs to", () => {
  it("answers with the workspace that connected it", async () => {
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...asOwner() }, "channels.connect", {
      provider: "slack",
      credentials: JSON.stringify({
        botToken: "xoxb-test",
        signingSecret: "secret",
      }),
      config: { teamId: "T-acme" },
    });

    expect(
      await workspaceForProviderTeam(wb.appPool, {
        provider: "slack",
        teamId: "T-acme",
      }),
    ).toBe(workspaceId);
  });

  it("answers null for a team nobody connected", async () => {
    const wb = await workerDb();
    expect(
      await workspaceForProviderTeam(wb.appPool, {
        provider: "slack",
        teamId: "T-stranger",
      }),
    ).toBeNull();
  });

  it("still answers when the connection is broken, because inbound is how it gets fixed", async () => {
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...asOwner() }, "channels.connect", {
      provider: "slack",
      credentials: JSON.stringify({ botToken: "b", signingSecret: "s" }),
      config: { teamId: "T-acme" },
    });
    await wb.admin.query(
      "update channel_connections set state = 'error' where workspace_id = $1",
      [workspaceId],
    );

    // The installation is a route, not a permission. A broken connection must
    // not make inbound messages vanish: re-linking an account and reinstalling
    // both arrive this way, and a workspace that could not be reached would
    // have no way back. What refuses a broken connection is the *outbound*
    // side, where `openConnection` reads `state = 'connected'` and the routing
    // falls back to email.
    expect(
      await workspaceForProviderTeam(wb.appPool, {
        provider: "slack",
        teamId: "T-acme",
      }),
    ).toBe(workspaceId);
  });

  it("stops answering once the provider is disconnected", async () => {
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...asOwner() }, "channels.connect", {
      provider: "slack",
      credentials: JSON.stringify({ botToken: "b", signingSecret: "s" }),
      config: { teamId: "T-acme" },
    });
    await callAction(
      { pool: wb.appPool, ...asOwner() },
      "channels.disconnect",
      { provider: "slack" },
    );

    expect(
      await workspaceForProviderTeam(wb.appPool, {
        provider: "slack",
        teamId: "T-acme",
      }),
    ).toBeNull();
  });

  it("lets the same provider workspace be reconnected afterwards", async () => {
    const wb = await workerDb();
    const connect = () =>
      callAction({ pool: wb.appPool, ...asOwner() }, "channels.connect", {
        provider: "slack",
        credentials: JSON.stringify({ botToken: "b", signingSecret: "s" }),
        config: { teamId: "T-acme" },
      });

    await connect();
    await callAction(
      { pool: wb.appPool, ...asOwner() },
      "channels.disconnect",
      { provider: "slack" },
    );
    // The reason the installation row is really deleted rather than
    // soft-deleted: a tombstone would hold the unique index and this would
    // fail.
    await connect();

    expect(
      await workspaceForProviderTeam(wb.appPool, {
        provider: "slack",
        teamId: "T-acme",
      }),
    ).toBe(workspaceId);
  });
});

describe("what a second member cannot do", () => {
  it("cannot claim an account the first member already proved", async () => {
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...asOwner() },
      "channels.linkIdentity",
      { provider: "slack", externalId: "U-shared" },
    );

    const secondCode = await callAction(
      {
        pool: wb.appPool,
        workspaceId,
        actor: { kind: "human", userId: SECOND },
        ring,
      },
      "channels.startLink",
      { provider: "slack" },
    );

    // The second member sends their own code from the *first* member's Slack
    // account. The unique index on `(workspace, provider, external_id)` is what
    // refuses it, which is the database saying one account is one person.
    // Refused by the database rather than by a check somebody could forget.
    await expect(
      handleInbound(
        wb.appPool,
        facts({ externalSenderId: "U-shared", text: secondCode.code }),
      ),
    ).rejects.toThrow();

    const identities = await identityRows();
    expect(identities).toHaveLength(1);
    expect(identities[0]?.member_id).toBe(ownerMemberId);
    expect(secondMemberId).not.toBe(ownerMemberId);
  });
});
