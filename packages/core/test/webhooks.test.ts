import { withWorkspace } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { ActionCallContext } from "../src/actions/define.ts";
import { callAction } from "../src/actions/registry.ts";
import { REST_ROUTES } from "../src/api/surface.ts";
import { provisionMemberForInvite } from "../src/invitations/provisioning.ts";
import { parseKeyRing } from "../src/secrets/key-ring.ts";
import { WEBHOOK_DELIVER_TOPIC } from "../src/webhooks/jobs.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Outbound webhooks, the writes and what they enqueue
 * (docs/design/outbound-webhooks.md, plan 0.7.0 D5, approved 10 November
 * 2026).
 *
 * The delivery itself, signed through the guard, is
 * `webhook-delivery.test.ts`. This is everything up to the outbox row: the
 * secret shown once, the address refused before it is stored, and a write
 * enqueueing one row per waiting hook and none when nothing waits.
 */

const OWNER = "webhooks-owner";
const ADMIN = "webhooks-admin";
const MEMBER = "webhooks-member";

const ring = parseKeyRing({
  current: "5UB2Ez1oQ0Rr8sT1n5x7yWl4qKcM9vHfJbGdApXeZi0=",
});

let workspaceId: string;
let ownerMemberId: string;
let adminMemberId: string;
let cycleId: string;

/** The guard's address check, without a network: `.internal` is private. */
const checkOutboundUrl: NonNullable<
  ActionCallContext["checkOutboundUrl"]
> = async (url) => {
  const host = new URL(url).hostname;
  return host.endsWith(".internal")
    ? {
        ok: false,
        detail: `${host} resolves to 10.0.0.5, which is private or reserved.`,
      }
    : { ok: true };
};

const as = async (userId: string): Promise<ActionCallContext> => ({
  pool: (await workerDb()).appPool,
  workspaceId,
  actor: { kind: "human", userId },
  ring,
  checkOutboundUrl,
});

const call = async <T>(userId: string, action: string, input: unknown) =>
  (await callAction(await as(userId), action as never, input as never)) as T;

interface Hook {
  readonly id: string;
  readonly state: string;
  readonly secret?: string;
}

const createHook = (
  userId: string,
  input: Partial<{
    events: string[];
    spaceId: string;
    url: string;
    name: string;
  }> = {},
) =>
  call<Hook>(userId, "webhooks.create", {
    name: input.name ?? "Zapier",
    url: input.url ?? "https://hooks.example/okr",
    events: input.events ?? ["objective.created"],
    ...(input.spaceId ? { spaceId: input.spaceId } : {}),
  });

async function deliveries() {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ payload: Record<string, unknown> }>(
    "select payload from outbox where topic = $1 order by created_at",
    [WEBHOOK_DELIVER_TOPIC],
  );
  return rows.map((row) => row.payload);
}

const createGoal = (title: string, spaceId?: string) =>
  call<{ id: string }>(OWNER, "goals.create", {
    title,
    cycleId,
    level: "team",
    ...(spaceId ? { ownerKind: "space", spaceId } : { ownerKind: "workspace" }),
    championId: ownerMemberId,
  });

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $1, $2), ($3, $3, $4), ($5, $5, $6)",
    [
      OWNER,
      "webhooks-owner@example.com",
      ADMIN,
      "webhooks-admin@example.com",
      MEMBER,
      "webhooks-member@example.com",
    ],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: OWNER,
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
  for (const user of [ADMIN, MEMBER]) {
    const joined = await withWorkspace(drizzle(wb.appPool), workspaceId, (tx) =>
      provisionMemberForInvite(tx, {
        workspaceId,
        user: { id: user, name: user },
      }),
    );
    if (user === ADMIN) {
      adminMemberId = joined.memberId;
    }
  }
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

describe("making a hook", () => {
  it("answers with the secret once, stores it sealed, and never reads it back", async () => {
    const created = await createHook(ADMIN);
    expect(created.secret).toMatch(/^whsec_/);
    expect(created.state).toBe("on");

    const listed = await call<{ webhooks: Hook[] }>(ADMIN, "webhooks.list", {});
    expect(listed.webhooks).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(created.secret);
    expect(JSON.stringify(listed)).not.toMatch(/ciphertext|data_?key/i);

    const wb = await workerDb();
    const stored = await wb.admin.query<Record<string, unknown>>(
      "select * from webhooks where id = $1",
      [created.id],
    );
    expect(JSON.stringify(stored.rows)).not.toContain(created.secret);
    expect(stored.rows[0]?.secret_ciphertext).toBeTruthy();

    const audit = await wb.admin.query<{ payload: Record<string, unknown> }>(
      "select payload from audit_events where action = 'webhooks.create'",
    );
    expect(audit.rows).toHaveLength(1);
    expect(JSON.stringify(audit.rows[0]?.payload)).not.toContain(
      created.secret,
    );
    expect(audit.rows[0]?.payload).toMatchObject({ host: "hooks.example" });
    expect(JSON.stringify(audit.rows[0]?.payload)).not.toContain("/okr");
  });

  it("refuses an address the guard refuses, under the address field", async () => {
    await expect(
      createHook(ADMIN, { url: "https://hooks.internal/okr" }),
    ).rejects.toMatchObject({
      code: "forbidden",
      field: "url",
      message: expect.stringContaining("private or reserved"),
    });
    expect(
      await call<{ webhooks: Hook[] }>(ADMIN, "webhooks.list", {}),
    ).toEqual({
      webhooks: [],
    });
  });

  it("refuses plain http where private targets are not allowed", async () => {
    await expect(
      createHook(ADMIN, { url: "http://hooks.example/okr" }),
    ).rejects.toMatchObject({ field: "url" });
  });

  it("is refused to a member below the admin level", async () => {
    await expect(createHook(MEMBER)).rejects.toMatchObject({
      code: expect.stringMatching(/forbidden|not_found/),
    });
    await expect(call(MEMBER, "webhooks.list", {})).rejects.toMatchObject({
      code: expect.stringMatching(/forbidden|not_found/),
    });
  });

  it("is never offered to an agent", () => {
    const webhookRoutes = REST_ROUTES.filter((route) =>
      route.action.startsWith("webhooks."),
    );
    expect(webhookRoutes.map((route) => route.action).sort()).toEqual([
      "webhooks.create",
      "webhooks.deliveries",
      "webhooks.list",
      "webhooks.redeliver",
      "webhooks.remove",
      "webhooks.rotateSecret",
      "webhooks.test",
      "webhooks.update",
    ]);
    for (const route of webhookRoutes) {
      expect(route.agentSurface, route.action).toBe(false);
    }
  });
});

describe("what a write enqueues", () => {
  it("enqueues nothing in a workspace with no hooks", async () => {
    await createGoal("Customers reach value in their first week");
    expect(await deliveries()).toEqual([]);
  });

  it("enqueues one row per hook waiting for the event, and none for the others", async () => {
    const first = await createHook(ADMIN, { name: "One" });
    const second = await createHook(ADMIN, { name: "Two" });
    await createHook(ADMIN, { name: "Other", events: ["kpi.recorded"] });

    const goal = await createGoal("Customers reach value in their first week");

    const rows = await deliveries();
    expect(rows.map((row) => row.webhookId).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    for (const row of rows) {
      expect(row).toMatchObject({
        workspaceId,
        event: "objective.created",
        subjectType: "goal",
        subjectId: goal.id,
      });
      expect(row.eventId).toMatch(/^msg_/);
    }
    // One event, told to two hooks: the same id for both.
    expect(new Set(rows.map((row) => row.eventId)).size).toBe(1);
  });

  it("writes no row while the owner is suspended, and shows the hook paused", async () => {
    const hook = await createHook(ADMIN);
    await call(OWNER, "people.suspend", { memberId: adminMemberId });

    await createGoal("Customers reach value in their first week");
    expect(await deliveries()).toEqual([]);

    const listed = await call<{ webhooks: Hook[] }>(OWNER, "webhooks.list", {});
    expect(listed.webhooks.find((one) => one.id === hook.id)?.state).toBe(
      "paused",
    );

    // Another administrator takes it over, which is audited with both members.
    const taken = await call<Hook & { owner: { id: string } }>(
      OWNER,
      "webhooks.update",
      { id: hook.id, takeOwnership: true },
    );
    expect(taken.state).toBe("on");
    expect(taken.owner.id).toBe(ownerMemberId);
    const wb = await workerDb();
    const audit = await wb.admin.query<{ payload: Record<string, unknown> }>(
      "select payload from audit_events where action = 'webhooks.update'",
    );
    expect(audit.rows[0]?.payload).toMatchObject({
      ownerFrom: adminMemberId,
      ownerTo: ownerMemberId,
    });

    await createGoal("Renewals happen without a call");
    expect(await deliveries()).toHaveLength(1);
  });

  it("writes no row for a hook that is turned off", async () => {
    const hook = await createHook(ADMIN);
    const off = await call<Hook & { offReason: string }>(
      ADMIN,
      "webhooks.update",
      {
        id: hook.id,
        enabled: false,
      },
    );
    expect(off).toMatchObject({ state: "off", offReason: "manual" });
    await createGoal("Customers reach value in their first week");
    expect(await deliveries()).toEqual([]);
  });

  it("limits a hook to its one space", async () => {
    const product = await call<{ id: string }>(OWNER, "spaces.create", {
      name: "Product",
    });
    const sales = await call<{ id: string }>(OWNER, "spaces.create", {
      name: "Sales",
    });
    const hook = await createHook(ADMIN, { spaceId: product.id });

    await createGoal("Close the quarter's renewals", sales.id);
    await createGoal("Ship the onboarding checklist");
    expect(await deliveries()).toEqual([]);

    const inside = await createGoal(
      "Customers reach value in week one",
      product.id,
    );
    expect(await deliveries()).toEqual([
      expect.objectContaining({ webhookId: hook.id, subjectId: inside.id }),
    ]);
  });

  it("reports a check-in once for each key result it covered", async () => {
    const goal = await createGoal("Customers reach value in their first week");
    const keyResults: string[] = [];
    for (const title of ["Activation rate", "Time to first value"]) {
      keyResults.push(
        (
          await call<{ id: string }>(OWNER, "goals.addKeyResult", {
            goalId: goal.id,
            title,
            indicatorType: "lagging",
            direction: "increase",
            baselineValue: 0,
            targetValue: 10,
          })
        ).id,
      );
    }
    const hook = await createHook(ADMIN, { events: ["key_result.checked_in"] });

    const draft = await call<{ id: string }>(OWNER, "goals.startCheckIn", {
      goalId: goal.id,
    });
    await call(OWNER, "goals.publishCheckIn", {
      id: draft.id,
      status: "on_track",
      confidence: 0.7,
      narrative: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Moving." }] },
        ],
      },
    });

    const rows = await deliveries();
    expect(rows.map((row) => row.subjectId).sort()).toEqual(
      [...keyResults].sort(),
    );
    for (const row of rows) {
      expect(row).toMatchObject({
        webhookId: hook.id,
        event: "key_result.checked_in",
        subjectType: "key_result",
        checkInId: draft.id,
      });
    }
  });
});

describe("a hook's secret, test and removal", () => {
  it("rotates the secret, keeping the old one signing for a day", async () => {
    const hook = await createHook(ADMIN);
    const rotated = await call<{ secret: string; previousSecretUntil: string }>(
      ADMIN,
      "webhooks.rotateSecret",
      { id: hook.id },
    );
    expect(rotated.secret).toMatch(/^whsec_/);
    expect(rotated.secret).not.toBe(hook.secret);
    const hours =
      (Date.parse(rotated.previousSecretUntil) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24);

    const listed = await call<{ webhooks: { previousSecretUntil: string }[] }>(
      ADMIN,
      "webhooks.list",
      {},
    );
    expect(listed.webhooks[0]?.previousSecretUntil).toBe(
      rotated.previousSecretUntil,
    );
  });

  it("refuses to turn on a hook with no secret until one is rotated in", async () => {
    const hook = await createHook(ADMIN);
    // What a workspace archive leaves: the hook, off, without its secret (W14).
    const wb = await workerDb();
    await wb.admin.query(
      `update webhooks set enabled = false, off_reason = 'imported',
         secret_ciphertext = null, secret_data_key = null, secret_key_id = null
       where id = $1`,
      [hook.id],
    );
    await expect(
      call(ADMIN, "webhooks.update", { id: hook.id, enabled: true }),
    ).rejects.toMatchObject({ code: "conflict", field: "enabled" });
    await expect(
      call(ADMIN, "webhooks.test", { id: hook.id }),
    ).rejects.toMatchObject({
      code: "conflict",
    });

    await call(ADMIN, "webhooks.rotateSecret", { id: hook.id });
    expect(
      await call<Hook>(ADMIN, "webhooks.update", {
        id: hook.id,
        enabled: true,
      }),
    ).toMatchObject({ state: "on", offReason: null });
  });

  it("sends a test as a ping with no subject", async () => {
    const hook = await createHook(ADMIN);
    const sent = await call<{ eventId: string }>(ADMIN, "webhooks.test", {
      id: hook.id,
    });
    expect(await deliveries()).toEqual([
      expect.objectContaining({
        webhookId: hook.id,
        event: "ping",
        eventId: sent.eventId,
        subjectType: null,
        subjectId: null,
      }),
    ]);
  });

  it("removes a hook, after which nothing waits on it", async () => {
    const hook = await createHook(ADMIN);
    await call(ADMIN, "webhooks.remove", { id: hook.id });
    expect(
      await call<{ webhooks: Hook[] }>(ADMIN, "webhooks.list", {}),
    ).toEqual({
      webhooks: [],
    });
    await createGoal("Customers reach value in their first week");
    expect(await deliveries()).toEqual([]);
    await expect(
      call(ADMIN, "webhooks.update", { id: hook.id, name: "Back" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
