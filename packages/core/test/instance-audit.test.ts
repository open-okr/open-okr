import { workerDb } from "@openokr/test-support/db";
import { afterAll, describe, expect, it } from "vitest";
import { GENESIS_HASH } from "../src/audit/chain.ts";
import {
  type InstanceAuditRow,
  instanceAuditRowHash,
  recordInstanceAuditEvent,
  verifyInstanceChain,
} from "../src/audit/instance-chain.ts";

/**
 * The instance-level audit chain (P1/P2-hardening test plan, TECHNICAL-PLAN
 * §8.2). Closes the oldest open item this codebase carried: sign-in lockout
 * enforced since P1-T05 with no audit entry, because `audit_events
 * .workspace_id` is not null and a failed sign-in has no workspace yet.
 */

const row = (overrides: Partial<InstanceAuditRow> = {}): InstanceAuditRow => ({
  seq: 1,
  action: "auth.rate_limited",
  payload: { path: "/api/auth/sign-in/email", address: "203.0.113.9" },
  at: new Date("2026-08-10T10:00:00.000Z"),
  prevHash: GENESIS_HASH,
  ...overrides,
});

describe("instanceAuditRowHash and verifyInstanceChain (pure)", () => {
  it("hashes deterministically", () => {
    expect(instanceAuditRowHash(row())).toBe(instanceAuditRowHash(row()));
  });

  it("changes if the payload changes", () => {
    const a = instanceAuditRowHash(row());
    const b = instanceAuditRowHash(row({ payload: { path: "/other" } }));
    expect(a).not.toBe(b);
  });

  it("verifies a well-formed chain", () => {
    const first = row();
    const second = row({
      seq: 2,
      prevHash: instanceAuditRowHash(first),
    });
    const verdict = verifyInstanceChain([
      { ...first, rowHash: instanceAuditRowHash(first) },
      { ...second, rowHash: instanceAuditRowHash(second) },
    ]);
    expect(verdict).toEqual({ ok: true, checked: 2 });
  });

  it("catches a row edited after the fact", () => {
    const first = row();
    const tampered = {
      ...first,
      rowHash: instanceAuditRowHash(first),
      action: "auth.something_else",
    };
    const verdict = verifyInstanceChain([tampered]);
    expect(verdict.ok).toBe(false);
    expect(verdict.brokenAtSeq).toBe(1);
  });

  it("catches a missing row by its sequence gap", () => {
    const second = row({ seq: 2 });
    const verdict = verifyInstanceChain([
      { ...second, rowHash: instanceAuditRowHash(second) },
    ]);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/expected sequence 1/);
  });
});

describe("recordInstanceAuditEvent", () => {
  afterAll(async () => {
    const wb = await workerDb();
    await wb.close();
  });

  it("appends the first row of the chain with the genesis prevHash", async () => {
    const wb = await workerDb();
    await wb.admin.query("truncate table instance_audit_events");

    await recordInstanceAuditEvent(wb.appPool, {
      action: "auth.rate_limited",
      payload: { path: "/api/auth/sign-in/email", address: "203.0.113.9" },
    });

    const rows = await wb.admin.query(
      "select seq, action, payload, prev_hash, row_hash from instance_audit_events order by seq",
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].seq).toBe("1");
    expect(rows.rows[0].prev_hash).toBe(GENESIS_HASH);
  });

  it("chains a second event to the first rather than starting over", async () => {
    const wb = await workerDb();
    await wb.admin.query("truncate table instance_audit_events");

    await recordInstanceAuditEvent(wb.appPool, {
      action: "auth.rate_limited",
      payload: { path: "/a" },
    });
    await recordInstanceAuditEvent(wb.appPool, {
      action: "auth.rate_limited",
      payload: { path: "/b" },
    });

    const rows = await wb.admin.query(
      "select seq, prev_hash, row_hash from instance_audit_events order by seq",
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[1].prev_hash).toBe(rows.rows[0].row_hash);
  });

  it("survives concurrent writers without a duplicate sequence number", async () => {
    const wb = await workerDb();
    await wb.admin.query("truncate table instance_audit_events");

    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        recordInstanceAuditEvent(wb.appPool, {
          action: "auth.rate_limited",
          payload: { path: `/${i}` },
        }),
      ),
    );

    const rows = await wb.admin.query(
      "select seq from instance_audit_events order by seq",
    );
    expect(rows.rows.map((r) => Number(r.seq))).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("instance_audit_events is append-only", () => {
  it("refuses an update from the application role", async () => {
    const wb = await workerDb();
    await recordInstanceAuditEvent(wb.appPool, { action: "auth.rate_limited" });

    const failure = await wb.appPool
      .query("update instance_audit_events set action = 'forged'")
      .then(
        () => undefined,
        (error: unknown) => error as Error,
      );

    expect(failure).toBeInstanceOf(Error);
    expect(failure?.message).toMatch(/permission denied|append-only/i);
  });

  it("refuses a delete even from a superuser, because grants are not the only guard", async () => {
    const wb = await workerDb();
    await recordInstanceAuditEvent(wb.appPool, { action: "auth.rate_limited" });

    const failure = await wb.admin
      .query("delete from instance_audit_events")
      .then(
        () => undefined,
        (error: unknown) => error as Error,
      );

    expect(failure).toBeInstanceOf(Error);
    expect(failure?.message).toMatch(/append-only/i);
  });
});
