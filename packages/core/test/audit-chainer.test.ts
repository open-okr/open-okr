import { auditEvents, newId, withWorkspace } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { GENESIS_HASH } from "../src/audit/chain.ts";
import { chainWorkspace, countPending } from "../src/audit/chainer.ts";
import { verifyWorkspaceChain } from "../src/audit/verify.ts";
import { runOperation } from "../src/operations/operation.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The audit chain, built behind the write path (P7-T02a).
 *
 * The trade this makes is precise, and each half needs proving. The write path
 * must no longer serialise, and it must still record every event atomically
 * with the change. The chainer must produce a chain the verifier accepts, in
 * the order the rows were written. And the verifier must tell "not chained
 * yet" from "tampered with", because conflating those two is how a change
 * like this quietly turns a security control into a warning nobody reads.
 */

let workspaceId: string;
let userId: string;

beforeEach(async () => {
  const wb = await workerDb();
  userId = newId();
  await wb.appPool.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [userId, "Chain", `${userId.slice(0, 13)}@example.com`],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: userId,
    name: `Chain ${userId.slice(0, 8)}`,
  });
  workspaceId = provisioned.workspaceId;
  // Provisioning writes its own audit rows, so chain them first and start
  // each test from a workspace whose trail is settled.
  await chainWorkspace(wb.appPool, workspaceId);
});

/** One trivial write through the pipeline, so an audit row exists. */
async function write(note: string): Promise<void> {
  const wb = await workerDb();
  await runOperation(
    { pool: wb.appPool },
    {
      action: "test.note",
      workspaceId,
      actor: { kind: "human", userId },
      async execute() {
        return {
          result: undefined,
          // An Operation owes an activity row as well as an audit one, so the
          // cheapest real pair is used rather than a fake: this is the shape
          // every write in the product produces.
          activity: {
            kind: "workspace.branding_updated" as const,
            subjectType: "workspace" as const,
            subjectId: workspaceId,
            payload: { note },
          },
          audit: {
            action: "test.note",
            targetType: "workspace",
            targetId: workspaceId,
            payload: { note },
          },
        };
      },
    },
  );
}

describe("the write path", () => {
  it("records the row and leaves it unchained", async () => {
    const wb = await workerDb();
    await write("one");

    const unchained = await withWorkspace(wb.db, workspaceId, (tx) =>
      tx
        .select({ action: auditEvents.action })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.workspaceId, workspaceId),
            isNull(auditEvents.seq),
          ),
        ),
    );
    // The event is recorded the moment the change commits. Only its position
    // in the chain waits.
    expect(unchained.map((row) => row.action)).toEqual(["test.note"]);
  });

  it("takes no advisory lock, so two writes do not serialise", async () => {
    const wb = await workerDb();
    // Both start before either finishes. Under the old lock the second waited
    // for the first's whole tail; the assertion here is only that both land,
    // because a timing assertion in a unit suite is a flake waiting to happen.
    await Promise.all([write("a"), write("b"), write("c")]);
    expect(await countPending(wb.appPool, workspaceId)).toBe(3);
  });
});

describe("the chainer", () => {
  it("gives every pending row a contiguous position", async () => {
    const wb = await workerDb();
    await write("one");
    await write("two");
    await write("three");

    const report = await chainWorkspace(wb.appPool, workspaceId);
    expect(report.chained).toBe(3);
    expect(report.pending).toBe(0);

    const rows = await withWorkspace(wb.db, workspaceId, (tx) =>
      tx
        .select({ seq: auditEvents.seq, prevHash: auditEvents.prevHash })
        .from(auditEvents)
        .where(eq(auditEvents.workspaceId, workspaceId))
        .orderBy(asc(auditEvents.seq)),
    );
    const sequence = rows.map((row) => Number(row.seq));
    expect(sequence).toEqual(
      Array.from({ length: rows.length }, (_value, index) => index + 1),
    );
    expect(rows[0]?.prevHash).toBe(GENESIS_HASH);
  });

  it("produces a chain the verifier accepts", async () => {
    const wb = await workerDb();
    await write("one");
    await write("two");
    await chainWorkspace(wb.appPool, workspaceId);

    const verdict = await verifyWorkspaceChain(wb.appPool, workspaceId);
    expect(verdict.ok).toBe(true);
    expect(verdict.pending).toBe(0);
    expect(verdict.checked).toBeGreaterThan(1);
  });

  it("continues from the head rather than starting again", async () => {
    const wb = await workerDb();
    await write("one");
    await chainWorkspace(wb.appPool, workspaceId);
    const first = await verifyWorkspaceChain(wb.appPool, workspaceId);

    await write("two");
    await chainWorkspace(wb.appPool, workspaceId);
    const second = await verifyWorkspaceChain(wb.appPool, workspaceId);

    expect(second.ok).toBe(true);
    expect(second.checked).toBe(first.checked + 1);
  });

  it("is idempotent: a second pass with nothing to do changes nothing", async () => {
    const wb = await workerDb();
    await write("one");
    await chainWorkspace(wb.appPool, workspaceId);
    const before = await verifyWorkspaceChain(wb.appPool, workspaceId);

    const again = await chainWorkspace(wb.appPool, workspaceId);
    expect(again.chained).toBe(0);

    const after = await verifyWorkspaceChain(wb.appPool, workspaceId);
    expect(after.checked).toBe(before.checked);
    expect(after.ok).toBe(true);
  });

  it("chains a batch larger than one pass", async () => {
    const wb = await workerDb();
    for (let n = 0; n < 7; n += 1) {
      await write(`row ${n}`);
    }
    // A batch size below the row count, so the loop runs more than once and
    // each pass has to pick up where the last left off.
    const report = await chainWorkspace(wb.appPool, workspaceId, 2);
    expect(report.pending).toBe(0);
    expect((await verifyWorkspaceChain(wb.appPool, workspaceId)).ok).toBe(true);
  });
});

describe("append-only survives the change", () => {
  it("still refuses an edit to what happened, even as the superuser", async () => {
    const wb = await workerDb();
    await write("one");
    await chainWorkspace(wb.appPool, workspaceId);

    // The property migration 0006 established and 0080 had to preserve: the
    // content is immutable by any route, including an owner connection.
    await expect(
      wb.admin.query(
        "update audit_events set action = 'rewritten' where workspace_id = $1",
        [workspaceId],
      ),
    ).rejects.toThrow(/append-only/);
  });

  it("still refuses a delete", async () => {
    const wb = await workerDb();
    await write("one");
    await expect(
      wb.admin.query("delete from audit_events where workspace_id = $1", [
        workspaceId,
      ]),
    ).rejects.toThrow(/append-only/);
  });

  it("refuses a second attempt to position an already chained row", async () => {
    const wb = await workerDb();
    await write("one");
    await chainWorkspace(wb.appPool, workspaceId);

    // Write-once, not writable. A row that already has a position cannot be
    // renumbered, which is what would let a chain be rebuilt around a gap.
    await expect(
      wb.admin.query(
        "update audit_events set seq = seq + 1000 where workspace_id = $1",
        [workspaceId],
      ),
    ).rejects.toThrow(/append-only/);
  });
});

describe("the verifier tells pending from tampered", () => {
  it("counts unchained rows as pending and still says ok", async () => {
    const wb = await workerDb();
    await write("one");
    await chainWorkspace(wb.appPool, workspaceId);
    await write("not chained yet");

    const verdict = await verifyWorkspaceChain(wb.appPool, workspaceId);
    // The whole point: a healthy busy instance always has a tail. Reporting
    // it as broken would cry wolf on every one of them.
    expect(verdict.ok).toBe(true);
    expect(verdict.pending).toBe(1);
  });

  it("still catches a row edited after it was chained", async () => {
    const wb = await workerDb();
    await write("one");
    await write("two");
    await chainWorkspace(wb.appPool, workspaceId);

    // **The trigger has to be turned off first, and that is the point.**
    // Migration 0080's row-level trigger refuses this edit even as the
    // superuser, so simulating a tamper means simulating an attacker who
    // already defeated it. The hash is the second line, and this proves the
    // second line holds when the first is gone.
    await wb.admin.query("alter table audit_events disable trigger all");
    try {
      await wb.admin.query(
        'update audit_events set payload = \'{"note":"edited"}\'::jsonb where workspace_id = $1 and seq = (select max(seq) from audit_events where workspace_id = $1)',
        [workspaceId],
      );
    } finally {
      await wb.admin.query("alter table audit_events enable trigger all");
    }

    const verdict = await verifyWorkspaceChain(wb.appPool, workspaceId);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("do not match its recorded hash");
  });

  it("still catches a chained row that was deleted", async () => {
    const wb = await workerDb();
    await write("one");
    await write("two");
    await write("three");
    await chainWorkspace(wb.appPool, workspaceId);

    // Same again: DELETE is refused outright by the trigger, so the attacker
    // this simulates has already got past it.
    await wb.admin.query("alter table audit_events disable trigger all");
    try {
      await wb.admin.query(
        "delete from audit_events where workspace_id = $1 and seq = (select max(seq) - 1 from audit_events where workspace_id = $1)",
        [workspaceId],
      );
    } finally {
      await wb.admin.query("alter table audit_events enable trigger all");
    }

    const verdict = await verifyWorkspaceChain(wb.appPool, workspaceId);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("missing or was reordered");
  });
});
