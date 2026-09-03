import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The legacy identity on a create, and the run record behind an import
 * (TECHNICAL-PLAN §7.1, P6-T01a).
 *
 * The importer's own tests drive whole files. What belongs here is what the
 * *actions* promise, because every surface can reach them: that a create
 * carrying a source identifier writes it, that a second create carrying the
 * same one is refused with a sentence rather than a constraint violation, and
 * that a run closes once.
 */

const OWNER = "imports-owner";

let workspaceId: string;
let memberId: string;
let spaceId: string;
let cycleId: string;

const call = async (name: string, input: unknown, bulk = false) => {
  const wb = await workerDb();
  return callAction(
    {
      pool: wb.appPool,
      workspaceId,
      actor: { kind: "human" as const, userId: OWNER },
      ...(bulk ? { bulk: true } : {}),
    },
    name as never,
    input as never,
  );
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, 'Ada', $2)",
    [OWNER, "imports-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Ada",
  });
  workspaceId = provisioned.workspaceId;
  memberId = provisioned.memberId;

  const spaces = (await call("spaces.list", {})) as { id: string }[];
  spaceId = spaces[0]?.id as string;
  const cycle = (await call("cycles.current", { mode: "quarterly" })) as {
    id: string;
  };
  cycleId = cycle.id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

const goal = (legacyId: string | undefined, title: string) =>
  call("goals.create", {
    title,
    cycleId,
    spaceId,
    level: "team",
    ownerKind: "space",
    championId: memberId,
    reviewerId: memberId,
    ...(legacyId ? { legacy: { type: "csv", id: legacyId } } : {}),
  });

describe("the legacy identity on a create", () => {
  it("writes both columns, which is what makes a re-run idempotent", async () => {
    const created = (await goal("obj-1", "Make onboarding obvious")) as {
      id: string;
    };
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{
      legacy_type: string;
      legacy_id: string;
    }>("select legacy_type, legacy_id from goals where id = $1", [created.id]);
    expect(rows[0]).toEqual({ legacy_type: "csv", legacy_id: "obj-1" });
  });

  it("leaves both columns null for a goal created in the product", async () => {
    const created = (await goal(undefined, "Typed by a person")) as {
      id: string;
    };
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{
      legacy_type: string | null;
      legacy_id: string | null;
    }>("select legacy_type, legacy_id from goals where id = $1", [created.id]);
    expect(rows[0]).toEqual({ legacy_type: null, legacy_id: null });
  });

  it("refuses a second create carrying an identifier already here", async () => {
    await goal("obj-1", "The first one");
    // The unique index would refuse this too, as a fault the caller reads as a
    // crash. This is the same refusal as a sentence, and it says what to do.
    await expect(goal("obj-1", "The second one")).rejects.toThrow(
      /already carries the csv identifier "obj-1". Update that one instead./,
    );
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ n: number }>(
      "select count(*)::int as n from goals",
    );
    expect(rows[0]?.n).toBe(1);
  });
});

describe("the run record", () => {
  it("records a run as it starts, before anything is loaded", async () => {
    const run = (await call("imports.startRun", {
      source: "csv",
      entity: "goals",
      mode: "dry_run",
      filename: "goals.csv",
    })) as { id: string };

    const listed = (await call("imports.listRuns", { limit: 10 })) as {
      runs: { id: string; status: string; finishedAt: string | null }[];
    };
    expect(listed.runs).toHaveLength(1);
    expect(listed.runs[0]?.id).toBe(run.id);
    // Running, and open. A run that died here would say exactly this rather
    // than leaving nothing behind.
    expect(listed.runs[0]?.status).toBe("running");
    expect(listed.runs[0]?.finishedAt).toBeNull();
  });

  it("closes with its counts and its report", async () => {
    const run = (await call("imports.startRun", {
      source: "csv",
      entity: "goals",
      mode: "real",
    })) as { id: string };

    await call("imports.finishRun", {
      id: run.id,
      status: "completed",
      rowsRead: 3,
      rowsWritten: 2,
      rowsSkipped: 1,
      report: { rows: [{ line: 4, outcome: "skipped", reason: "level" }] },
    });

    const listed = (await call("imports.listRuns", { limit: 10 })) as {
      runs: {
        status: string;
        rowsRead: number;
        rowsWritten: number;
        rowsSkipped: number;
        report: Record<string, unknown>;
        finishedAt: string | null;
      }[];
    };
    const first = listed.runs[0];
    expect(first?.status).toBe("completed");
    expect(first?.rowsRead).toBe(3);
    expect(first?.rowsWritten).toBe(2);
    expect(first?.rowsSkipped).toBe(1);
    expect(first?.finishedAt).not.toBeNull();
    expect(first?.report).toEqual({
      rows: [{ line: 4, outcome: "skipped", reason: "level" }],
    });
  });

  it("closes once, so a second close cannot overwrite the counts", async () => {
    const run = (await call("imports.startRun", {
      source: "csv",
      mode: "real",
    })) as { id: string };
    await call("imports.finishRun", {
      id: run.id,
      status: "completed",
      rowsRead: 1,
      rowsWritten: 1,
      rowsSkipped: 0,
    });

    await expect(
      call("imports.finishRun", {
        id: run.id,
        status: "failed",
        rowsRead: 0,
        rowsWritten: 0,
        rowsSkipped: 0,
      }),
    ).rejects.toThrow(/already finished/);
  });

  it("audits both writes, because an import is a thing somebody did", async () => {
    const run = (await call("imports.startRun", {
      source: "csv",
      entity: "goals",
      mode: "real",
    })) as { id: string };
    await call("imports.finishRun", {
      id: run.id,
      status: "completed",
      rowsRead: 0,
      rowsWritten: 0,
      rowsSkipped: 0,
    });

    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ action: string }>(
      "select action from audit_events where action like 'imports.%' order by at",
    );
    expect(rows.map((row) => row.action)).toEqual([
      "imports.startRun",
      "imports.finishRun",
    ]);
  });
});
