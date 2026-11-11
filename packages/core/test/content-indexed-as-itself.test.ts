/**
 * Content is queued for the copilot's index and for search as itself, not as
 * the thing it hangs off (AI-NATIVE-PLAN.md §9, P4-T13a; TECHNICAL-PLAN §9,
 * P5-T13).
 *
 * The pipeline queues a write's activity subject when that subject is content,
 * and a write whose activity names a container has to say what it changed
 * through `activity.embed`. Check-ins, key results and blockers did neither:
 * their activities name the goal or the space, so the goal was queued again and
 * the check-in, the key result and the blocker never reached either index. A
 * live test on 11 November 2026 found none of 486 check-ins and 54 of 118 key
 * results in the copilot's index, so the copilot could not answer what a
 * check-in said.
 *
 * Writes that create several objectives and key results at once, the carry of
 * kept objectives and a KPI's recovery, queue each one they create, the way an
 * archive import does: one activity can name only one thing.
 */
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { EMBED_TOPIC } from "../src/embeddings/subjects.ts";
import { runEmbedJob } from "../src/embeddings/worker.ts";
import { INDEX_TOPIC } from "../src/search/subjects.ts";
import { parseIndexJob, runIndexJob } from "../src/search/worker.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const OWNER = "indexed-owner";

let workspaceId: string;
let cycleId: string;
let spaceId: string;
let memberId: string;
let goalId: string;
let keyResultId: string;

const call = async <T>(name: string, input: unknown): Promise<T> => {
  const wb = await workerDb();
  return (await callAction(
    {
      pool: wb.appPool,
      workspaceId,
      actor: { kind: "human" as const, userId: OWNER },
    },
    name as never,
    input as never,
  )) as T;
};

interface Queued {
  readonly entityType: string;
  readonly entityId: string;
}

/** Every job waiting on one topic, oldest first. */
const queued = async (topic: string): Promise<Queued[]> => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    payload: { entityType: string; entityId: string };
  }>("select payload from outbox where topic = $1 order by created_at", [
    topic,
  ]);
  return rows.map((row) => ({
    entityType: row.payload.entityType,
    entityId: row.payload.entityId,
  }));
};

/** What one write queued on both topics: the jobs after the ones before it. */
const queuedBy = async (write: () => Promise<unknown>) => {
  const embedBefore = (await queued(EMBED_TOPIC)).length;
  const indexBefore = (await queued(INDEX_TOPIC)).length;
  await write();
  return {
    embed: (await queued(EMBED_TOPIC)).slice(embedBefore),
    index: (await queued(INDEX_TOPIC)).slice(indexBefore),
  };
};

const paragraph = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

/** Runs every queued search job for one entity, oldest first. */
const indexQueued = async (entityId: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ payload: unknown }>(
    "select payload from outbox where topic = $1 order by created_at",
    [INDEX_TOPIC],
  );
  for (const row of rows) {
    const job = parseIndexJob(row.payload);
    if (job?.entityId === entityId) {
      await runIndexJob(job, { pool: wb.appPool });
    }
  }
};

const searchRows = async (entityId: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ title: string }>(
    "select title from search_documents where entity_id = $1",
    [entityId],
  );
  return rows;
};

const publishedCheckIn = async (text: string) => {
  const draft = await call<{ id: string }>("goals.startCheckIn", { goalId });
  await call("goals.publishCheckIn", {
    id: draft.id,
    status: "on_track",
    confidence: 0.7,
    narrative: paragraph(text),
  });
  return draft.id;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, 'Owner', $2)",
    [OWNER, "indexed-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;
  memberId = provisioned.memberId;
  spaceId = (await call<{ id: string }[]>("spaces.list", {}))[0]?.id as string;
  cycleId = (
    await call<{ id: string }>("cycles.current", { mode: "quarterly" })
  ).id;
  goalId = (
    await call<{ id: string }>("goals.create", {
      title: "Become the platform mid-market teams reach for first",
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: memberId,
      reviewerId: memberId,
      weight: 1,
    })
  ).id;
  keyResultId = (
    await call<{ id: string }>("goals.addKeyResult", {
      goalId,
      title: "Raise weekly active teams from 120 to 300",
      direction: "increase",
      indicatorType: "leading",
      baselineValue: 120,
      targetValue: 300,
      unit: "teams",
      weight: 1,
    })
  ).id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a key result", () => {
  it("is queued as itself when it is added, for both indexes", async () => {
    const added = await queuedBy(() =>
      call("goals.addKeyResult", {
        goalId,
        title: "Cut onboarding time from 14 days to 5",
        direction: "reduce",
        indicatorType: "leading",
        baselineValue: 14,
        targetValue: 5,
        unit: "days",
        weight: 1,
      }),
    );
    expect(added.embed.map((job) => job.entityType)).toEqual(["key_result"]);
    expect(added.index.map((job) => job.entityType)).toEqual(["key_result"]);
    expect(added.embed[0]?.entityId).toBe(added.index[0]?.entityId);
  });

  it("is queued as itself when it is edited, so a new title is found", async () => {
    const edited = await queuedBy(() =>
      call("goals.updateKeyResult", {
        id: keyResultId,
        title: "Raise weekly active teams from 120 to 350",
      }),
    );
    expect(edited.embed).toEqual([
      { entityType: "key_result", entityId: keyResultId },
    ]);
    expect(edited.index).toEqual([
      { entityType: "key_result", entityId: keyResultId },
    ]);
  });
});

describe("a check-in", () => {
  it("is queued as itself when it is published, and the workers then hold its words", async () => {
    let checkInId = "";
    const published = await queuedBy(async () => {
      checkInId = await publishedCheckIn(
        "Trial emails are landing and activation moved two points.",
      );
    });
    // The draft opening names the goal and queues nothing worth reading; the
    // publication is what has to name the check-in.
    expect(published.embed).toContainEqual({
      entityType: "check_in",
      entityId: checkInId,
    });
    expect(published.index).toContainEqual({
      entityType: "check_in",
      entityId: checkInId,
    });

    const wb = await workerDb();
    const outcome = await runEmbedJob(
      { workspaceId, entityType: "check_in", entityId: checkInId },
      { pool: wb.appPool, embed: null },
    );
    expect(outcome).toEqual({ kind: "embedded" });
    const { rows } = await wb.admin.query<{ content: string }>(
      "select content from embeddings where entity_id = $1",
      [checkInId],
    );
    expect(rows.map((row) => row.content).join(" ")).toContain(
      "Trial emails are landing",
    );

    await indexQueued(checkInId);
    expect(await searchRows(checkInId)).toHaveLength(1);
  });

  it("is queued as itself when it is published in one action, as an applied proposal is", async () => {
    let checkInId = "";
    const published = await queuedBy(async () => {
      checkInId = (
        await call<{ id: string }>("goals.publishDraftedCheckIn", {
          goalId,
          status: "on_track",
          confidence: 0.6,
          narrative: paragraph("Moving as planned this week."),
        })
      ).id;
    });
    expect(published.embed).toEqual([
      { entityType: "check_in", entityId: checkInId },
    ]);
    expect(published.index).toEqual([
      { entityType: "check_in", entityId: checkInId },
    ]);
  });

  it("is queued as itself when it is edited inside its window", async () => {
    const checkInId = await publishedCheckIn("First words.");
    const edited = await queuedBy(() =>
      call("goals.editCheckIn", {
        id: checkInId,
        narrative: paragraph("Second words, after the review."),
      }),
    );
    expect(edited.embed).toEqual([
      { entityType: "check_in", entityId: checkInId },
    ]);
    expect(edited.index).toEqual([
      { entityType: "check_in", entityId: checkInId },
    ]);
  });

  it("is queued as itself when it is deleted, so its search entry goes with it", async () => {
    const checkInId = await publishedCheckIn("Words that will be deleted.");
    await indexQueued(checkInId);
    expect(await searchRows(checkInId)).toHaveLength(1);

    const deleted = await queuedBy(() =>
      call("goals.deleteCheckIn", { id: checkInId }),
    );
    expect(deleted.index).toEqual([
      { entityType: "check_in", entityId: checkInId },
    ]);
    await indexQueued(checkInId);
    expect(await searchRows(checkInId)).toEqual([]);
  });

  it("is queued as itself when an import publishes it", async () => {
    let checkInId = "";
    const imported = await queuedBy(async () => {
      checkInId = (
        await call<{ id: string }>("goals.importCheckIn", {
          goalId,
          authorMemberId: memberId,
          status: "caution",
          confidence: 0.4,
          narrative: paragraph("Imported from the old tool."),
          publishedAt: new Date(Date.now() - 86_400_000).toISOString(),
          legacy: { type: "csv", id: "row-7" },
        })
      ).id;
    });
    expect(imported.embed).toEqual([
      { entityType: "check_in", entityId: checkInId },
    ]);
    expect(imported.index).toEqual([
      { entityType: "check_in", entityId: checkInId },
    ]);
  });
});

describe("a blocker", () => {
  it("is queued as itself when it is raised on a key result", async () => {
    let blockerId = "";
    const raised = await queuedBy(async () => {
      blockerId = (
        await call<{ id: string }>("blockers.raise", {
          keyResultId,
          type: "dependency",
          description: "Waiting on the billing team's export.",
          ownerId: memberId,
          nextAction: "Ask billing for a date.",
        })
      ).id;
    });
    expect(raised.embed).toEqual([
      { entityType: "blocker", entityId: blockerId },
    ]);
  });

  it("is queued as itself when a session opens it", async () => {
    const sessionId = (
      await call<{ id: string }>("sessions.create", {
        spaceId,
        cycleId,
        kind: "weekly",
        title: "Monday check",
        scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
        facilitatorId: memberId,
      })
    ).id;
    await call("sessions.open", { id: sessionId });

    let blockerId = "";
    const opened = await queuedBy(async () => {
      blockerId = (
        await call<{ id: string }>("sessions.createBlocker", {
          sessionId,
          keyResultId,
          type: "clarity",
          description: "Nobody agrees what an active team is.",
          ownerId: memberId,
          nextAction: "Write the definition down.",
        })
      ).id;
    });
    expect(opened.embed).toEqual([
      { entityType: "blocker", entityId: blockerId },
    ]);
  });
});

describe("writes that create several objectives at once", () => {
  it("queue the recovery objective and each key result a KPI's recovery creates", async () => {
    const kpi = await call<{ id: string }>("kpis.create", {
      title: "Net revenue retention",
      ownerKind: "member",
      memberId,
      frequency: "monthly",
      direction: "higher_better",
      indicatorType: "lagging",
      tier: "output",
      aggregate: "sum",
    });
    for (const on of ["2026-01-15", "2026-02-15"]) {
      await call("kpis.record", {
        kpiId: kpi.id,
        on,
        targetValue: 100,
        actualValue: 60,
      });
    }

    let launched = { goalId: "", keyResultIds: [] as string[] };
    const queuedNow = await queuedBy(async () => {
      launched = await call("kpis.launchRecovery", {
        kpiId: kpi.id,
        cycleId,
      });
    });
    const expected = [
      { entityType: "goal", entityId: launched.goalId },
      ...launched.keyResultIds.map((id) => ({
        entityType: "key_result",
        entityId: id,
      })),
    ];
    for (const job of expected) {
      expect(queuedNow.embed).toContainEqual(job);
      expect(queuedNow.index).toContainEqual(job);
    }
  });

  it("queue each objective and key result the carry of a kept objective creates", async () => {
    const inNextQuarter = new Date(Date.now() + 120 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const toCycleId = (
      await call<{ id: string }>("cycles.create", {
        on: inNextQuarter,
        cadence: "quarterly",
      })
    ).id;
    const sessionId = (
      await call<{ id: string }>("sessions.create", {
        spaceId,
        cycleId,
        kind: "quarterly",
        title: "Q1 review",
        scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
        facilitatorId: memberId,
      })
    ).id;
    await call("sessions.open", { id: sessionId });
    await call("sessions.decideObjective", {
      sessionId,
      goalId,
      decision: "keep",
      why: "The room decided it.",
    });
    await call("sessions.close", { id: sessionId });

    const carriedNow = await queuedBy(() =>
      call("cycles.feedForward", { fromCycleId: cycleId, toCycleId }),
    );

    const wb = await workerDb();
    const { rows: drafts } = await wb.admin.query<{ id: string }>(
      "select id from goals where cycle_id = $1 and carried_from_goal_id = $2",
      [toCycleId, goalId],
    );
    expect(drafts).toHaveLength(1);
    const draftId = drafts[0]?.id as string;
    const { rows: keyResults } = await wb.admin.query<{ id: string }>(
      "select id from key_results where goal_id = $1",
      [draftId],
    );
    expect(keyResults).toHaveLength(1);

    for (const job of [
      { entityType: "goal", entityId: draftId },
      { entityType: "key_result", entityId: keyResults[0]?.id as string },
    ]) {
      expect(carriedNow.embed).toContainEqual(job);
      expect(carriedNow.index).toContainEqual(job);
    }
  });
});
