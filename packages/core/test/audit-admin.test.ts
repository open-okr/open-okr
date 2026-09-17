import { newId } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { chainWorkspace } from "../src/audit/chainer.ts";
import { AUDIT_EXPORT_COLUMNS } from "../src/audit/export.ts";
import { runOperation } from "../src/operations/operation.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The audit trail as an administrator reaches it (P8-T10).
 *
 * Acceptance criterion: given a tampered audit row, when verification runs,
 * then it is detected and located.
 *
 * The chainer's own suite proves the verifier tells a pending row from a
 * tampered one. What is proved here is the half an administrator meets: the
 * action they press says the same thing, the export carries what an auditor
 * can check it against, and neither is reachable by somebody who cannot
 * already read those rows.
 */

let workspaceId: string;
let userId: string;

beforeEach(async () => {
  const wb = await workerDb();
  userId = newId();
  await wb.appPool.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [userId, "Auditor", `${userId.slice(0, 13)}@example.com`],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: userId,
    name: `Audit ${userId.slice(0, 8)}`,
  });
  workspaceId = provisioned.workspaceId;
  await chainWorkspace(wb.appPool, workspaceId);
});

const asAdmin = async () => ({
  pool: (await workerDb()).appPool,
  workspaceId,
  actor: { kind: "human" as const, userId },
});

/** One write through the pipeline, so there is a row to find. */
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

describe("verifying the chain from the screen", () => {
  it("says it is intact, and counts what it checked", async () => {
    const wb = await workerDb();
    await write("one");
    await chainWorkspace(wb.appPool, workspaceId);

    const verdict = await callAction(await asAdmin(), "audit.verify", {});

    expect(verdict.ok).toBe(true);
    expect(verdict.checked).toBeGreaterThan(0);
    expect(verdict.pending).toBe(0);
    expect(verdict.brokenAtSeq).toBeNull();
  });

  it("counts a row that has no position yet, and calls it pending", async () => {
    await write("not chained yet");

    const verdict = await callAction(await asAdmin(), "audit.verify", {});

    // Pending, not broken. A busy workspace always has a short tail, and
    // reporting it as tampering would cry wolf on every healthy instance.
    expect(verdict.ok).toBe(true);
    expect(verdict.pending).toBe(1);
  });

  it("detects a tampered row and says where it is", async () => {
    const wb = await workerDb();
    await write("before");
    await write("after");
    await chainWorkspace(wb.appPool, workspaceId);

    // **The trigger has to be turned off first, and that is the point.**
    // Migration 0080 refuses this edit even as the superuser, so what is
    // simulated here is an attacker who has already defeated the first line.
    // The chain is the second, and this is the test that it holds alone.
    await wb.admin.query("alter table audit_events disable trigger all");
    let seq: number;
    try {
      const tampered = await wb.admin.query(
        `update audit_events
            set payload = '{"note":"edited"}'::jsonb
          where workspace_id = $1
            and seq = (select max(seq) from audit_events where workspace_id = $1)
          returning seq`,
        [workspaceId],
      );
      seq = Number(tampered.rows[0]?.seq);
    } finally {
      await wb.admin.query("alter table audit_events enable trigger all");
    }

    const verdict = await callAction(await asAdmin(), "audit.verify", {});

    expect(verdict.ok).toBe(false);
    expect(verdict.brokenAtSeq).toBe(seq);
    expect(verdict.reason).toBeTruthy();
  });
});

describe("exporting the trail", () => {
  it("hands over a CSV with the position and the hash in it", async () => {
    const wb = await workerDb();
    await write("exported");
    await chainWorkspace(wb.appPool, workspaceId);

    const file = await callAction(await asAdmin(), "audit.export", {
      limit: 100,
    });

    expect(file.filename).toMatch(/^audit-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(file.rowCount).toBeGreaterThan(0);
    expect(file.truncated).toBe(false);

    const [header] = file.csv.split("\r\n");
    // The header carries every column, quoted, with the byte-order mark the
    // CSV writer puts in front of it.
    for (const column of AUDIT_EXPORT_COLUMNS) {
      expect(header).toContain(`"${column}"`);
    }
    expect(file.csv).toContain('"test.note"');
  });

  it("narrows by action, and answers nothing when nothing matches", async () => {
    const wb = await workerDb();
    await write("one");
    await chainWorkspace(wb.appPool, workspaceId);

    const matching = await callAction(await asAdmin(), "audit.export", {
      action: "test.note",
      limit: 100,
    });
    expect(matching.rowCount).toBe(1);

    const none = await callAction(await asAdmin(), "audit.export", {
      action: "nothing.everHappened",
      limit: 100,
    });
    expect(none.rowCount).toBe(0);
  });

  it("narrows by date, and a range that excludes everything is empty", async () => {
    await write("today");

    const future = await callAction(await asAdmin(), "audit.export", {
      from: "2099-01-01T00:00:00.000Z",
      limit: 100,
    });
    expect(future.rowCount).toBe(0);

    const past = await callAction(await asAdmin(), "audit.export", {
      from: "2000-01-01T00:00:00.000Z",
      limit: 100,
    });
    expect(past.rowCount).toBeGreaterThan(0);
  });

  it("refuses a range that ends before it starts", async () => {
    await expect(
      callAction(await asAdmin(), "audit.export", {
        from: "2026-02-01T00:00:00.000Z",
        to: "2026-01-01T00:00:00.000Z",
        limit: 100,
      }),
    ).rejects.toThrow(/before its start/);
  });

  it("says when it stopped at the ceiling rather than dropping the tail", async () => {
    await write("one");
    await write("two");
    await write("three");

    const file = await callAction(await asAdmin(), "audit.export", {
      limit: 2,
    });

    expect(file.rowCount).toBe(2);
    expect(file.truncated).toBe(true);
  });

  it("records itself, with the filter that was used", async () => {
    const wb = await workerDb();
    await callAction(await asAdmin(), "audit.export", {
      action: "test.note",
      limit: 100,
    });

    const { rows } = await wb.admin.query(
      `select payload from audit_events
        where workspace_id = $1 and action = 'audit.export'`,
      [workspaceId],
    );
    expect(rows).toHaveLength(1);
    const payload = rows[0]?.payload as { action?: string; rowCount?: number };
    expect(payload.action).toBe("test.note");
    expect(payload.rowCount).toBe(0);
  });
});
