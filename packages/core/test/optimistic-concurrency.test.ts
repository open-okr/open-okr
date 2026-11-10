import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Optimistic concurrency on the six update actions
 * (docs/design/optimistic-concurrency.md V3 and V4, plan 0.7.0 D3).
 *
 * Each action is asked the same three questions, the design's §3 in the
 * terms of that action:
 *   - a change to a field somebody moved since it was read is refused with
 *     what is stored now and who changed it, and nothing is written
 *   - a change to a field nobody else touched is not refused, even when
 *     another field moved
 *   - a call that sends no `read` writes as it always has
 *
 * The comparison itself is `packages/core/test/unchanged.test.ts`.
 */

const OWNER = "concurrency-owner";

let workspaceId: string;
let ownerMemberId: string;
let spaceId: string;
let cycleId: string;

const call = async <T>(name: string, input: unknown): Promise<T> => {
  const wb = await workerDb();
  return callAction(
    {
      pool: wb.appPool,
      workspaceId,
      actor: { kind: "human" as const, userId: OWNER },
    },
    name as never,
    input as never,
  ) as Promise<T>;
};

/** What a refused save answers, as the screens read it. */
const refusedWith = (current: Record<string, unknown>) => ({
  code: "conflict",
  details: { current, changedBy: "Ada Owner" },
});

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Ada Owner", "concurrency-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Ada Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
  const spaces = await call<{ id: string }[]>("spaces.list", {});
  spaceId = spaces[0]?.id as string;
  cycleId = (
    await call<{ id: string }>("cycles.current", {
      mode: "quarterly",
    })
  ).id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("tasks.update", () => {
  const task = async () =>
    (
      await call<{ id: string }>("tasks.create", {
        spaceId,
        title: "Rewrite the first-run screen",
      })
    ).id;
  const read = async (id: string) =>
    call<{ title: string; dueOn: string | null }>("tasks.read", { id });

  it("refuses a title changed since it was read, and keeps theirs", async () => {
    const id = await task();
    await call("tasks.update", {
      id,
      title: "Mei's title",
      read: { title: "Rewrite the first-run screen" },
    });
    const refused = call("tasks.update", {
      id,
      title: "Priya's title",
      read: { title: "Rewrite the first-run screen" },
    });
    await expect(refused).rejects.toMatchObject(
      refusedWith({ title: "Mei's title" }),
    );
    await expect(refused).rejects.toThrow(/Ada Owner changed this/);
    expect((await read(id)).title).toBe("Mei's title");
  });

  it("does not refuse a due date when only the title moved", async () => {
    const id = await task();
    await call("tasks.update", {
      id,
      title: "Mei's title",
      read: { title: "Rewrite the first-run screen" },
    });
    await call("tasks.update", {
      id,
      dueOn: "2026-12-01",
      read: { dueOn: null },
    });
    expect(await read(id)).toMatchObject({
      title: "Mei's title",
      dueOn: "2026-12-01",
    });
  });

  it("writes as it always has when no read is sent", async () => {
    const id = await task();
    await call("tasks.update", {
      id,
      title: "Mei's title",
      read: { title: "Rewrite the first-run screen" },
    });
    await call("tasks.update", { id, title: "Priya's title" });
    expect((await read(id)).title).toBe("Priya's title");
  });

  it("asks for the value read for every field it changes", async () => {
    const id = await task();
    await expect(
      call("tasks.update", { id, title: "New", read: {} }),
    ).rejects.toThrow(/value you read/);
  });

  it("records the fields it changed, and not the read it was made from", async () => {
    const id = await task();
    await call("tasks.update", {
      id,
      title: "Mei's title",
      read: { title: "Rewrite the first-run screen" },
    });
    const wb = await workerDb();
    const rows = await wb.admin.query<{ payload: { fields: string[] } }>(
      `select payload from activities
        where subject_id = $1 and kind = 'task.updated'`,
      [id],
    );
    expect(rows.rows[0]?.payload.fields).toEqual(["title"]);
  });
});

describe("initiatives.update", () => {
  const initiative = async () =>
    (
      await call<{ id: string }>("initiatives.create", {
        spaceId,
        title: "Guided first run",
        ownerId: ownerMemberId,
      })
    ).id;
  const read = async (id: string) =>
    call<{ status: string; capacity: string | null }>("initiatives.read", {
      id,
    });

  it("refuses a status changed since it was read", async () => {
    const id = await initiative();
    await call("initiatives.update", {
      id,
      status: "active",
      read: { status: "planned" },
    });
    await expect(
      call("initiatives.update", {
        id,
        status: "dropped",
        read: { status: "planned" },
      }),
    ).rejects.toMatchObject(refusedWith({ status: "active" }));
    expect((await read(id)).status).toBe("active");
  });

  it("does not refuse a capacity when only the status moved", async () => {
    const id = await initiative();
    await call("initiatives.update", {
      id,
      status: "active",
      read: { status: "planned" },
    });
    await call("initiatives.update", {
      id,
      capacity: "tight",
      read: { capacity: null },
    });
    expect(await read(id)).toMatchObject({
      status: "active",
      capacity: "tight",
    });
  });

  it("writes as it always has when no read is sent", async () => {
    const id = await initiative();
    await call("initiatives.update", {
      id,
      status: "active",
      read: { status: "planned" },
    });
    await call("initiatives.update", { id, status: "dropped" });
    expect((await read(id)).status).toBe("dropped");
  });
});

describe("documents.update", () => {
  const document = async () =>
    (
      await call<{ id: string }>("documents.create", {
        subjectType: "space",
        subjectId: spaceId,
        title: "Launch plan",
      })
    ).id;
  const read = async (id: string) =>
    call<{ title: string }>("documents.read", { id });

  it("refuses a title changed since it was read", async () => {
    const id = await document();
    await call("documents.update", {
      id,
      title: "Mei's plan",
      read: { title: "Launch plan" },
    });
    await expect(
      call("documents.update", {
        id,
        title: "Priya's plan",
        read: { title: "Launch plan" },
      }),
    ).rejects.toMatchObject(refusedWith({ title: "Mei's plan" }));
    expect((await read(id)).title).toBe("Mei's plan");
  });

  it("does not compare the body, which keeps its own rules (V5)", async () => {
    const id = await document();
    await call("documents.update", {
      id,
      title: "Mei's plan",
      read: { title: "Launch plan" },
    });
    const body = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Ship it." }] },
      ],
    };
    await expect(
      call("documents.update", { id, body, read: {} }),
    ).resolves.toBeTruthy();
  });

  it("writes as it always has when no read is sent", async () => {
    const id = await document();
    await call("documents.update", {
      id,
      title: "Mei's plan",
      read: { title: "Launch plan" },
    });
    await call("documents.update", { id, title: "Priya's plan" });
    expect((await read(id)).title).toBe("Priya's plan");
  });
});

describe("kpis.update", () => {
  const kpi = async () =>
    (
      await call<{ id: string }>("kpis.create", {
        title: "Uptime",
        frequency: "monthly",
        indicatorType: "lagging",
        aggregate: "sum",
        ownerKind: "workspace",
        unit: "%",
        targetType: "at_least",
        targetDefault: 99.9,
        greenLow: 99.9,
        redLow: 99.5,
      })
    ).id;
  const read = async (kpiId: string) =>
    (
      await call<{
        kpi: { greenLow: number | null; tier: string | null; title: string };
      }>("kpis.detail", { kpiId, periods: 1 })
    ).kpi;

  it("refuses a threshold changed since it was read, by value", async () => {
    const kpiId = await kpi();
    await call("kpis.update", {
      kpiId,
      greenLow: 99.95,
      read: { greenLow: 99.9 },
    });
    // Read as it is stored, "99.90", which is the same number.
    await expect(
      call("kpis.update", {
        kpiId,
        greenLow: 99.8,
        read: { greenLow: "99.90" },
      }),
    ).rejects.toMatchObject(refusedWith({ greenLow: 99.95 }));
    expect((await read(kpiId)).greenLow).toBe(99.95);
  });

  it("does not refuse a tier when only a threshold moved", async () => {
    const kpiId = await kpi();
    await call("kpis.update", {
      kpiId,
      greenLow: 99.95,
      read: { greenLow: 99.9 },
    });
    await call("kpis.update", { kpiId, tier: "impact", read: { tier: null } });
    expect(await read(kpiId)).toMatchObject({
      greenLow: 99.95,
      tier: "impact",
    });
  });

  it("writes as it always has when no read is sent", async () => {
    const kpiId = await kpi();
    await call("kpis.update", {
      kpiId,
      title: "Uptime, measured",
      read: { title: "Uptime" },
    });
    await call("kpis.update", { kpiId, title: "Availability" });
    expect((await read(kpiId)).title).toBe("Availability");
  });
});

describe("spaces.update", () => {
  const read = async () =>
    call<{ name: string; mission: string | null }>("spaces.read", {
      id: spaceId,
    });

  it("refuses a name changed since it was read", async () => {
    const before = (await read()).name;
    await call("spaces.update", {
      id: spaceId,
      name: "Customer Success",
      read: { name: before },
    });
    await expect(
      call("spaces.update", {
        id: spaceId,
        name: "Support",
        read: { name: before },
      }),
    ).rejects.toMatchObject(refusedWith({ name: "Customer Success" }));
    expect((await read()).name).toBe("Customer Success");
  });

  it("does not refuse a mission when only the name moved", async () => {
    const before = await read();
    await call("spaces.update", {
      id: spaceId,
      name: "Customer Success",
      read: { name: before.name },
    });
    await call("spaces.update", {
      id: spaceId,
      mission: "Every question answered the same day",
      read: { mission: before.mission },
    });
    expect(await read()).toMatchObject({
      name: "Customer Success",
      mission: "Every question answered the same day",
    });
  });

  it("writes as it always has when no read is sent", async () => {
    const before = (await read()).name;
    await call("spaces.update", {
      id: spaceId,
      name: "Customer Success",
      read: { name: before },
    });
    await call("spaces.update", { id: spaceId, name: "Support" });
    expect((await read()).name).toBe("Support");
  });
});

describe("cycles.update", () => {
  const stored = async () => {
    const wb = await workerDb();
    const rows = await wb.admin.query<{
      contributing_units: string | null;
      session_dates: { key: string; on: string }[];
    }>("select contributing_units, session_dates from cycles where id = $1", [
      cycleId,
    ]);
    return rows.rows[0];
  };

  it("refuses session dates changed since they were read, as a list", async () => {
    const first = [{ key: "diagnose", on: "2026-06-10" }];
    await call("cycles.update", {
      id: cycleId,
      sessionDates: first,
      read: { sessionDates: [] },
    });
    await expect(
      call("cycles.update", {
        id: cycleId,
        sessionDates: [{ key: "draft", on: "2026-06-20" }],
        read: { sessionDates: [] },
      }),
    ).rejects.toMatchObject(refusedWith({ sessionDates: first }));
    expect((await stored())?.session_dates).toEqual(first);

    // The list read back as it is stored is the same list, whatever order
    // its keys were written in.
    await call("cycles.update", {
      id: cycleId,
      sessionDates: [{ key: "draft", on: "2026-06-20" }],
      read: { sessionDates: [{ on: "2026-06-10", key: "diagnose" }] },
    });
  });

  it("does not refuse contributing units when only the dates moved", async () => {
    await call("cycles.update", {
      id: cycleId,
      sessionDates: [{ key: "diagnose", on: "2026-06-10" }],
      read: { sessionDates: [] },
    });
    await call("cycles.update", {
      id: cycleId,
      contributingUnits: "Sales and Support",
      read: { contributingUnits: null },
    });
    expect((await stored())?.contributing_units).toBe("Sales and Support");
  });

  it("writes as it always has when no read is sent", async () => {
    await call("cycles.update", {
      id: cycleId,
      contributingUnits: "Sales",
      read: { contributingUnits: null },
    });
    await call("cycles.update", {
      id: cycleId,
      contributingUnits: "Support",
    });
    expect((await stored())?.contributing_units).toBe("Support");
  });
});
