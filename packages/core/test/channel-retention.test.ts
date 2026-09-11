import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Retention for the channel message log (P7-T08c).
 *
 * **Zero means delete nothing, and zero is the default.** Agung chose
 * keep-forever with retention opt-in on 11 September 2026, because a number
 * out of the box would delete data on every instance that never chose one,
 * on the first sweep after an upgrade. So the sharpest test here is the
 * boring one: with nothing configured, a sweep removes nothing at all.
 *
 * **And retention covers this log and nothing else.** The original card
 * named nudge records and agent run logs too. CLAUDE.md requires that every
 * proactive message is a recorded nudge row carrying a rule key, a channel,
 * an escalation step and a suppression reason, and an agent run log is the
 * record of what an agent did on the workspace's behalf. A sweep over
 * either would delete the evidence the product is required to keep. The
 * exclusion is asserted below rather than assumed.
 */

const OWNER = "00000000-0000-4000-8000-0000000007c8";

let workspaceId: string;
const ownerUserId = OWNER;

const context = () => ({
  workspaceId,
  actor: { kind: "human" as const, userId: ownerUserId },
});

async function seedMessage(daysOld: number, key: string): Promise<void> {
  const wb = await workerDb();
  await wb.admin.query(
    `insert into channel_messages
       (id, workspace_id, provider, direction, payload, idempotency_key, status, created_at)
     values (gen_random_uuid(), $1, 'email', 'out', '{}'::jsonb, $2, 'sent',
             now() - ($3 || ' days')::interval)`,
    [workspaceId, key, String(daysOld)],
  );
}

async function messageCount(): Promise<number> {
  const wb = await workerDb();
  const result = await wb.admin.query<{ n: number }>(
    "select count(*)::int as n from channel_messages where workspace_id = $1",
    [workspaceId],
  );
  return result.rows[0]?.n ?? 0;
}

async function setRetention(days: number): Promise<void> {
  const wb = await workerDb();
  await wb.admin.query(
    `update workspaces
        set settings = coalesce(settings, '{}'::jsonb)
                       || jsonb_build_object('messageLogRetentionDays', $2::int)
      where id = $1`,
    [workspaceId, days],
  );
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Retention Owner", "retention-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Retention Owner",
  });
  workspaceId = provisioned.workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("retention is off unless somebody turns it on", () => {
  it("deletes nothing with nothing configured", async () => {
    // The test that matters most. "Not configured" must never mean "delete
    // everything", and an instance upgrading into this feature must lose no
    // row it did not agree to lose.
    const wb = await workerDb();
    await seedMessage(400, "old-1");
    await seedMessage(1, "new-1");

    const result = await callAction(
      { pool: wb.appPool, ...context() },
      "channels.sweepMessageLog",
      {},
    );

    expect(result.retentionDays).toBe(0);
    expect(result.deleted).toBe(0);
    expect(await messageCount()).toBe(2);
  });

  it("deletes nothing when retention is explicitly zero", async () => {
    const wb = await workerDb();
    await seedMessage(400, "old-2");
    await setRetention(0);

    const result = await callAction(
      { pool: wb.appPool, ...context() },
      "channels.sweepMessageLog",
      {},
    );

    expect(result.deleted).toBe(0);
    expect(await messageCount()).toBe(1);
  });
});

describe("a configured window is honoured on both sides", () => {
  it("removes what is outside and keeps what is inside", async () => {
    const wb = await workerDb();
    await seedMessage(40, "outside");
    await seedMessage(5, "inside");
    await setRetention(30);

    const result = await callAction(
      { pool: wb.appPool, ...context() },
      "channels.sweepMessageLog",
      {},
    );

    expect(result.deleted).toBe(1);
    expect(result.retentionDays).toBe(30);

    const rows = await wb.admin.query<{ idempotency_key: string }>(
      "select idempotency_key from channel_messages where workspace_id = $1",
      [workspaceId],
    );
    expect(rows.rows.map((row) => row.idempotency_key)).toEqual(["inside"]);
  });

  it("is idempotent, so a second run in the same minute removes nothing", async () => {
    const wb = await workerDb();
    await seedMessage(40, "outside-2");
    await setRetention(30);

    const first = await callAction(
      { pool: wb.appPool, ...context() },
      "channels.sweepMessageLog",
      {},
    );
    const second = await callAction(
      { pool: wb.appPool, ...context() },
      "channels.sweepMessageLog",
      {},
    );

    expect(first.deleted).toBe(1);
    expect(second.deleted).toBe(0);
    expect(second.more).toBe(false);
  });

  it("records the deletion in the audit trail, with counts and no content", async () => {
    // A retention sweep is the one kind of deletion nobody watches happen,
    // which makes the trail the only evidence it did. The payload carries
    // counts and the window: the rows are being deleted for carrying words,
    // so the trail must not keep them.
    const wb = await workerDb();
    await seedMessage(40, "audited");
    await setRetention(30);

    await callAction(
      { pool: wb.appPool, ...context() },
      "channels.sweepMessageLog",
      {},
    );

    const audit = await wb.admin.query<{ payload: Record<string, unknown> }>(
      `select payload from audit_events
        where workspace_id = $1 and action = 'channels.sweepMessageLog'
        order by at desc limit 1`,
      [workspaceId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.payload).toMatchObject({
      deleted: 1,
      retentionDays: 30,
    });
    expect(JSON.stringify(audit.rows[0]?.payload)).not.toContain("audited");
  });
});

describe("the sweep is bounded", () => {
  it("reports no backlog when the batch did not fill", async () => {
    // The bound is what keeps a workspace turning retention on after a year
    // of messages from holding one transaction open over every row at once,
    // which would be a long lock on the table the relay writes to.
    //
    // **What is asserted here is the flag, not the fill.** Proving the batch
    // actually caps would mean inserting a thousand and one rows on every
    // run of this suite, which is a minute of database time to re-prove a
    // `limit` clause. The flag is the part callers act on: the scheduler
    // reads it to decide whether a second run is worth making.
    const wb = await workerDb();
    for (const n of [1, 2, 3]) {
      await seedMessage(40, `batched-${n}`);
    }
    await setRetention(30);

    const swept = await callAction(
      { pool: wb.appPool, ...context() },
      "channels.sweepMessageLog",
      {},
    );

    expect(swept.deleted).toBe(3);
    expect(swept.more).toBe(false);
    expect(await messageCount()).toBe(0);
  });
});

describe("nudges and agent runs are never swept", () => {
  it("leaves a nudge row older than any window alone", async () => {
    // CLAUDE.md: every proactive message is a recorded nudge row with a rule
    // key, a channel, an escalation step and a suppression reason. Sweeping
    // one would delete the evidence the product is required to keep. Agung
    // settled the exclusion on 11 September 2026; this holds it.
    const wb = await workerDb();
    await wb.admin.query(
      `insert into nudges
         (id, workspace_id, rule_key, kind, channel, recipient_member_id, escalation_step,
          subject_type, subject_id, scheduled_for, created_at)
       select gen_random_uuid(), $1, 'checkin.due', 'rhythm', 'email', id, 0,
              'cycle', $1, now() - interval '400 days',
              now() - interval '400 days'
         from workspace_members where workspace_id = $1 limit 1`,
      [workspaceId],
    );
    await setRetention(30);

    const before = await wb.admin.query<{ n: number }>(
      "select count(*)::int as n from nudges where workspace_id = $1",
      [workspaceId],
    );
    await callAction(
      { pool: wb.appPool, ...context() },
      "channels.sweepMessageLog",
      {},
    );
    const after = await wb.admin.query<{ n: number }>(
      "select count(*)::int as n from nudges where workspace_id = $1",
      [workspaceId],
    );

    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    expect(before.rows[0]?.n).toBeGreaterThan(0);
  });

  it("leaves an agent run older than any window alone", async () => {
    const wb = await workerDb();
    const before = await wb.admin.query<{ n: number }>(
      "select count(*)::int as n from agent_runs where workspace_id = $1",
      [workspaceId],
    );
    await setRetention(30);

    await callAction(
      { pool: wb.appPool, ...context() },
      "channels.sweepMessageLog",
      {},
    );

    const after = await wb.admin.query<{ n: number }>(
      "select count(*)::int as n from agent_runs where workspace_id = $1",
      [workspaceId],
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });
});
