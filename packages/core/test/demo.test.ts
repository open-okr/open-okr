import { workerDb } from "@openokr/test-support/db";
import { beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { buildDemoWorkspace } from "../src/demo/builder.ts";
import { GOALS } from "../src/demo/okrs.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The demo workspace builder (P3-T17).
 *
 * The task's acceptance criterion is the first test: a fresh workspace, seeded
 * once, has an organisation in it that every Phase 3 surface can read, and
 * seeding it a second time changes nothing.
 *
 * The rest guard the specific ways a seed goes wrong and nobody notices until
 * it is on a screen in front of somebody. Two are worth naming:
 *
 * - **Every key result has exactly one value point**, because two written
 *   milliseconds apart make §3.6's forecast fit a near-vertical line and put a
 *   nine-digit projection on the goal page. The reasoning is in `okrs.ts`; this
 *   is the test that stops it coming back.
 * - **Publish gate 5 is red for one named reason**, because the demo is built
 *   to show a gate refusing with a sentence somebody can act on. A seed that
 *   quietly went green would have lost the point of the screen.
 */

const OWNER = "demo-owner";

let workspaceId: string;
let adminUserId: string;

const context = () => ({
  workspaceId,
  actor: { kind: "human" as const, userId: adminUserId },
});

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Demo Owner", "demo-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Demo Owner",
  });
  workspaceId = provisioned.workspaceId;
  adminUserId = OWNER;
});

const seed = async () => {
  const wb = await workerDb();
  return buildDemoWorkspace({
    pool: wb.appPool,
    workspaceId,
    adminUserId,
  });
};

describe("the demo builder", () => {
  it("fills a fresh workspace and refuses to fill it twice", async () => {
    const wb = await workerDb();
    const first = await seed();

    expect(first.alreadySeeded).toBe(false);
    expect(first.membersCreated).toBe(7);
    expect(first.spacesCreated).toBe(4);
    expect(first.kpisCreated).toBeGreaterThan(10);

    const ctx = { pool: wb.appPool, ...context() };

    // One objective per entry in the data file, plus the recovery objective the
    // §6.5 engine launched.
    const goals = await callAction(ctx, "goals.list", { includeClosed: true });
    expect(goals.goals).toHaveLength(GOALS.length + 1);

    // All four levels, so the cascade and the explorer's scope tabs have
    // something to show at each.
    const levels = new Set(goals.goals.map((goal) => goal.level));
    expect(levels).toEqual(
      new Set(["company", "department", "team", "individual"]),
    );

    const second = await seed();
    expect(second.alreadySeeded).toBe(true);
    const after = await callAction(ctx, "goals.list", { includeClosed: true });
    expect(after.goals).toHaveLength(goals.goals.length);
  });

  it("leaves every key result with one value point, so no trend is fitted", async () => {
    const wb = await workerDb();
    await seed();

    // Two points milliseconds apart is what produces the nine-digit projection
    // §3.6's fit has no minimum span to refuse. One point is the fix.
    const counts = await wb.admin.query<{ count: string }>(
      `select count(*) as count
         from key_result_values v
         join key_results k on k.id = v.key_result_id
        where k.workspace_id = $1
          and k.deleted_at is null
        group by v.key_result_id
       having count(*) > 1`,
      [workspaceId],
    );
    expect(counts.rows).toEqual([]);

    const forecasts = await wb.admin.query<{ count: string }>(
      `select count(*) as count from key_results
        where workspace_id = $1 and deleted_at is null and forecast is not null`,
      [workspaceId],
    );
    expect(forecasts.rows[0]?.count).toBe("0");
  });

  it("leaves publish gate 5 red for one reason and gate 2 unevaluable", async () => {
    const wb = await workerDb();
    await seed();
    const ctx = { pool: wb.appPool, ...context() };

    const cycle = await callAction(ctx, "cycles.current", {
      mode: "quarterly",
    });
    const workflow = await callAction(ctx, "workflow.read", {
      cycleId: cycle?.id ?? "",
    });

    const byKey = new Map(workflow.gates.map((gate) => [gate.gateKey, gate]));
    for (const gateKey of [1, 3, 4, 6]) {
      expect(byKey.get(gateKey)?.passed).toBe(true);
    }
    // The §4 quality engine arrives at P4-T01, and a gate that cannot check
    // anything must not pass.
    expect(byKey.get(2)?.evaluable).toBe(false);

    const five = byKey.get(5);
    expect(five?.passed).toBe(false);
    expect(five?.missing).toHaveLength(1);
    expect(five?.missing[0]).toContain("exceeds capacity");

    expect(workflow.publishable).toBe(false);
  });

  it("gives the person running it real obligations to work through", async () => {
    const wb = await workerDb();
    await seed();
    const ctx = { pool: wb.appPool, ...context() };

    const inbox = await callAction(ctx, "review.inbox", {});
    // Acknowledgements they owe as reviewer of record, and a check-in they owe
    // as champion. A demo inbox with nothing in it demonstrates nothing.
    expect(
      inbox.obligations.filter(
        (obligation) => obligation.kind === "acknowledgement",
      ).length,
    ).toBeGreaterThan(0);
    expect(
      inbox.obligations.filter((obligation) => obligation.kind === "check_in")
        .length,
    ).toBeGreaterThan(0);
  });

  it("builds a dependency register that publish gate 4 passes three ways", async () => {
    const wb = await workerDb();
    await seed();
    const ctx = { pool: wb.appPool, ...context() };

    const cycle = await callAction(ctx, "cycles.current", {
      mode: "quarterly",
    });
    const alignment = await callAction(ctx, "alignment.read", {
      cycleId: cycle?.id ?? "",
      includeDismissed: false,
    });

    expect(alignment.register).toHaveLength(3);
    // Confirmed by its provider, or unconfirmed with a named risk owner. §5.4
    // accepts either, and nothing in the register blocks publication.
    for (const entry of alignment.register) {
      expect(entry.confirmed || entry.riskOwnerId !== null).toBe(true);
      expect(entry.blocksPublish).toBe(false);
    }
    expect(alignment.register.some((entry) => entry.confirmed)).toBe(true);
    expect(alignment.score).not.toBeNull();
  });

  it("puts every KPI state on the grid, including one nobody has measured", async () => {
    const wb = await workerDb();
    await seed();
    const ctx = { pool: wb.appPool, ...context() };

    const grid = await callAction(ctx, "kpis.grid", { periods: 12 });
    const states = new Set(grid.kpis.map((kpi) => kpi.state));
    expect(states).toEqual(
      new Set(["healthy", "watch", "unhealthy", "recovering", "no_data"]),
    );
    expect(grid.kpis.some((kpi) => kpi.isCalculated)).toBe(true);
  });

  it("gives the manager chain three levels of depth", async () => {
    const wb = await workerDb();
    await seed();
    const ctx = { pool: wb.appPool, ...context() };

    const chart = await callAction(ctx, "people.orgChart", {});
    const depth = (
      nodes: readonly { children: readonly unknown[] }[],
    ): number =>
      nodes.length === 0
        ? 0
        : 1 +
          Math.max(
            ...nodes.map((node) =>
              depth(node.children as readonly { children: readonly [] }[]),
            ),
          );
    expect(depth(chart)).toBeGreaterThanOrEqual(3);
  });
});
