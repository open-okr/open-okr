import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bindGroup, ensureMemberGroup } from "../src/access/contexts.ts";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import { resolveSubjectContext } from "../src/access/reads.ts";
import { callAction } from "../src/actions/registry.ts";
import { runOperation } from "../src/operations/operation.ts";
import { runIndexJob } from "../src/search/worker.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * `search.recent`, the palette's Recent group (work-layer.md §5.1, plan 0.9.0
 * G2).
 *
 * The browser keeps a list of what a member opened and sends it here as a
 * hint. These prove the list is never an authority: what a member may not
 * open, or what was deleted, is absent from the answer, the order the browser
 * gave is kept, and a new device with no list is answered from the member's
 * own activity rows, read the same way.
 */

const OWNER = "recent-owner";
const GUEST = "recent-guest";

let workspaceId: string;
let ownerMemberId: string;
let guestMemberId: string;
let spaceId: string;
let goalId: string;
let keyResultId: string;
let kpiId: string;
let initiativeId: string;
let taskId: string;
let otherTaskId: string;

type Recent = {
  entityType: string;
  entityId: string;
  title: string;
  href: string;
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

const recent = async (
  refs: readonly { kind: string; id: string }[] | undefined,
  userId = OWNER,
) => (await call("search.recent", { refs }, userId)) as Recent[];

/** Indexes one entity the way the relay would. */
const index = async (entityType: string, entityId: string) => {
  const wb = await workerDb();
  return runIndexJob(
    { workspaceId, entityType, entityId },
    { pool: wb.appPool },
  );
};

const ref = (kind: string, id: string) => ({ kind, id });

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    `insert into users (id, name, email) values ($1, 'Ada', $2), ($3, 'Gus', $4)`,
    [OWNER, "recent-owner@example.com", GUEST, "recent-guest@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Ada",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;

  spaceId = (
    (await call("spaces.create", { name: "Aurora squad" })) as {
      id: string;
    }
  ).id;
  const cycle = (await call("cycles.current", { mode: "quarterly" })) as {
    id: string;
  };
  goalId = (
    (await call("goals.create", {
      title: "Aurora launch lands with mid-market teams",
      cycleId: cycle.id,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: ownerMemberId,
      reviewerId: ownerMemberId,
      weight: 1,
    })) as { id: string }
  ).id;
  keyResultId = (
    (await call("goals.addKeyResult", {
      goalId,
      title: "Aurora activation from 41% to 60%",
      direction: "increase",
      indicatorType: "lagging",
      baselineValue: 41,
      targetValue: 60,
      weight: 1,
    })) as { id: string }
  ).id;
  kpiId = (
    (await call("kpis.create", {
      title: "Aurora weekly signups",
      frequency: "monthly",
      direction: "higher_better",
      indicatorType: "lagging",
      tier: "output",
      aggregate: "sum",
      ownerKind: "workspace",
    })) as { id: string }
  ).id;
  initiativeId = (
    (await call("initiatives.create", {
      spaceId,
      title: "Aurora onboarding rebuild",
      ownerId: ownerMemberId,
    })) as { id: string }
  ).id;
  taskId = (
    (await call("tasks.create", {
      spaceId,
      title: "Aurora pricing page copy",
    })) as {
      id: string;
    }
  ).id;
  otherTaskId = (
    (await call("tasks.create", {
      spaceId,
      title: "Aurora billing migration",
    })) as { id: string }
  ).id;

  const people = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status, kind)
     values (gen_random_uuid(), $1, $2, 'Gus Guest', 'active', 'guest')
     returning id`,
    [workspaceId, GUEST],
  );
  guestMemberId = people.rows[0]?.id as string;

  for (const [type, id] of [
    ["goal", goalId],
    ["key_result", keyResultId],
    ["kpi", kpiId],
    ["initiative", initiativeId],
    ["task", taskId],
    ["task", otherTaskId],
  ] as const) {
    await index(type, id);
  }
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("what the browser remembers is checked again", () => {
  it("answers each thing with its title and page, in the order given", async () => {
    const found = await recent([
      ref("task", taskId),
      ref("goal", goalId),
      ref("key_result", keyResultId),
      ref("kpi", kpiId),
      ref("initiative", initiativeId),
      ref("space", spaceId),
      ref("person", ownerMemberId),
    ]);
    expect(found.map((one) => [one.entityType, one.href])).toEqual([
      ["task", `/tasks/${taskId}`],
      ["goal", `/goals/${goalId}`],
      // A key result opens its goal, at its own row.
      ["key_result", `/goals/${goalId}#kr-${keyResultId}`],
      ["kpi", `/kpis/${kpiId}`],
      ["initiative", `/initiatives/${initiativeId}`],
      ["space", `/spaces/${spaceId}`],
      ["person", `/people/${ownerMemberId}`],
    ]);
    expect(found[0]?.title).toBe("Aurora pricing page copy");
    expect(found[6]?.title).toBe("Ada");
  });

  it("lists a thing once, at the place it was first given", async () => {
    const found = await recent([
      ref("task", otherTaskId),
      ref("task", taskId),
      ref("task", otherTaskId),
    ]);
    expect(found.map((one) => one.entityId)).toEqual([otherTaskId, taskId]);
  });

  it("leaves out what the reader may not open, and keeps what they may", async () => {
    // A guest holds no blanket tier. It is let into one task through its own
    // group, the one grant a guest has, and every other id it sends is absent.
    const wb = await workerDb();
    await runOperation(
      { pool: wb.appPool },
      {
        action: "test.grant-guest",
        workspaceId,
        actor: { kind: "human", userId: OWNER },
        async execute({ tx }) {
          const context = await resolveSubjectContext(
            tx,
            "task",
            taskId,
            workspaceId,
          );
          const groupId = await ensureMemberGroup(tx, {
            workspaceId,
            memberId: guestMemberId,
          });
          await bindGroup(tx, {
            workspaceId,
            groupId,
            contextId: context?.contextId as string,
            level: ACCESS_LEVELS.view,
          });
          return {
            result: undefined,
            activity: {
              kind: "test.grant-guest",
              subjectType: "task",
              subjectId: taskId,
            },
            audit: { action: "test.grant-guest", targetType: "task" },
          };
        },
      },
    );

    const found = await recent(
      [
        ref("goal", goalId),
        ref("task", otherTaskId),
        ref("task", taskId),
        ref("kpi", kpiId),
        ref("initiative", initiativeId),
      ],
      GUEST,
    );
    expect(found.map((one) => one.entityId)).toEqual([taskId]);
  });

  it("drops a deleted thing at once, before the index has caught up", async () => {
    await call("tasks.delete", { id: otherTaskId });
    // The index row is still there: the relay has not run. The answer is
    // right all the same, because the source row is read too.
    const found = await recent([ref("task", otherTaskId), ref("task", taskId)]);
    expect(found.map((one) => one.entityId)).toEqual([taskId]);
  });

  it("answers nothing for an id that never existed, rather than an error", async () => {
    const found = await recent([
      ref("task", "00000000-0000-4000-8000-000000000000"),
      ref("goal", goalId),
    ]);
    expect(found.map((one) => one.entityId)).toEqual([goalId]);
  });

  it("refuses more than twenty, which is all the browser keeps", async () => {
    const many = Array.from({ length: 21 }, () => ref("goal", goalId));
    await expect(recent(many)).rejects.toThrow();
  });
});

describe("a new device, with no list, starts from what the member changed", () => {
  it("answers the member's own last changes, newest first", async () => {
    const found = await recent(undefined);
    const ids = found.map((one) => one.entityId);
    // Created last, so first. Each thing once however often it was written.
    expect(ids.slice(0, 2)).toEqual([otherTaskId, taskId]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([goalId, kpiId, initiativeId]));
    expect(found.length).toBeLessThanOrEqual(20);
  });

  it("is the same for an empty list as for none", async () => {
    expect(await recent([])).toEqual(await recent(undefined));
  });

  it("leaves out what was deleted since", async () => {
    await call("tasks.delete", { id: otherTaskId });
    const ids = (await recent(undefined)).map((one) => one.entityId);
    expect(ids).not.toContain(otherTaskId);
    expect(ids[0]).toBe(taskId);
  });

  it("answers a member who changed nothing with nothing", async () => {
    expect(await recent(undefined, GUEST)).toEqual([]);
  });

  it("records nothing: reading leaves the activity rows as they were", async () => {
    const wb = await workerDb();
    const count = async () =>
      (
        await wb.admin.query<{ n: string }>(
          "select count(*) as n from activities where workspace_id = $1",
          [workspaceId],
        )
      ).rows[0]?.n;
    const before = await count();
    await recent(undefined);
    await recent([ref("goal", goalId)]);
    expect(await count()).toBe(before);
  });
});
