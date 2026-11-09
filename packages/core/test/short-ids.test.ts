import { withWorkspace } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction, validateAction } from "../src/actions/registry.ts";
import { resolveAddress } from "../src/ids/address.ts";
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

describe("an address in either form (short-ids.md S4 and S5)", () => {
  const GUEST = "short-ids-guest";

  /** A cycle, a goal on it and one key result, with their short ids. */
  async function aGoal() {
    const cycle = (await call("cycles.current", { mode: "quarterly" })) as {
      id: string;
    };
    const goal = (await call("goals.create", {
      title: "Win the mid-market",
      cycleId: cycle.id,
      level: "company",
      ownerKind: "workspace",
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
    return {
      goal: goal.id,
      goalShort: (await shortIdOf("goals", goal.id)) as string,
      keyResult: keyResult.id,
      keyResultShort: (await shortIdOf("key_results", keyResult.id)) as string,
    };
  }

  /** What a call refused with, or a failure if it did not refuse. */
  const refusal = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return error as { code?: string; message: string; name: string };
    }
    throw new Error("Expected a refusal.");
  };

  it("reads a goal by its short id as by its UUID, and answers malformed, unknown and unseen alike with not-found", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "insert into users (id, name, email) values ($1, 'Gus', $2)",
      [GUEST, "short-ids-guest@example.com"],
    );
    await wb.admin.query(
      `insert into workspace_members (id, workspace_id, user_id, name, status, kind)
       values (gen_random_uuid(), $1, $2, 'Gus Guest', 'active', 'guest')`,
      [workspaceId, GUEST],
    );
    const { goal, goalShort } = await aGoal();

    expect(await call("goals.read", { id: goalShort })).toEqual(
      await call("goals.read", { id: goal }),
    );

    const malformed = await refusal(
      call("goals.read", { id: "not an id at all" }),
    );
    const unknown = await refusal(call("goals.read", { id: "Zz9Zz9Zz9Z" }));
    const unseen = await refusal(call("goals.read", { id: goalShort }, GUEST));
    for (const one of [malformed, unknown, unseen]) {
      expect(one.name).not.toBe("ZodError");
      expect(one.code).toBe("not_found");
      expect(one.message).toBe(malformed.message);
    }
    // Case is part of the address.
    const flipped = goalShort.replace(/[a-z]/, (c) => c.toUpperCase());
    if (flipped !== goalShort) {
      expect((await refusal(call("goals.read", { id: flipped }))).code).toBe(
        "not_found",
      );
    }
  });

  it("takes a short id in a nested list, a subject that names its kind, a restore and a dry run", async () => {
    const wb = await workerDb();
    const { goal, goalShort, keyResult, keyResultShort } = await aGoal();
    const space = (await call("spaces.create", { name: "Product" })) as {
      id: string;
    };

    const initiative = (await call("initiatives.create", {
      spaceId: space.id,
      title: "Onboarding rebuild",
      ownerId: ownerMemberId,
      keyResultIds: [keyResultShort],
    })) as { id: string };
    const links = await wb.admin.query<{ key_result_id: string }>(
      `select key_result_id from initiative_key_results
        where initiative_id = $1 and deleted_at is null`,
      [initiative.id],
    );
    expect(links.rows.map((row) => row.key_result_id)).toEqual([keyResult]);

    const task = (await call("tasks.create", {
      spaceId: space.id,
      title: "Pricing page copy",
      keyResultId: keyResultShort,
      initiativeId: (await shortIdOf("initiatives", initiative.id)) as string,
    })) as { id: string };
    const stored = await wb.admin.query<{
      key_result_id: string;
      initiative_id: string;
    }>("select key_result_id, initiative_id from tasks where id = $1", [
      task.id,
    ]);
    expect(stored.rows[0]).toEqual({
      key_result_id: keyResult,
      initiative_id: initiative.id,
    });

    // The subject's kind is named beside it.
    const document = (await call("documents.create", {
      subjectType: "goal",
      subjectId: goalShort,
      title: "Launch plan",
    })) as { id: string };
    const subject = await wb.admin.query<{ subject_id: string }>(
      "select subject_id from documents where id = $1",
      [document.id],
    );
    expect(subject.rows[0]?.subject_id).toBe(goal);
    // A space has no short id, so anything but its UUID names nothing.
    expect(
      (
        await refusal(
          call("documents.create", {
            subjectType: "space",
            subjectId: "Zz9Zz9Zz9Z",
            title: "Notes",
          }),
        )
      ).code,
    ).toBe("not_found");

    // A deleted goal is restored by the address it had.
    await call("goals.delete", { id: goalShort });
    await call("goals.restore", { id: goalShort });
    const live = await wb.admin.query<{ deleted_at: Date | null }>(
      "select deleted_at from goals where id = $1",
      [goal],
    );
    expect(live.rows[0]?.deleted_at).toBeNull();

    // A dry run answers the input it checked, with the key in it.
    const checked = await validateAction(
      {
        pool: wb.appPool,
        workspaceId,
        actor: { kind: "human", userId: OWNER },
      },
      "goals.updateConfidence",
      { id: keyResultShort, confidence: 0.6 },
    );
    expect(checked?.input).toMatchObject({ id: keyResult, confidence: 0.6 });
  });

  it("resolves for the system, which no access rule narrows, and refuses through the access getter for a member", async () => {
    const wb = await workerDb();
    const { goal, goalShort, keyResult, keyResultShort } = await aGoal();
    const system = { workspaceId, memberId: null };
    const member = { workspaceId, memberId: ownerMemberId };
    await withWorkspace(drizzle(wb.appPool), workspaceId, async (tx) => {
      const anyTx = tx as unknown as Parameters<typeof resolveAddress>[0];
      expect(await resolveAddress(anyTx, system, "goal", goalShort)).toEqual({
        id: goal,
        shortId: goalShort,
      });
      expect(await resolveAddress(anyTx, member, "goal", goal)).toEqual({
        id: goal,
        shortId: goalShort,
      });
      expect(
        await resolveAddress(anyTx, member, "key_result", keyResultShort),
      ).toEqual({ id: keyResult, shortId: keyResultShort });
      // A goal's short id is not a key result's.
      await expect(
        resolveAddress(anyTx, member, "key_result", goalShort),
      ).rejects.toThrow("No such key result, or you do not have access to it.");
    });
  });
});
