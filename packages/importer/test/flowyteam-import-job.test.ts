/**
 * Preview and import from the browser, end to end below the screen
 * (flowyteam-connect §4.1, Q4, card C4).
 *
 * The actions record the run and an outbox row; the outbox handler hands it
 * to the jobs port; the job reads FlowyTeam's export (a stub over the seeded
 * MySQL) and runs the engine. Each step is called here directly, in order,
 * which is what the relay and the scheduler do in a running instance.
 */
import { createHttpFlowyteamSource } from "@openokr/adapters";
import {
  callAction,
  dispatchOutbox,
  type FlowyteamGateway,
  type FlowyteamImportJob,
  OperationError,
  type OutboxDelivery,
  parseKeyRing,
  provisionWorkspaceForUser,
  runFlowyteamImportJob,
  type Source,
} from "@openokr/core";
import { workerDb } from "@openokr/test-support/db";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  type ExportStub,
  startExportStub,
} from "./support/flowyteam-export-stub.ts";
import {
  available,
  SEEDED,
  type SeededSource,
  SKIP_REASON,
  seedSource,
} from "./support/flowyteam-source.ts";

const OWNER = "66666666-6666-4666-8666-666666666666";
const TOKEN = "export-token-job";
const ORIGIN = "https://okr.example.test";
const ring = parseKeyRing({
  current: "5UB2Ez1oQ0Rr8sT1n5x7yWl4qKcM9vHfJbGdApXeZi0=",
});

const runnable = await available();
if (!runnable) {
  console.warn(`Skipping the FlowyTeam import job tests. ${SKIP_REASON}`);
}

const gateway: FlowyteamGateway = {
  async exchangeCode() {
    return {
      ok: true,
      value: { accessToken: TOKEN, scope: "flowyteam:export" },
    };
  },
  async readCompany() {
    return {
      ok: true,
      value: {
        companyId: String(SEEDED.first.id),
        companyName: SEEDED.first.name,
      },
    };
  },
  async revoke() {
    return { ok: true, value: null };
  },
};

describe.skipIf(!runnable)("FlowyTeam import as a background job", () => {
  let seeded: SeededSource;
  let stub: ExportStub;
  let workspaceId: string;
  const queued: { name: string; payload: Record<string, unknown> }[] = [];
  const published: { event: string; data: Record<string, unknown> }[] = [];

  const context = async () => {
    const wb = await workerDb();
    return {
      pool: wb.appPool,
      workspaceId,
      actor: { kind: "human" as const, userId: OWNER },
      ring,
      baseUrl: ORIGIN,
      flowyteam: gateway,
    };
  };

  const call = async (name: string, input: unknown) =>
    callAction(await context(), name as never, input as never) as Promise<
      Record<string, unknown>
    >;

  async function refusalOf(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
    } catch (error) {
      if (error instanceof OperationError) {
        return String(error.details?.reason ?? error.code);
      }
      throw error;
    }
    throw new Error("expected a refusal");
  }

  /** The relay's half: every pending outbox row of the import topic, delivered. */
  async function relay(): Promise<void> {
    const wb = await workerDb();
    const rows = await wb.admin.query(
      "select topic, payload, idempotency_key, attempts from outbox where topic = 'imports.flowyteamImport' and delivered_at is null order by created_at",
    );
    for (const row of rows.rows) {
      const delivery: OutboxDelivery = {
        topic: row.topic,
        payload: row.payload,
        idempotencyKey: row.idempotency_key,
        attempts: row.attempts,
      };
      await dispatchOutbox(delivery, {
        pool: wb.appPool,
        async enqueueJob(name, payload) {
          queued.push({ name, payload });
        },
      });
      await wb.admin.query(
        "update outbox set delivered_at = now() where idempotency_key = $1",
        [row.idempotency_key],
      );
    }
  }

  /** The scheduler's half: every queued job, run, follow-ups included. */
  async function work(options: { budgetMs?: number } = {}) {
    const wb = await workerDb();
    const outcomes = [];
    while (queued.length > 0) {
      const next = queued.shift();
      if (!next) break;
      outcomes.push(
        await runFlowyteamImportJob(
          next.payload as unknown as FlowyteamImportJob,
          {
            pool: wb.appPool,
            ring,
            openSource: (input) =>
              createHttpFlowyteamSource({
                ...input,
                allowPrivate: true,
                backoffMs: 0,
              }) as Source,
            async publish(_channel, event, data) {
              published.push({ event, data });
            },
            async enqueueFollowUp(job) {
              queued.push({
                name: "imports.flowyteamImport",
                payload: job as unknown as Record<string, unknown>,
              });
            },
            ...(options.budgetMs !== undefined
              ? { budgetMs: options.budgetMs }
              : {}),
          },
        ),
      );
    }
    return outcomes;
  }

  async function connect(): Promise<void> {
    const started = (await call("imports.flowyteamConnect", {})) as {
      authorizeUrl: string;
      stateCookie: string;
    };
    const state = new URL(started.authorizeUrl).searchParams.get("state") ?? "";
    await call("imports.flowyteamFinishConnect", {
      code: "code-1",
      state,
      stateCookie: started.stateCookie,
    });
  }

  async function runRow(id: string) {
    const { runs } = (await call("imports.listRuns", { limit: 20 })) as {
      runs: {
        id: string;
        status: string;
        via: string | null;
        rowsWritten: number;
        error: string | null;
        report: Record<string, unknown>;
      }[];
    };
    const run = runs.find((one) => one.id === id);
    if (!run) throw new Error(`no run ${id}`);
    return run;
  }

  async function goalCount(): Promise<number> {
    const wb = await workerDb();
    const result = await wb.admin.query(
      "select count(*)::int as n from goals where workspace_id = $1",
      [workspaceId],
    );
    return result.rows[0].n as number;
  }

  beforeAll(async () => {
    seeded = await seedSource("job");
    stub = await startExportStub(seeded.database, { pageSize: 3 });
  });

  beforeEach(async () => {
    process.env.OPENOKR_FLOWYTEAM_URL = stub.baseUrl;
    stub.tokens.set(TOKEN, { companyId: SEEDED.first.id });
    stub.version = (
      await import("@openokr/core")
    ).flowyteamQueryCatalogue().version;
    queued.length = 0;
    published.length = 0;
    const wb = await workerDb();
    await wb.truncateAllTables();
    await wb.admin.query(
      "insert into users (id, name, email) values ($1, 'Owner', 'job-owner@example.com')",
      [OWNER],
    );
    workspaceId = (
      await provisionWorkspaceForUser(wb.appPool, { id: OWNER, name: "Owner" })
    ).workspaceId;
    await connect();
  });

  afterEach(() => {
    delete process.env.OPENOKR_FLOWYTEAM_URL;
    delete process.env.OPENOKR_SCHEDULER;
  });

  afterAll(async () => {
    await stub?.close();
    await seeded?.drop();
    const wb = await workerDb();
    await wb.close();
  });

  it("previews in a job and records the report with via export (AC 3)", async () => {
    const { runId } = (await call("imports.flowyteamPreview", {})) as {
      runId: string;
    };
    expect((await runRow(runId)).status).toBe("running");
    await relay();
    expect(queued).toHaveLength(1);
    const [outcome] = await work();
    expect(outcome?.kind).toBe("completed");
    const run = await runRow(runId);
    expect(run.status).toBe("completed");
    expect(run.via).toBe("export");
    expect(run.report.companyId).toBe(SEEDED.first.id);
    expect(await goalCount()).toBe(0);
    expect(published.map((p) => p.event)).toContain(
      "imports.flowyteam.progress",
    );
    const { connection } = (await call("imports.flowyteamConnection", {})) as {
      connection: { lastReadAt: string | null };
    };
    expect(connection.lastReadAt).not.toBeNull();
  });

  it("limits a preview to the chosen domains, with what they need (C6)", async () => {
    await expect(
      call("imports.flowyteamPreview", { only: ["not-a-domain"] }),
    ).rejects.toThrow();
    const { runId } = (await call("imports.flowyteamPreview", {
      only: ["objectives", "objectives"],
    })) as { runId: string };
    expect((await runRow(runId)).report.only).toEqual(["objectives"]);
    await relay();
    expect(queued[0]?.payload.only).toEqual(["objectives"]);
    const [outcome] = await work();
    expect(outcome?.kind).toBe("completed");
    const report = (await runRow(runId)).report;
    expect(report.selected).toEqual(["organisation", "objectives"]);
    expect(report.addedForDependencies).toEqual(["organisation"]);
  });

  it("refuses the import without the tick when the preview named restricted KPIs (AC 4)", async () => {
    // One KPI shared with a named person, which a workspace role broadens.
    await seeded.run(
      "insert into indicator_accesses (id, company_id, indicator_id, user_id, permissions, view_options) values (900, 7, 1, 1, 'view', 'everyone')",
    );
    try {
      await call("imports.flowyteamPreview", {});
      await relay();
      await work();
      expect(await refusalOf(call("imports.flowyteamRun", {}))).toBe(
        "visibility_not_accepted",
      );
      expect(await goalCount()).toBe(0);
      await call("imports.flowyteamRun", { acceptBroaderVisibility: true });
    } finally {
      await seeded.run("delete from indicator_accesses where id = 900");
    }
  });

  it("imports, and a second import writes nothing (AC 5), continuing across jobs", async () => {
    const { runId } = (await call("imports.flowyteamRun", {
      acceptBroaderVisibility: true,
    })) as { runId: string };
    await relay();
    // A budget of zero hands over after every domain.
    const outcomes = await work({ budgetMs: 0 });
    expect(
      outcomes.filter((o) => o.kind === "continued").length,
    ).toBeGreaterThan(2);
    expect(outcomes.at(-1)?.kind).toBe("completed");
    const first = await runRow(runId);
    expect(first.status).toBe("completed");
    expect(first.rowsWritten).toBeGreaterThan(0);
    const written = await goalCount();
    expect(written).toBeGreaterThan(0);

    const again = (await call("imports.flowyteamRun", {
      acceptBroaderVisibility: true,
    })) as { runId: string };
    await relay();
    await work();
    expect((await runRow(again.runId)).rowsWritten).toBe(0);
    expect(await goalCount()).toBe(written);
  });

  it("stops before writing when FlowyTeam runs another catalogue (AC 6)", async () => {
    stub.version = "e".repeat(64);
    const { runId } = (await call("imports.flowyteamRun", {
      acceptBroaderVisibility: true,
    })) as { runId: string };
    await relay();
    const [outcome] = await work();
    expect(outcome).toMatchObject({
      kind: "failed",
      failure: "version_mismatch",
    });
    const run = await runRow(runId);
    expect(run.status).toBe("failed");
    expect(run.report.failure).toBe("version_mismatch");
    expect(await goalCount()).toBe(0);
  });

  it("marks the connection revoked when FlowyTeam refuses the token (AC 8)", async () => {
    const token = stub.tokens.get(TOKEN);
    if (token) token.revoked = true;
    const { runId } = (await call("imports.flowyteamRun", {
      acceptBroaderVisibility: true,
    })) as { runId: string };
    await relay();
    const [outcome] = await work();
    expect(outcome).toMatchObject({ kind: "failed", failure: "unauthorised" });
    expect((await runRow(runId)).report.failure).toBe("unauthorised");
    const { connection } = (await call("imports.flowyteamConnection", {})) as {
      connection: { state: string };
    };
    expect(connection.state).toBe("revoked");
    expect(await refusalOf(call("imports.flowyteamRun", {}))).toBe("revoked");
    expect(await goalCount()).toBe(0);
  });

  it("refuses before queuing when nothing runs background jobs", async () => {
    process.env.OPENOKR_SCHEDULER = "off";
    expect(await refusalOf(call("imports.flowyteamPreview", {}))).toBe(
      "background_off",
    );
    const read = (await call("imports.flowyteamConnection", {})) as {
      backgroundWork: boolean;
    };
    expect(read.backgroundWork).toBe(false);
  });

  it("refuses a second import while one is running", async () => {
    await call("imports.flowyteamPreview", {});
    expect(await refusalOf(call("imports.flowyteamPreview", {}))).toBe(
      "already_running",
    );
  });
});
