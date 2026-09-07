/**
 * The outbox-driven embedding worker (AI-NATIVE-PLAN.md §9, P4-T13a).
 *
 * The task's test plan:
 * - re-embedding is skipped when the content hash is unchanged
 * - the worker is driven only by outbox rows
 * - the chunker terminates on every input including one shorter than the overlap
 *
 * The third line is `embeddings-chunker.test.ts`, which was already green before
 * this row. These are the first two, plus the acceptance criterion: a goal edited
 * twice with the same text embeds once.
 *
 * **Two measurements, because one of them is not available everywhere.**
 *
 * "Embeds once" is a statement about how many times a model was asked, so the
 * embed function counts its calls. But `EmbeddingService.index()` only asks a
 * model when pgvector is present: without the extension it stores the chunk text
 * and leaves the vector null, which is the documented fallback in migration 0031
 * and the reason retrieval degrades to full text. On a Postgres without pgvector
 * the model is never asked and a call count of one is unreachable.
 *
 * So the model-call assertions are guarded by `hasVector`, and every test also
 * asserts the observable that holds either way: the hash-skip path leaves the
 * stored row alone, so its `updated_at` does not move on a second job. That is
 * the same fact the call count measures, seen from the other side.
 *
 * This machine has no pgvector. Saying so beats a test that passes here and
 * measures nothing.
 */
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { EMBED_TOPIC } from "../src/embeddings/subjects.ts";
import { parseEmbedJob, runEmbedJob } from "../src/embeddings/worker.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const OWNER = "embed-owner";

let workspaceId: string;
let cycleId: string;
let spaceId: string;
let memberId: string;
let goalId: string;

/** Counts what the model was asked to embed, which is what "once" means. */
let embedCalls: string[][];
/** Whether this Postgres can hold a vector, which decides what is measurable. */
let hasVector = false;
const embed = async (inputs: readonly string[]) => {
  embedCalls.push([...inputs]);
  return {
    vectors: inputs.map(() => [0.1, 0.2, 0.3]),
    dimensions: 3,
    model: "test-embed",
  };
};

const call = async (name: string, input: unknown) => {
  const wb = await workerDb();
  return callAction(
    {
      pool: wb.appPool,
      workspaceId,
      actor: { kind: "human" as const, userId: OWNER },
    },
    name as never,
    input as never,
  );
};

/** Every `content.embed` row waiting in the outbox, oldest first. */
const queuedJobs = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ payload: unknown }>(
    "select payload from outbox where topic = $1 order by created_at",
    [EMBED_TOPIC],
  );
  return rows
    .map((row) => parseEmbedJob(row.payload))
    .filter((job): job is NonNullable<typeof job> => job !== null);
};

const storedChunks = async (entityId: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    content: string;
    content_hash: string;
    updated_at: string;
  }>(
    "select content, content_hash, updated_at from embeddings where entity_id = $1 order by chunk_index",
    [entityId],
  );
  return rows;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  embedCalls = [];

  const { rows } = await wb.admin.query<{ present: boolean }>(
    "select exists (select 1 from pg_extension where extname = 'vector') as present",
  );
  hasVector = rows[0]?.present ?? false;

  await wb.admin.query(
    `insert into users (id, name, email) values ($1, 'Owner', $2)`,
    [OWNER, "embed-owner@example.com"],
  );

  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;
  memberId = provisioned.memberId;

  const spaces = (await call("spaces.list", {})) as { id: string }[];
  spaceId = spaces[0]?.id as string;
  const current = (await call("cycles.current", { mode: "quarterly" })) as {
    id: string;
  };
  cycleId = current.id;

  const goal = (await call("goals.create", {
    title: "Become the platform mid-market teams reach for first",
    cycleId,
    spaceId,
    level: "team",
    ownerKind: "space",
    championId: memberId,
    reviewerId: memberId,
    weight: 1,
  })) as { id: string };
  goalId = goal.id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the pipeline enqueues the work", () => {
  it("queues a goal without the action asking", async () => {
    // Creating the goal in `beforeEach` was enough: the activity's subject is the
    // goal, so the pipeline enqueued by itself. No action in the product mentions
    // embedding, which is the point of putting the enqueue in one place.
    const jobs = await queuedJobs();
    const forGoal = jobs.filter((job) => job.entityId === goalId);
    expect(forGoal).toHaveLength(1);
    expect(forGoal[0]?.entityType).toBe("goal");
    expect(forGoal[0]?.workspaceId).toBe(workspaceId);
  });

  it("queues nothing for a write whose subject is not content", async () => {
    const before = (await queuedJobs()).length;
    // A workspace rename is a real write with a real activity row, and there is
    // nothing on it worth a vector.
    await call("workspace.rename", { name: "Renamed workspace" });
    expect((await queuedJobs()).length).toBe(before);
  });

  it("queues the content, not its container, when a write says so", async () => {
    const session = (await call("sessions.create", {
      spaceId,
      cycleId,
      kind: "quarterly",
      title: "Q1 review",
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
      facilitatorId: memberId,
    })) as { id: string };
    await call("sessions.open", { id: session.id });

    const before = await queuedJobs();
    const note = (await call("sessions.addRetroNote", {
      sessionId: session.id,
      columnKey: "didnt",
      text: "The dependency surfaced in week nine.",
      anonymous: false,
    })) as { id: string };

    const added = (await queuedJobs()).slice(before.length);
    // The retro note's activity names the space. Embedding the space would be
    // embedding the wrong thing, so the write names the note.
    expect(added).toHaveLength(1);
    expect(added[0]?.entityType).toBe("retro_note");
    expect(added[0]?.entityId).toBe(note.id);
  });
});

describe("the worker", () => {
  it("embeds the entity a job names", async () => {
    const wb = await workerDb();
    const [job] = (await queuedJobs()).filter(
      (entry) => entry.entityId === goalId,
    );
    if (!job) {
      throw new Error("no job for the goal");
    }

    const outcome = await runEmbedJob(job, { pool: wb.appPool, embed });
    expect(outcome.kind).toBe("embedded");

    const chunks = await storedChunks(goalId);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toContain("mid-market");
    // The text is stored either way. The vector, and so the model call, only
    // when this Postgres can hold one.
    expect(embedCalls).toHaveLength(hasVector ? 1 : 0);
  });

  it("embeds once when the same text is written twice, which is the acceptance criterion", async () => {
    const wb = await workerDb();

    // The same title again. §9's whole reason for a content hash: an edit that
    // changes nothing must not spend a model call, and a room correcting a typo
    // and undoing it produces exactly this.
    await call("goals.update", {
      id: goalId,
      title: "Become the platform mid-market teams reach for first",
    });

    const jobs = (await queuedJobs()).filter(
      (entry) => entry.entityId === goalId,
    );
    // Two writes, two rows. The pipeline does not try to be clever about whether
    // the text moved, because it cannot know without reading it.
    expect(jobs.length).toBeGreaterThanOrEqual(2);

    const [first] = jobs;
    if (!first) {
      throw new Error("no job for the goal");
    }
    await runEmbedJob(first, { pool: wb.appPool, embed });
    const afterFirst = await storedChunks(goalId);

    for (const job of jobs.slice(1)) {
      await runEmbedJob(job, { pool: wb.appPool, embed });
    }
    const afterAll = await storedChunks(goalId);

    // **The observable that holds with or without pgvector.** An unchanged hash
    // takes the skip path, which writes nothing at all, so the row is untouched.
    expect(afterAll).toHaveLength(1);
    expect(String(afterAll[0]?.updated_at)).toBe(
      String(afterFirst[0]?.updated_at),
    );
    expect(afterAll[0]?.content_hash).toBe(afterFirst[0]?.content_hash);
    // And the direct measurement, where it is available.
    expect(embedCalls).toHaveLength(hasVector ? 1 : 0);
  });

  it("embeds again when the text actually changes", async () => {
    const wb = await workerDb();
    const first = (await queuedJobs()).filter(
      (entry) => entry.entityId === goalId,
    )[0];
    if (!first) {
      throw new Error("no job for the goal");
    }
    await runEmbedJob(first, { pool: wb.appPool, embed });

    await call("goals.update", {
      id: goalId,
      title: "Become the platform enterprise teams reach for first",
    });
    const jobs = (await queuedJobs()).filter(
      (entry) => entry.entityId === goalId,
    );
    await runEmbedJob(jobs[jobs.length - 1] as NonNullable<(typeof jobs)[0]>, {
      pool: wb.appPool,
      embed,
    });

    // The hash moved, so the row was rewritten. A cache that never invalidated
    // would be worse than no cache.
    const chunks = await storedChunks(goalId);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toContain("enterprise");
    expect(embedCalls).toHaveLength(hasVector ? 2 : 0);
  });

  it("skips an entity type it cannot read, rather than failing the job", async () => {
    const wb = await workerDb();
    const outcome = await runEmbedJob(
      { workspaceId, entityType: "space", entityId: spaceId },
      { pool: wb.appPool, embed },
    );
    // A row naming a type this build cannot read would otherwise retry until it
    // dead-letters, and a dead letter is an alert about a queue rather than
    // about the product.
    expect(outcome).toEqual({
      kind: "skipped",
      reason: "nothing embeds a space",
    });
    expect(embedCalls).toHaveLength(0);
  });

  it("skips an entity that no longer exists", async () => {
    const wb = await workerDb();
    const outcome = await runEmbedJob(
      {
        workspaceId,
        entityType: "goal",
        entityId: "01a03d00-0000-7000-8000-000000000000",
      },
      { pool: wb.appPool, embed },
    );
    expect(outcome.kind).toBe("skipped");
    expect(embedCalls).toHaveLength(0);
  });

  it("refuses a payload that is not a job", async () => {
    // The worker parses rather than trusts: an outbox row is data written by an
    // earlier version of this code, and a payload it cannot read must not
    // become an exception in a queue consumer.
    expect(parseEmbedJob(null)).toBeNull();
    expect(parseEmbedJob({ workspaceId })).toBeNull();
    expect(
      parseEmbedJob({ workspaceId, entityType: 4, entityId: "x" }),
    ).toBeNull();
  });
});

describe("what the worker never does", () => {
  it("does not embed an unpublished check-in", async () => {
    const wb = await workerDb();
    const keyResult = (await call("goals.addKeyResult", {
      goalId,
      title: "Raise weekly active teams from 120 to 300",
      direction: "increase",
      indicatorType: "leading",
      baselineValue: 120,
      targetValue: 300,
      unit: "teams",
      weight: 1,
    })) as { id: string };
    expect(keyResult.id).toBeTruthy();

    const draft = (await call("goals.startCheckIn", {
      goalId,
      narrative: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Not published, and nobody else can read it.",
              },
            ],
          },
        ],
      },
      status: "on_track",
    })) as { id: string };

    const outcome = await runEmbedJob(
      { workspaceId, entityType: "check_in", entityId: draft.id },
      { pool: wb.appPool, embed },
    );
    // P3-T07 makes a draft visible only to its author. Embedding one would put
    // unpublished text into an index everybody's retrieval reads.
    expect(outcome).toEqual({ kind: "skipped", reason: "no text to embed" });
    expect(embedCalls).toHaveLength(0);
  });
});
