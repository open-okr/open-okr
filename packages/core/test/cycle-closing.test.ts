import { newShortId } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { sweepEndedCycles } from "../src/cycles/closing.ts";
import { OperationError } from "../src/operations/errors.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Moving a cycle to `closing` (docs/design/okr-core-domain.md §10, plan 0.7.0
 * O2, approved by Akmal on 9 November 2026, Q1 yes).
 *
 * The date moves it: an hourly sweep moves every planning or active cycle
 * whose end has passed in the workspace's own timezone. The facilitator may
 * start it early, and undo that while the end has not passed. `closing`
 * permits what `active` permits, except publishing.
 */

const OWNER = "closing-owner";
let workspaceId: string;

const call = async <T>(name: string, input: unknown): Promise<T> =>
  (await callAction(
    {
      pool: (await workerDb()).appPool,
      workspaceId,
      actor: { kind: "human" as const, userId: OWNER },
    },
    name as never,
    input as never,
  )) as T;

const cycleRow = async (id: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query(
    "select status, phase, published_at from cycles where id = $1",
    [id],
  );
  return rows[0] as {
    status: string;
    phase: number;
    published_at: Date | null;
  };
};

const rowsFor = async (cycleId: string) => {
  const wb = await workerDb();
  const activity = await wb.admin.query(
    "select payload from activities where kind = 'cycle.closing_started' and payload->>'cycleId' = $1",
    [cycleId],
  );
  const audit = await wb.admin.query(
    "select payload from audit_events where action = 'cycles.sweepEnded' and target_id = $1",
    [cycleId],
  );
  return { activity: activity.rows, audit: audit.rows };
};

/** A quarterly cycle with these dates, made directly as an old instance would hold it. */
const cycleEnding = async (
  endsOn: string,
  status: "planning" | "active" | "closed" = "active",
) => {
  const wb = await workerDb();
  const startsOn = `${endsOn.slice(0, 4)}-${String(Number(endsOn.slice(5, 7)) - 2).padStart(2, "0")}-01`;
  const { rows } = await wb.admin.query(
    `insert into cycles (id, workspace_id, name, mode, cadence, starts_on, ends_on, status, phase, published_at, short_id)
     values (gen_random_uuid(), $1, $2, 'quarterly', 'quarterly', $3, $4, $5, 6,
             case when $5 in ('active', 'closed') then now() else null end, $6)
     returning id`,
    [workspaceId, `Ending ${endsOn}`, startsOn, endsOn, status, newShortId()],
  );
  return rows[0].id as string;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, 'Owner', $2)",
    [OWNER, `${OWNER}@example.com`],
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, { id: OWNER, name: "Owner" })
  ).workspaceId;
  // The workspace's own timezone is in its settings (`workspaceTimeZone`).
  await wb.admin.query(
    `update workspaces set settings = settings || '{"timezone": "Asia/Jakarta"}'::jsonb
      where id = $1`,
    [workspaceId],
  );
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the date moves a cycle to closing", () => {
  it("moves an ended active cycle at the workspace's midnight, with one activity and one audit row", async () => {
    const id = await cycleEnding("2027-03-31");
    const wb = await workerDb();

    // 23:30 on 31 March in Jakarta is 16:30 UTC. (The workspace's own
    // provisioned quarter has ended by then too, so the totals are not this
    // cycle's; its row is what is judged.)
    await sweepEndedCycles(
      wb.appPool,
      workspaceId,
      new Date("2027-03-31T16:30:00Z"),
    );
    expect((await cycleRow(id)).status).toBe("active");

    // 00:30 on 1 April in Jakarta.
    await sweepEndedCycles(
      wb.appPool,
      workspaceId,
      new Date("2027-03-31T17:30:00Z"),
    );
    expect(await cycleRow(id)).toMatchObject({ status: "closing", phase: 7 });
    const { activity, audit } = await rowsFor(id);
    expect(activity).toHaveLength(1);
    expect(activity[0].payload).toMatchObject({ by: "date" });
    expect(audit).toHaveLength(1);
  });

  it("writes nothing the second time", async () => {
    const id = await cycleEnding("2027-03-31");
    const wb = await workerDb();
    const after = new Date("2027-04-02T00:00:00Z");
    await sweepEndedCycles(wb.appPool, workspaceId, after);
    expect(await sweepEndedCycles(wb.appPool, workspaceId, after)).toBe(0);
    expect((await rowsFor(id)).audit).toHaveLength(1);
  });

  it("moves an ended cycle that was never published too (Q1)", async () => {
    const id = await cycleEnding("2027-03-31", "planning");
    const wb = await workerDb();
    await sweepEndedCycles(
      wb.appPool,
      workspaceId,
      new Date("2027-04-02T00:00:00Z"),
    );
    expect((await cycleRow(id)).status).toBe("closing");
  });

  it("leaves a closed cycle closed", async () => {
    const id = await cycleEnding("2027-03-31", "closed");
    const wb = await workerDb();
    await sweepEndedCycles(
      wb.appPool,
      workspaceId,
      new Date("2027-04-02T00:00:00Z"),
    );
    expect((await cycleRow(id)).status).toBe("closed");
  });
});

describe("the facilitator starts closing early", () => {
  const endingSoon = () => {
    const end = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    return cycleEnding(end.toISOString().slice(0, 10));
  };

  it("moves an active cycle to closing, and back to active at phase 6", async () => {
    const id = await endingSoon();
    await call("cycles.setClosing", { cycleId: id, closing: true });
    expect(await cycleRow(id)).toMatchObject({ status: "closing", phase: 7 });

    await call("cycles.setClosing", { cycleId: id, closing: false });
    expect(await cycleRow(id)).toMatchObject({ status: "active", phase: 6 });
  });

  it("refuses to undo it once the end has passed, naming the date", async () => {
    const id = await cycleEnding("2026-03-31");
    const wb = await workerDb();
    await sweepEndedCycles(wb.appPool, workspaceId, new Date());
    const refused = await call("cycles.setClosing", {
      cycleId: id,
      closing: false,
    }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(OperationError);
    expect((refused as OperationError).message).toContain("2026-03-31");
  });

  it("refuses to publish a closing cycle", async () => {
    const id = await cycleEnding("2026-03-31", "planning");
    const wb = await workerDb();
    await sweepEndedCycles(wb.appPool, workspaceId, new Date());
    const refused = await call("workflow.publish", { cycleId: id }).catch(
      (error: unknown) => error,
    );
    expect((refused as Error).message).toMatch(/has ended or is closing/);
  });
});

describe("creating a cycle for a period", () => {
  it("gives a period that has ended the closing status, at phase 7", async () => {
    const created = await call<{ id: string }>("cycles.create", {
      on: "2026-02-15",
      cadence: "quarterly",
    });
    expect(await cycleRow(created.id)).toMatchObject({
      status: "closing",
      phase: 7,
    });
  });

  it("leaves a period still ahead as planning", async () => {
    const ahead = new Date(Date.now() + 200 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const created = await call<{ id: string }>("cycles.create", {
      on: ahead,
      cadence: "quarterly",
    });
    expect((await cycleRow(created.id)).status).toBe("planning");
  });
});
