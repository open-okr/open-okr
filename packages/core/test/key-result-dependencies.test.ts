import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { richTextFromPlainText } from "../src/rich-text/from-text.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The three reads of a dependency's providing key result (plan 0.7.0 O5,
 * design `key-result-dependencies.md` K6 to K9 and §3).
 *
 * `goals.relations` is the S-14 rail, `alignment.read` the S-10 register and
 * `sessions.monthlyRecord` the S-23 log. Each answers the same question the
 * same way: which key result delivers this, and has it.
 *
 * **Counting the access calls.** K9 decides visibility once per read through
 * the set filter, not once per row (P7-T01b). The two access functions are
 * wrapped so the test can count them, and a read with three providers named
 * must ask exactly as often as one with one named.
 */

const counted = vi.hoisted(() => ({ calls: 0 }));

vi.mock("../src/access/reads.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/access/reads.ts")>();
  return {
    ...actual,
    visibleResourceIds: ((...args: never[]) => {
      counted.calls += 1;
      return (actual.visibleResourceIds as (...a: never[]) => unknown)(...args);
    }) as typeof actual.visibleResourceIds,
    getAccessScoped: ((...args: never[]) => {
      counted.calls += 1;
      return (actual.getAccessScoped as (...a: never[]) => unknown)(...args);
    }) as typeof actual.getAccessScoped,
  };
});

const OWNER = "krdep-owner";
/** Sara, who champions the depending objective and nothing in Engineering. */
const SARA = "krdep-sara";

let workspaceId: string;
let cycleId: string;
let ownerMemberId: string;
let saraMemberId: string;
let product: string;
let engineering: string;
/** P1 and its key result, in Product, championed by Sara. */
let p1: string;
let p11: string;
/** E3 and its milestone, in Engineering. */
let e3: string;
let e31: string;
let sessionId: string;

const call = async <T = unknown>(
  name: string,
  input: object,
  userId = OWNER,
): Promise<T> => {
  const wb = await workerDb();
  return callAction(
    { pool: wb.appPool, workspaceId, actor: { kind: "human", userId } },
    name as never,
    input as never,
  ) as Promise<T>;
};

interface Provided {
  id: string;
  title: string | null;
  goalId: string | null;
  goalTitle: string | null;
  progressPct: number | null;
  state: string;
}
interface Entry {
  id: string;
  provider?: string;
  confirmed: boolean;
  providerKeyResult: Provided | null;
}

const fromRelations = async (userId = OWNER) =>
  (await call<{ register: Entry[] }>("goals.relations", { id: p1 }, userId))
    .register;
const fromAlignment = async (userId = OWNER) =>
  (
    await call<{ register: Entry[] }>(
      "alignment.read",
      { cycleId, includeDismissed: false },
      userId,
    )
  ).register;
const fromMonthly = async (userId = OWNER) =>
  (
    await call<{ dependencies: Entry[] }>(
      "sessions.monthlyRecord",
      { sessionId },
      userId,
    )
  ).dependencies;
const READS = [
  ["goals.relations", fromRelations],
  ["alignment.read", fromAlignment],
  ["sessions.monthlyRecord", fromMonthly],
] as const;

const objective = async (title: string, spaceId: string, championId: string) =>
  (
    await call<{ id: string }>("goals.create", {
      title,
      cycleId,
      level: "team",
      ownerKind: "space",
      spaceId,
      championId,
      reviewerId: championId,
      weight: 1,
    })
  ).id;

const metric = async (goalId: string, title: string) =>
  (
    await call<{ id: string }>("goals.addKeyResult", {
      goalId,
      title,
      direction: "increase",
      indicatorType: "leading",
      baselineValue: 0,
      targetValue: 100,
      weight: 1,
    })
  ).id;

/** A dependency of P1.1 on Engineering, confirmed naming `keyResultId`. */
const dependsOn = async (keyResultId: string) => {
  const { id } = await call<{ id: string }>("goals.addKeyResultDependency", {
    keyResultId: p11,
    providerSpaceId: engineering,
    note: "Fewer setup calls depend on E3's bulk import.",
  });
  await call("goals.confirmDependency", {
    id,
    providerKeyResultId: keyResultId,
  });
  return id;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [
      OWNER,
      "Mei",
      "krdep-owner@example.com",
      SARA,
      "Sara",
      "krdep-sara@example.com",
    ],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Mei",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
  saraMemberId = (
    await wb.admin.query<{ id: string }>(
      `insert into workspace_members (id, workspace_id, user_id, name, status)
       values (gen_random_uuid(), $1, $2, 'Sara', 'active') returning id`,
      [workspaceId, SARA],
    )
  ).rows[0]?.id as string;

  cycleId = (
    await call<{ id: string }>("cycles.current", { mode: "quarterly" })
  ).id;
  product = (await call<{ id: string }>("spaces.create", { name: "Product" }))
    .id;
  engineering = (
    await call<{ id: string }>("spaces.create", { name: "Engineering" })
  ).id;

  p1 = await objective(
    "Onboarding runs without us in the room",
    product,
    saraMemberId,
  );
  p11 = await metric(p1, "Cut manual setup calls per new account");
  e3 = await objective(
    "New accounts bring their data in one step",
    engineering,
    ownerMemberId,
  );
  e31 = (
    await call<{ id: string }>("goals.addKeyResult", {
      goalId: e3,
      title: "Bulk import generally available",
      kind: "milestone",
      indicatorType: "leading",
      weight: 1,
    })
  ).id;

  sessionId = (
    await call<{ id: string }>("sessions.create", {
      spaceId: product,
      cycleId,
      kind: "monthly",
      title: "February monthly review",
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
      facilitatorId: ownerMemberId,
    })
  ).id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the providing key result, in all three reads", () => {
  it("acceptance: Mei marks E3.1 done and Sara's drawer reads delivered by it, with the dependency row untouched (NW-Q1-20)", async () => {
    const id = await dependsOn(e31);
    for (const [name, read] of READS) {
      expect((await read(SARA))[0]?.providerKeyResult, name).toMatchObject({
        id: e31,
        title: "Bulk import generally available",
        goalId: e3,
        goalTitle: "New accounts bring their data in one step",
        progressPct: 0,
        state: "pending",
      });
    }

    const wb = await workerDb();
    const before = await wb.admin.query<{ updated_at: Date }>(
      "select updated_at from key_result_dependencies where id = $1",
      [id],
    );
    await call("goals.updateKeyResult", { id: e31, done: true });

    for (const [name, read] of READS) {
      expect((await read(SARA))[0]?.providerKeyResult, name).toMatchObject({
        id: e31,
        progressPct: 100,
        state: "delivered",
      });
    }
    // Delivered is read, never written (K6).
    const after = await wb.admin.query<{ updated_at: Date }>(
      "select updated_at from key_result_dependencies where id = $1",
      [id],
    );
    expect(after.rows[0]?.updated_at).toEqual(before.rows[0]?.updated_at);
  });

  it("reads a maintain key result pending again once a reading leaves its band", async () => {
    const steady = await call<{ id: string }>("goals.addKeyResult", {
      goalId: e3,
      title: "Keep import success between 95% and 99%",
      kind: "maintain",
      direction: "maintain",
      indicatorType: "lagging",
      baselineValue: 95,
      targetValue: 99,
      weight: 1,
    });
    await dependsOn(steady.id);
    await call("goals.recordValue", { id: steady.id, value: 97 });
    for (const [name, read] of READS) {
      expect((await read())[0]?.providerKeyResult?.state, name).toBe(
        "delivered",
      );
    }
    await call("goals.recordValue", { id: steady.id, value: 92 });
    for (const [name, read] of READS) {
      expect((await read())[0]?.providerKeyResult?.state, name).toBe("pending");
    }
  });

  it("reads stopped once the providing goal is closed at 60%", async () => {
    const pipeline = await objective(
      "Imports run overnight without anybody watching",
      engineering,
      ownerMemberId,
    );
    const runs = await metric(pipeline, "Nightly imports that finish alone");
    await dependsOn(runs);
    await call("goals.recordValue", { id: runs, value: 60 });
    await call("goals.close", {
      id: pipeline,
      successStatus: "missed",
      closeDecision: "abandon",
      retrospectiveBody: richTextFromPlainText(
        "The scheduler work moved to next quarter.",
      ),
    });
    for (const [name, read] of READS) {
      expect((await read())[0]?.providerKeyResult, name).toMatchObject({
        progressPct: 60,
        state: "stopped",
      });
    }
  });

  it("reads stopped once the providing key result is removed", async () => {
    await dependsOn(e31);
    await call("goals.removeKeyResult", { id: e31 });
    for (const [name, read] of READS) {
      expect((await read())[0]?.providerKeyResult, name).toMatchObject({
        id: e31,
        title: "Bulk import generally available",
        state: "stopped",
      });
    }
  });

  it("reads none when no key result is named", async () => {
    await call("goals.addKeyResultDependency", {
      keyResultId: p11,
      providerSpaceId: engineering,
    });
    for (const [name, read] of READS) {
      expect((await read())[0]?.providerKeyResult, name).toBeNull();
    }
  });
});

describe("a reader who cannot view the providing goal", () => {
  /** E3 seen by its champion alone, which no screen offers but a binding can. */
  const hideE3FromSara = async () => {
    const wb = await workerDb();
    await wb.admin.query(
      `update access_bindings set deleted_at = now()
        where context_id in (
                select id from access_contexts
                 where resource_type = 'goal' and resource_id = $1)
          and group_id in (
                select id from access_groups where kind = 'workspace_standard')`,
      [e3],
    );
  };

  it("acceptance: sees the space and the confirmation, and neither the title nor the state", async () => {
    await dependsOn(e31);
    await call("goals.updateKeyResult", { id: e31, done: true });
    await hideE3FromSara();

    for (const [name, read] of READS) {
      const [entry] = await read(SARA);
      expect(entry?.confirmed, name).toBe(true);
      expect(entry?.providerKeyResult, name).toEqual({
        id: e31,
        title: null,
        goalId: null,
        goalTitle: null,
        progressPct: null,
        state: "hidden",
      });
      expect(JSON.stringify(entry), name).not.toContain("Bulk import");
    }
    // The space is still named where the read names it.
    expect((await fromRelations(SARA))[0]?.provider).toBe("Engineering");
    expect((await fromAlignment(SARA))[0]?.provider).toBe("Engineering");

    // Mei, who champions E3, still sees what Sara cannot.
    expect((await fromRelations())[0]?.providerKeyResult?.state).toBe(
      "delivered",
    );
  });

  it("acceptance: is refused as not-found when naming it", async () => {
    await hideE3FromSara();
    const { id } = await call<{ id: string }>(
      "goals.addKeyResultDependency",
      { keyResultId: p11, providerSpaceId: engineering },
      SARA,
    );
    await expect(
      call(
        "goals.setDependencyProvider",
        { id, providerKeyResultId: e31 },
        SARA,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      call(
        "goals.addKeyResultDependency",
        { keyResultId: p11, providerKeyResultId: e31 },
        SARA,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("visibility is asked once per read", () => {
  it("asks no more often with three providers named than with one", async () => {
    const providers = [e31];
    for (const title of [
      "Ship the importer's field mapping",
      "Ship the importer's error report",
    ]) {
      const goal = await objective(title, engineering, ownerMemberId);
      providers.push(await metric(goal, title));
    }
    const entries = [];
    for (const _ of providers) {
      entries.push(
        (
          await call<{ id: string }>("goals.addKeyResultDependency", {
            keyResultId: p11,
            providerSpaceId: engineering,
          })
        ).id,
      );
    }
    await call("goals.setDependencyProvider", {
      id: entries[0],
      providerKeyResultId: providers[0],
    });

    const measure = async () => {
      const calls: Record<string, number> = {};
      for (const [name, read] of READS) {
        counted.calls = 0;
        const register = await read();
        expect(register.length, name).toBe(3);
        calls[name] = counted.calls;
      }
      return calls;
    };
    const withOne = await measure();

    for (const [index, id] of entries.entries()) {
      if (index > 0) {
        await call("goals.setDependencyProvider", {
          id,
          providerKeyResultId: providers[index],
        });
      }
    }
    const withThree = await measure();
    for (const [name] of READS) {
      // Counted at all, so a wrapper that stopped wrapping cannot pass this.
      expect(withOne[name], name).toBeGreaterThan(0);
      expect(withThree[name], name).toBe(withOne[name]);
    }
  });
});
