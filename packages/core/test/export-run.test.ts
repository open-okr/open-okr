import { workerDb } from "@openokr/test-support/db";
import { strFromU8, unzipSync } from "fflate";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { runExportJob } from "../src/exports/worker.ts";
import { OUTBOX_HANDLERS } from "../src/outbox/handlers.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The large-export path (TECHNICAL-PLAN §4.9, §4.13, P5-T15).
 *
 * Acceptance criterion:
 *   Given a list larger than the inline limit, when a member exports it, then
 *   they are told it is being prepared and the file reaches them without the
 *   request having waited.
 *
 * **The limit is lowered rather than five thousand goals created.**
 * `exportInlineRowLimit` is a §4.14 setting with a default of 5000, so a test
 * sets it to one and two goals are already too many. What the criterion is about
 * is the branch, not the number: a request that returns `queued` with no file,
 * a row somebody can come back to, and a worker that produces the bytes
 * afterwards. Creating five thousand goals through the pipeline would take
 * minutes and prove the same branch.
 *
 * **`putFile` is a function here, as it is in production.** The relay host
 * passes one built from the storage port; this passes one that keeps the bytes
 * in memory, so the test can open the file the worker wrote.
 */

const OWNER = "export-owner";
const OTHER = "export-other";

let workspaceId: string;
let ownerMemberId: string;
let otherMemberId: string;
let spaceId: string;
let cycleId: string;

/** What `putFile` was handed, so a test can open the file the worker wrote. */
const written = new Map<string, { body: Buffer; contentType: string }>();

const putFile = async (input: {
  key: string;
  body: Buffer;
  contentType: string;
}) => {
  written.set(input.key, { body: input.body, contentType: input.contentType });
  return { key: input.key, size: input.body.byteLength };
};

const call = async (name: string, input: unknown, userId = OWNER) => {
  const wb = await workerDb();
  return callAction(
    {
      pool: wb.appPool,
      workspaceId,
      actor: { kind: "human" as const, userId },
    },
    name as never,
    input as never,
  );
};

/** The outbox rows the pipeline enqueued, newest first. */
const outbox = async (topic: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    payload: Record<string, unknown>;
    idempotency_key: string;
  }>(
    "select payload, idempotency_key from outbox where topic = $1 order by created_at desc",
    [topic],
  );
  return rows;
};

const runRow = async (id: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    state: string;
    blob_id: string | null;
    row_count: number | null;
    error: string | null;
    finished_at: Date | null;
  }>(
    "select state, blob_id, row_count, error, finished_at from export_runs where id = $1",
    [id],
  );
  return rows[0] ?? null;
};

beforeEach(async () => {
  const wb = await workerDb();
  written.clear();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, 'Ada', $2), ($3, 'Bo', $4)",
    [OWNER, "export-owner@example.com", OTHER, "export-other@example.com"],
  );

  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Ada",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;

  const other = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Bo', 'active') returning id`,
    [workspaceId, OTHER],
  );
  otherMemberId = other.rows[0]?.id as string;

  const spaces = (await call("spaces.list", {})) as { id: string }[];
  spaceId = spaces[0]?.id as string;
  const cycle = (await call("cycles.current", { mode: "quarterly" })) as {
    id: string;
  };
  cycleId = cycle.id;

  await call("goals.create", {
    title: "Raise weekly activation to sixty per cent",
    cycleId,
    spaceId,
    level: "team",
    ownerKind: "space",
    championId: ownerMemberId,
    reviewerId: ownerMemberId,
    weight: 1,
  });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

/** Lowers the inline limit so a two-row list is already too many. */
const lowerTheLimit = async (to: number) => {
  const wb = await workerDb();
  await wb.admin.query(
    "update workspaces set settings = settings || $2::jsonb where id = $1",
    [workspaceId, JSON.stringify({ exportInlineRowLimit: to })],
  );
};

/** Asks for an export through the action, over the lowered limit. */
const queueOne = async (format: "csv" | "xlsx" = "csv") => {
  // Zero would fail the setting's own schema, which requires a positive
  // integer, so the read falls back to the default. One is the smallest value
  // the setting accepts, and one goal is not more than one row. Two goals make
  // the list larger than the limit.
  await lowerTheLimit(1);
  await call("goals.create", {
    title: "Cut time to first value to two days",
    cycleId,
    spaceId,
    level: "team",
    ownerKind: "space",
    championId: ownerMemberId,
    reviewerId: ownerMemberId,
    weight: 1,
  });

  const asked = (await call("exports.list", { list: "goals", format })) as {
    runId: string | null;
    queued: boolean;
    csv: string | null;
    xlsxBase64: string | null;
    rowCount: number;
  };
  // The acceptance criterion's first half: told it is being prepared, and
  // handed no file.
  expect(asked.queued).toBe(true);
  expect(asked.csv).toBeNull();
  expect(asked.xlsxBase64).toBeNull();
  expect(asked.runId).not.toBeNull();

  // The delivery the relay will drain, keyed on the run so a redelivery names
  // the same work.
  const enqueued = await outbox("export.requested");
  expect(enqueued.map((row) => row.payload.runId)).toContain(asked.runId);
  expect(enqueued[0]?.idempotency_key).toBe(`export.requested:${asked.runId}`);

  return asked.runId as string;
};

describe("asking for a list", () => {
  it("builds a small one in the request, with no run behind it", async () => {
    const outcome = (await call("exports.list", { list: "goals" })) as {
      csv: string | null;
      queued: boolean;
      runId: string | null;
      rowCount: number;
    };

    expect(outcome.queued).toBe(false);
    expect(outcome.runId).toBeNull();
    expect(outcome.csv).toContain("Raise weekly activation");
    // Nothing queued, so nothing for the relay to do.
    expect(await outbox("export.requested")).toEqual([]);
  });

  it("answers a workbook as bytes rather than as text", async () => {
    const outcome = (await call("exports.list", {
      list: "goals",
      format: "xlsx",
    })) as { csv: string | null; xlsxBase64: string | null; filename: string };

    expect(outcome.csv).toBeNull();
    expect(outcome.filename).toMatch(/\.xlsx$/);
    const bytes = Buffer.from(outcome.xlsxBase64 as string, "base64");
    const files = unzipSync(new Uint8Array(bytes));
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"] as Uint8Array);
    expect(sheet).toContain("<row");
  });

  it("records the format on the audit row, which is what an export is", async () => {
    const wb = await workerDb();
    await call("exports.list", { list: "goals", format: "xlsx" });
    const { rows } = await wb.admin.query<{ payload: { format: string } }>(
      "select payload from audit_events where workspace_id = $1 and action = 'exports.list'",
      [workspaceId],
    );
    expect(rows[0]?.payload.format).toBe("xlsx");
  });
});

describe("acceptance: a queued export reaches the member who asked", () => {
  it("is prepared afterwards and the run points at the file", async () => {
    const runId = await queueOne();

    // Before the worker: nothing to collect, and the list says so.
    const before = (await call("exports.mine", {})) as {
      id: string;
      state: string;
      blobId: string | null;
    }[];
    expect(before.find((one) => one.id === runId)?.state).toBe("queued");
    expect(before.find((one) => one.id === runId)?.blobId).toBeNull();

    const wb = await workerDb();
    const outcome = await runExportJob(
      { workspaceId, runId },
      { pool: wb.appPool, putFile },
    );
    expect(outcome).toEqual({ kind: "built", rowCount: 2 });

    const run = await runRow(runId);
    expect(run?.state).toBe("ready");
    expect(run?.blob_id).not.toBeNull();
    expect(run?.finished_at).not.toBeNull();

    // The file itself, with the rows the member could see.
    const [stored] = [...written.values()];
    expect(stored?.contentType).toBe("text/csv;charset=utf-8");
    expect(stored?.body.toString("utf8")).toContain(
      "Raise weekly activation to sixty per cent",
    );

    // And the list now offers it.
    const after = (await call("exports.mine", {})) as {
      id: string;
      state: string;
      blobId: string | null;
    }[];
    expect(after.find((one) => one.id === runId)?.state).toBe("ready");
    expect(after.find((one) => one.id === runId)?.blobId).not.toBeNull();
  });

  it("writes a workbook when the run asked for one", async () => {
    const runId = await queueOne("xlsx");
    const wb = await workerDb();
    await runExportJob({ workspaceId, runId }, { pool: wb.appPool, putFile });

    const [stored] = [...written.values()];
    expect(stored?.contentType).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    const files = unzipSync(new Uint8Array(stored?.body as Buffer));
    expect(Object.keys(files)).toContain("xl/workbook.xml");
  });

  it("keys the file on the run, so a second delivery costs nothing", async () => {
    const runId = await queueOne();
    const wb = await workerDb();

    await runExportJob({ workspaceId, runId }, { pool: wb.appPool, putFile });
    const first = [...written.keys()];

    // At-least-once delivery: the relay may hand the same row over twice.
    const again = await runExportJob(
      { workspaceId, runId },
      { pool: wb.appPool, putFile },
    );
    expect(again).toEqual({ kind: "already_ready" });
    expect([...written.keys()]).toEqual(first);

    // One blob, not two.
    const { rows } = await wb.admin.query<{ count: string }>(
      "select count(*) from blobs where workspace_id = $1",
      [workspaceId],
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });
});

describe("who may collect a finished export", () => {
  it("shows a member only their own", async () => {
    const runId = await queueOne();
    const wb = await workerDb();
    await runExportJob({ workspaceId, runId }, { pool: wb.appPool, putFile });

    const mine = (await call("exports.mine", {}, OTHER)) as unknown[];
    // Bo is an active member with the standard workspace binding, so this is
    // not about access to the workspace. The file holds Ada's rows.
    expect(mine).toEqual([]);
    expect(otherMemberId.length).toBeGreaterThan(0);
  });

  it("refuses to build for a member who is no longer active", async () => {
    const wb = await workerDb();
    const runId = await queueOne();
    await wb.admin.query(
      "update workspace_members set status = 'suspended' where id = $1",
      [ownerMemberId],
    );

    const outcome = await runExportJob(
      { workspaceId, runId },
      { pool: wb.appPool, putFile },
    );
    expect(outcome.kind).toBe("failed");
    expect(written.size).toBe(0);

    const run = await runRow(runId);
    expect(run?.state).toBe("failed");
    // The sentence a person reads on the row, not a status code.
    expect(run?.error).toContain("no longer active");
  });

  it("says so on the run rather than throwing, so the row stops saying prepared", async () => {
    const wb = await workerDb();
    const runId = await queueOne();
    await wb.admin.query(
      "update export_runs set list = 'moons' where id = $1",
      [runId],
    );

    const outcome = await runExportJob(
      { workspaceId, runId },
      { pool: wb.appPool, putFile },
    );
    expect(outcome.kind).toBe("failed");
    expect((await runRow(runId))?.error).toContain("moons");
  });
});

describe("the relay's own wiring", () => {
  it("handles the topic rather than acknowledging it", async () => {
    const runId = await queueOne();
    const wb = await workerDb();
    const handler = OUTBOX_HANDLERS["export.requested"];
    expect(handler).toBeDefined();

    await handler?.(
      {
        topic: "export.requested",
        payload: { workspaceId, runId },
        idempotencyKey: `export.requested:${runId}`,
        attempts: 1,
      },
      { pool: wb.appPool, putFile },
    );

    expect((await runRow(runId))?.state).toBe("ready");
  });

  it("skips rather than fails when the deployment has no storage", async () => {
    const runId = await queueOne();
    const wb = await workerDb();
    const skipped: string[] = [];

    await OUTBOX_HANDLERS["export.requested"]?.(
      {
        topic: "export.requested",
        payload: { workspaceId, runId },
        idempotencyKey: `export.requested:${runId}`,
        attempts: 1,
      },
      {
        pool: wb.appPool,
        onSkipped: (_delivery, reason) => skipped.push(reason),
      },
    );

    expect(skipped).toEqual(["no file storage is configured"]);
    // Still queued, not failed: nothing was wrong with the request.
    expect((await runRow(runId))?.state).toBe("queued");
  });
});
