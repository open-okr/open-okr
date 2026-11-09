import { withWorkspace } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import {
  freshShortId,
  isShortId,
  isUuid,
  newShortId,
  SHORT_ID_ALPHABET,
} from "../src/ids/short.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Short identifiers (docs/design/short-ids.md, plan 0.7.0 D1).
 *
 * The generator, its collision retry, and that every write making one of the
 * seven addressable aggregates gives it one. KPIs have had theirs since 0026
 * and keep them.
 */

const OWNER = "short-ids-owner";
const SHAPE = /^[1-9a-km-zA-HJ-NP-Z]{10}$/;

let workspaceId: string;
let ownerMemberId: string;

const call = async (name: string, input: unknown, userId = OWNER) => {
  const wb = await workerDb();
  return callAction(
    { pool: wb.appPool, workspaceId, actor: { kind: "human", userId } },
    name as never,
    input as never,
  );
};

/** What the row of this table with this id holds in `short_id`. */
const shortIdOf = async (table: string, id: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ short_id: string | null }>(
    `select short_id from ${table} where id = $1`,
    [id],
  );
  return rows[0]?.short_id ?? null;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, 'Ada', $2)",
    [OWNER, "short-ids-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Ada",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the generator", () => {
  it("draws ten characters from the base58 alphabet KPI links already use", () => {
    expect(SHORT_ID_ALPHABET).toBe(
      "123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ",
    );
    const drawn = Array.from({ length: 500 }, () => newShortId());
    for (const one of drawn) {
      expect(one).toMatch(SHAPE);
      expect(isShortId(one)).toBe(true);
    }
    // Random, not sequential: five hundred draws, five hundred answers.
    expect(new Set(drawn).size).toBe(drawn.length);
  });

  it("tells a short id from a uuid and from anything else, case and all", () => {
    expect(isShortId("aB3dE5fG7h")).toBe(true);
    expect(isShortId("aB3dE5fG7")).toBe(false);
    // `0`, `O`, `I` and `l` are not in the alphabet.
    expect(isShortId("0B3dE5fG7h")).toBe(false);
    expect(isShortId("lB3dE5fG7h")).toBe(false);
    expect(isUuid("0190f5e2-7d3c-7a1b-9c2d-3e4f5a6b7c8d")).toBe(true);
    expect(isUuid("0190F5E2-7D3C-7A1B-9C2D-3E4F5A6B7C8D")).toBe(true);
    expect(isUuid("aB3dE5fG7h")).toBe(false);
  });

  it("draws again when the first candidate is taken, deleted rows included", async () => {
    const cycle = (await call("cycles.current", { mode: "quarterly" })) as {
      id: string;
    };
    const goal = (await call("goals.create", {
      title: "Win the mid-market",
      cycleId: cycle.id,
      level: "company",
      ownerKind: "workspace",
      weight: 1,
    })) as { id: string };
    const taken = (await shortIdOf("goals", goal.id)) as string;
    await call("goals.delete", { id: goal.id });

    const wb = await workerDb();
    const draws = [taken, "Fresh23456"];
    const drawn = await withWorkspace(drizzle(wb.appPool), workspaceId, (tx) =>
      freshShortId(tx, "goal", workspaceId, () => draws.shift() as string),
    );
    expect(drawn).toBe("Fresh23456");

    await expect(
      withWorkspace(drizzle(wb.appPool), workspaceId, (tx) =>
        freshShortId(tx, "goal", workspaceId, () => taken),
      ),
    ).rejects.toThrow(/No free short identifier/);
  });
});

describe("every write that makes one gives it one", () => {
  it("fills cycles, goals, key results, initiatives, tasks, documents and sessions, and KPIs keep theirs", async () => {
    const space = (await call("spaces.create", { name: "Product" })) as {
      id: string;
    };
    const cycle = (await call("cycles.current", { mode: "quarterly" })) as {
      id: string;
    };
    const another = (await call("cycles.create", {
      on: "2030-02-15",
      mode: "quarterly",
    })) as { id: string };
    const goal = (await call("goals.create", {
      title: "Win the mid-market",
      cycleId: cycle.id,
      spaceId: space.id,
      level: "team",
      ownerKind: "space",
      championId: ownerMemberId,
      reviewerId: ownerMemberId,
      weight: 1,
    })) as { id: string };
    const keyResult = (await call("goals.addKeyResult", {
      goalId: goal.id,
      title: "Activation from 41% to 60%",
      direction: "increase",
      indicatorType: "lagging",
      baselineValue: 41,
      targetValue: 60,
      weight: 1,
    })) as { id: string };
    const initiative = (await call("initiatives.create", {
      spaceId: space.id,
      title: "Onboarding rebuild",
      ownerId: ownerMemberId,
    })) as { id: string };
    const task = (await call("tasks.create", {
      spaceId: space.id,
      title: "Pricing page copy",
    })) as { id: string };
    const document = (await call("documents.create", {
      subjectType: "goal",
      subjectId: goal.id,
      title: "Launch plan",
    })) as { id: string };
    const session = (await call("sessions.create", {
      spaceId: space.id,
      kind: "weekly",
      title: "Weekly check-in",
      scheduledFor: new Date().toISOString(),
      facilitatorId: ownerMemberId,
    })) as { id: string };
    const kpi = (await call("kpis.create", {
      title: "Weekly signups",
      frequency: "monthly",
      direction: "higher_better",
      indicatorType: "lagging",
      tier: "output",
      aggregate: "sum",
      ownerKind: "workspace",
    })) as { id: string; shortId: string };

    const found = {
      cycle: await shortIdOf("cycles", cycle.id),
      another: await shortIdOf("cycles", another.id),
      goal: await shortIdOf("goals", goal.id),
      keyResult: await shortIdOf("key_results", keyResult.id),
      initiative: await shortIdOf("initiatives", initiative.id),
      task: await shortIdOf("tasks", task.id),
      document: await shortIdOf("documents", document.id),
      session: await shortIdOf("okr_sessions", session.id),
      kpi: await shortIdOf("kpis", kpi.id),
    };
    for (const shortId of Object.values(found)) {
      expect(shortId).toMatch(SHAPE);
    }
    expect(found.kpi).toBe(kpi.shortId);
    expect(new Set(Object.values(found)).size).toBe(9);
  });
});
