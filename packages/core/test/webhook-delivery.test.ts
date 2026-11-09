import { withWorkspace } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { ActionCallContext } from "../src/actions/define.ts";
import { callAction } from "../src/actions/registry.ts";
import { provisionMemberForInvite } from "../src/invitations/provisioning.ts";
import {
  dispatchOutbox,
  type OutboxDelivery,
  type OutboxHandlerDeps,
} from "../src/outbox/handlers.ts";
import { parseKeyRing } from "../src/secrets/key-ring.ts";
import type { WebhookPost } from "../src/webhooks/deliver.ts";
import {
  FAILURES_BEFORE_OFF,
  WEBHOOK_DELIVER_TOPIC,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_TURNED_OFF_TOPIC,
} from "../src/webhooks/jobs.ts";
import { purgeWebhookDeliveries } from "../src/webhooks/retention.ts";
import { webhookSignature } from "../src/webhooks/signature.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Delivering a webhook (docs/design/outbound-webhooks.md W1, W4, W5, W7, W9,
 * W10), through the outbox handler the relay runs, with a fake in place of
 * the outbound guard's POST. The guard itself is proved in
 * `packages/adapters/test/outbound-guard.test.ts`.
 */

const OWNER = "delivery-owner";
const ADMIN = "delivery-admin";

const ring = parseKeyRing({
  current: "5UB2Ez1oQ0Rr8sT1n5x7yWl4qKcM9vHfJbGdApXeZi0=",
});

let workspaceId: string;
let ownerMemberId: string;
let adminMemberId: string;
let cycleId: string;

const as = async (userId: string): Promise<ActionCallContext> => ({
  pool: (await workerDb()).appPool,
  workspaceId,
  actor: { kind: "human", userId },
  ring,
  checkOutboundUrl: async () => ({ ok: true }),
});

const call = async <T>(userId: string, action: string, input: unknown) =>
  (await callAction(await as(userId), action as never, input as never)) as T;

interface Posted {
  readonly url: string;
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
}

/** A receiver that answers every request with one status, and keeps them. */
function receiver(status = 200) {
  const posted: Posted[] = [];
  const post: WebhookPost = async (url, request) => {
    posted.push({ url, body: request.body, headers: request.headers });
    return { ok: true, status };
  };
  return { posted, post };
}

async function waiting(
  topic = WEBHOOK_DELIVER_TOPIC,
): Promise<OutboxDelivery[]> {
  const wb = await workerDb();
  const { rows } = await wb.admin.query(
    `select topic, payload, idempotency_key from outbox
      where topic = $1 and delivered_at is null order by created_at`,
    [topic],
  );
  return rows.map((row) => ({
    topic: row.topic as string,
    payload: row.payload as Record<string, unknown>,
    idempotencyKey: row.idempotency_key as string,
    attempts: 1,
  }));
}

/**
 * Runs what is waiting, as the relay would at the given attempt, and marks
 * each row done so the next call does not run it again. Returns what threw.
 */
async function deliverWaiting(
  post: WebhookPost,
  attempts = 1,
  extra: Partial<OutboxHandlerDeps> = {},
): Promise<string[]> {
  const wb = await workerDb();
  const thrown: string[] = [];
  const skipped: string[] = [];
  for (const delivery of await waiting()) {
    try {
      await dispatchOutbox(
        { ...delivery, attempts },
        {
          pool: wb.appPool,
          ring,
          postWebhook: post,
          onSkipped: (_row, why) => skipped.push(why),
          ...extra,
        },
      );
    } catch (error) {
      thrown.push((error as Error).message);
    }
    await wb.admin.query(
      "update outbox set delivered_at = now() where idempotency_key = $1",
      [delivery.idempotencyKey],
    );
  }
  return thrown;
}

async function logged() {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    id: string;
    event: string;
    event_id: string;
    outcome: string;
    status_code: number | null;
    attempt: number;
    reason: string | null;
  }>(
    `select id, event, event_id, outcome, status_code, attempt, reason
       from webhook_deliveries order by attempted_at, id`,
  );
  return rows;
}

const createHook = (events: string[]) =>
  call<{ id: string; secret: string }>(ADMIN, "webhooks.create", {
    name: "Receiver",
    url: "https://hooks.example/okr",
    events,
  });

const createGoal = (title: string) =>
  call<{ id: string }>(OWNER, "goals.create", {
    title,
    cycleId,
    level: "team",
    ownerKind: "workspace",
    championId: ownerMemberId,
  });

async function goalWithKeyResult() {
  const goal = await createGoal("Customers reach value in their first week");
  const keyResult = await call<{ id: string }>(OWNER, "goals.addKeyResult", {
    goalId: goal.id,
    title: "Activation rate",
    indicatorType: "lagging",
    direction: "increase",
    baselineValue: 0,
    targetValue: 40,
  });
  return { goalId: goal.id, keyResultId: keyResult.id };
}

async function checkIn(goalId: string, keyResultId: string) {
  const draft = await call<{ id: string }>(OWNER, "goals.startCheckIn", {
    goalId,
  });
  await call(OWNER, "goals.publishCheckIn", {
    id: draft.id,
    status: "on_track",
    confidence: 0.7,
    narrative: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Activation is moving." }],
        },
      ],
    },
    values: [{ keyResultId, value: 12, confidence: 0.7 }],
  });
  return draft.id;
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $1, $2), ($3, $3, $4)",
    [OWNER, "delivery-owner@example.com", ADMIN, "delivery-admin@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: OWNER,
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
  adminMemberId = (
    await withWorkspace(drizzle(wb.appPool), workspaceId, (tx) =>
      provisionMemberForInvite(tx, {
        workspaceId,
        user: { id: ADMIN, name: ADMIN },
      }),
    )
  ).memberId;
  await call(OWNER, "people.setAdministrator", {
    memberId: adminMemberId,
    administrator: true,
  });
  cycleId = (
    await call<{ id: string }>(OWNER, "cycles.current", { mode: "quarterly" })
  ).id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a delivery", () => {
  it("acceptance: one signed POST with the key result's summary, logged as 200", async () => {
    const hook = await createHook(["key_result.checked_in"]);
    const { goalId, keyResultId } = await goalWithKeyResult();
    const checkInId = await checkIn(goalId, keyResultId);
    const [row] = await waiting();
    const { posted, post } = receiver(200);

    expect(await deliverWaiting(post)).toEqual([]);

    expect(posted).toHaveLength(1);
    const [sent] = posted as [Posted];
    expect(sent.url).toBe("https://hooks.example/okr");
    expect(sent.headers["content-type"]).toBe("application/json");
    expect(sent.headers["webhook-id"]).toBe(row?.payload.eventId);
    expect(sent.headers["webhook-signature"]).toBe(
      webhookSignature({
        secrets: [hook.secret],
        id: sent.headers["webhook-id"] as string,
        timestamp: Number(sent.headers["webhook-timestamp"]),
        body: sent.body,
      }),
    );
    const body = JSON.parse(sent.body);
    expect(body).toMatchObject({
      id: row?.payload.eventId,
      type: "key_result.checked_in",
      workspace: { id: workspaceId },
      data: {
        id: keyResultId,
        goalId,
        title: "Activation rate",
        checkIn: {
          id: checkInId,
          status: "on_track",
          value: 12,
          note: "Activation is moving.",
        },
      },
    });

    expect(await logged()).toEqual([
      expect.objectContaining({
        event: "key_result.checked_in",
        outcome: "delivered",
        status_code: 200,
        attempt: 1,
        reason: null,
      }),
    ]);
    const listed = await call<{
      webhooks: { lastDelivery: { outcome: string } | null }[];
    }>(ADMIN, "webhooks.list", {});
    expect(listed.webhooks[0]?.lastDelivery?.outcome).toBe("delivered");
  });

  it("acceptance: withholds a key result the owner cannot see, and sends nothing", async () => {
    // The owner's role sees no goals, and this goal is readable by its own
    // people only: what a goal in a space the owner is not in amounts to.
    const role = await call<{ id: string }>(OWNER, "roles.create", {
      name: "Integrations",
      permissions: [
        { domain: "workspace", level: 100 },
        { domain: "goal", level: 0 },
      ],
    });
    await call(OWNER, "roles.assign", {
      memberId: adminMemberId,
      roleId: role.id,
    });
    await createHook(["key_result.checked_in"]);
    const { goalId, keyResultId } = await goalWithKeyResult();
    const wb = await workerDb();
    await wb.admin.query(
      `update access_bindings b set deleted_at = now()
         from access_contexts c, access_groups g
        where b.context_id = c.id and b.group_id = g.id
          and c.resource_type = 'goal' and c.resource_id = $1
          and g.kind in ('workspace_standard', 'space_standard')`,
      [goalId],
    );
    await checkIn(goalId, keyResultId);
    const { posted, post } = receiver(200);

    expect(await deliverWaiting(post)).toEqual([]);

    expect(posted).toEqual([]);
    expect(await logged()).toEqual([
      expect.objectContaining({
        outcome: "withheld",
        status_code: null,
        reason: "The webhook's owner cannot see this, so nothing was sent.",
      }),
    ]);
  });

  it("acceptance: retries a 500 with backoff, then gives up at the day's last attempt", async () => {
    await createHook(["objective.created"]);
    await createGoal("Customers reach value in their first week");
    const { post } = receiver(500);

    // The relay retries what throws, on the schedule OUTBOX_RETRY_POLICY gives.
    expect(await deliverWaiting(post, 1)).toEqual([
      "The receiver answered 500.",
    ]);

    await createGoal("Renewals happen without a call");
    expect(await deliverWaiting(post, WEBHOOK_MAX_ATTEMPTS)).toEqual([]);

    expect(await logged()).toEqual([
      expect.objectContaining({
        outcome: "failed",
        status_code: 500,
        attempt: 1,
      }),
      expect.objectContaining({
        outcome: "failed",
        status_code: 500,
        attempt: WEBHOOK_MAX_ATTEMPTS,
        reason: "The receiver answered 500.",
      }),
    ]);
  });

  it("acceptance: logs an address the guard refuses now, and never sends it", async () => {
    await createHook(["objective.created"]);
    await createGoal("Customers reach value in their first week");
    let called = 0;
    const refusing: WebhookPost = async () => {
      called += 1;
      return {
        ok: false,
        refusal: "address_not_allowed",
        detail:
          "hooks.example resolves to 10.0.0.5, which is private or reserved.",
      };
    };

    // Not retried: the address is not allowed, and waiting will not change it.
    expect(await deliverWaiting(refusing)).toEqual([]);
    expect(called).toBe(1);
    expect(await logged()).toEqual([
      expect.objectContaining({
        outcome: "refused",
        status_code: null,
        reason:
          "hooks.example resolves to 10.0.0.5, which is private or reserved.",
      }),
    ]);
  });

  it("acceptance: carries two v1 signatures for a day after a rotation", async () => {
    const hook = await createHook(["objective.created"]);
    const rotated = await call<{ secret: string }>(
      ADMIN,
      "webhooks.rotateSecret",
      {
        id: hook.id,
      },
    );
    await call(ADMIN, "webhooks.test", { id: hook.id });
    const { posted, post } = receiver(204);

    await deliverWaiting(post);

    const [sent] = posted as [Posted];
    const parts = (sent.headers["webhook-signature"] as string).split(" ");
    const signed = (secret: string) =>
      webhookSignature({
        secrets: [secret],
        id: sent.headers["webhook-id"] as string,
        timestamp: Number(sent.headers["webhook-timestamp"]),
        body: sent.body,
      });
    expect(parts).toEqual([signed(rotated.secret), signed(hook.secret)]);
    expect(JSON.parse(sent.body)).toMatchObject({ type: "ping", data: {} });
  });

  it("reports a deleted objective with no data, marked deleted", async () => {
    await createHook(["objective.deleted"]);
    const goal = await createGoal("Customers reach value in their first week");
    await call(OWNER, "goals.delete", { id: goal.id });
    const { posted, post } = receiver(200);

    await deliverWaiting(post);

    expect(JSON.parse((posted[0] as Posted).body)).toMatchObject({
      type: "objective.deleted",
      data: null,
      deleted: true,
    });
  });

  it("sends nothing once the owner is suspended or the hook is off, and logs nothing", async () => {
    const hook = await createHook(["objective.created"]);
    await createGoal("Customers reach value in their first week");
    // Queued while the owner was active, delivered after they were not.
    await call(OWNER, "people.suspend", { memberId: adminMemberId });
    const { posted, post } = receiver(200);
    await deliverWaiting(post);

    await call(OWNER, "webhooks.update", { id: hook.id, takeOwnership: true });
    await createGoal("Renewals happen without a call");
    await call(OWNER, "webhooks.update", { id: hook.id, enabled: false });
    await deliverWaiting(post);

    expect(posted).toEqual([]);
    expect(await logged()).toEqual([]);
  });
});

describe("a run of failures", () => {
  it(`acceptance: turns the hook off after ${FAILURES_BEFORE_OFF} failures in a row, and emails its creator once`, async () => {
    const hook = await createHook(["objective.created"]);
    const { post } = receiver(503);
    for (let sent = 0; sent < FAILURES_BEFORE_OFF; sent += 1) {
      await call(ADMIN, "webhooks.test", { id: hook.id });
    }
    await deliverWaiting(post, WEBHOOK_MAX_ATTEMPTS);

    const listed = await call<{
      webhooks: {
        state: string;
        offReason: string;
        consecutiveFailures: number;
      }[];
    }>(ADMIN, "webhooks.list", {});
    expect(listed.webhooks[0]).toMatchObject({
      state: "off",
      offReason: "failures",
      consecutiveFailures: FAILURES_BEFORE_OFF,
    });

    const wb = await workerDb();
    const audit = await wb.admin.query<{ actor_kind: string; payload: object }>(
      "select actor_kind, payload from audit_events where action = 'webhooks.turnOffAfterFailures'",
    );
    expect(audit.rows).toEqual([
      {
        actor_kind: "system",
        payload: { name: "Receiver", failures: FAILURES_BEFORE_OFF },
      },
    ]);

    const mails = await waiting(WEBHOOK_TURNED_OFF_TOPIC);
    expect(mails).toHaveLength(1);
    const sentMail: { to: string; subject: string; text: string }[] = [];
    await dispatchOutbox(mails[0] as OutboxDelivery, {
      pool: wb.appPool,
      baseUrl: "https://okr.example",
      sendMail: async (message) => {
        sentMail.push(message);
      },
    });
    expect(sentMail).toHaveLength(1);
    expect(sentMail[0]?.to).toBe("delivery-admin@example.com");
    expect(sentMail[0]?.subject).toContain("Receiver");
    expect(sentMail[0]?.text).toContain("hooks.example");
    expect(sentMail[0]?.text).not.toContain("hooks.example/okr");

    // Off now: an event queues nothing more.
    await createGoal("Customers reach value in their first week");
    expect(await waiting()).toEqual([]);

    // Turned back on, it starts counting from nothing.
    const back = await call<{ state: string; consecutiveFailures: number }>(
      ADMIN,
      "webhooks.update",
      { id: hook.id, enabled: true },
    );
    expect(back).toMatchObject({ state: "on", consecutiveFailures: 0 });
  });
});

describe("the log", () => {
  it("lists a hook's attempts newest first, with no body in them", async () => {
    const hook = await createHook(["objective.created"]);
    await createGoal("Customers reach value in their first week");
    await deliverWaiting(receiver(500).post, WEBHOOK_MAX_ATTEMPTS);
    await call(ADMIN, "webhooks.test", { id: hook.id });
    await deliverWaiting(receiver(200).post);

    const page = await call<{
      items: { event: string; outcome: string }[];
      hasMore: boolean;
    }>(ADMIN, "webhooks.deliveries", { id: hook.id });
    expect(page.items.map((item) => [item.event, item.outcome])).toEqual([
      ["ping", "delivered"],
      ["objective.created", "failed"],
    ]);
    expect(page.hasMore).toBe(false);
    expect(JSON.stringify(page)).not.toContain("Customers reach value");
  });

  it("acceptance: sends a failed delivery again with its event id, reading the subject afresh", async () => {
    await createHook(["objective.created"]);
    const goal = await createGoal("Customers reach value in their first week");
    await deliverWaiting(receiver(500).post, WEBHOOK_MAX_ATTEMPTS);
    const [failed] = await logged();

    await call(OWNER, "goals.update", {
      id: goal.id,
      title: "Customers reach value in week one",
    });
    // The update queued nothing for this hook, which only takes creations.
    await deliverWaiting(receiver(500).post);
    await call(ADMIN, "webhooks.redeliver", { deliveryId: failed?.id });
    const { posted, post } = receiver(200);
    await deliverWaiting(post);

    expect(posted).toHaveLength(1);
    expect((posted[0] as Posted).headers["webhook-id"]).toBe(failed?.event_id);
    expect(JSON.parse((posted[0] as Posted).body).data.title).toBe(
      "Customers reach value in week one",
    );
    const rows = await logged();
    expect(rows.at(-1)).toMatchObject({
      event_id: failed?.event_id,
      outcome: "delivered",
      attempt: 1,
    });

    await expect(
      call(ADMIN, "webhooks.redeliver", { deliveryId: rows.at(-1)?.id }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("acceptance: purges attempts older than thirty days", async () => {
    const hook = await createHook(["objective.created"]);
    await call(ADMIN, "webhooks.test", { id: hook.id });
    await call(ADMIN, "webhooks.test", { id: hook.id });
    await deliverWaiting(receiver(200).post);
    const [old] = await logged();
    const wb = await workerDb();
    await wb.admin.query(
      "update webhook_deliveries set attempted_at = now() - interval '31 days' where id = $1",
      [old?.id],
    );

    expect(await purgeWebhookDeliveries(wb.appPool, workspaceId)).toBe(1);
    expect((await logged()).map((row) => row.id)).not.toContain(old?.id);
    expect(await logged()).toHaveLength(1);
    expect(await purgeWebhookDeliveries(wb.appPool, workspaceId)).toBe(0);
  });
});
