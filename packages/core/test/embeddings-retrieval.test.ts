/**
 * Access-filtered retrieval (AI-NATIVE-PLAN.md §9, P4-T13b).
 *
 * The task's test plan:
 * - retrieval never returns a chunk the requester cannot read
 * - with the extension absent the product still answers using full text
 *
 * The second line is what this machine can prove directly: it has no pgvector, so
 * every query here takes the full-text path, which is the degradation the row
 * asks for. The first line is proved against a member who is suspended, because
 * suspension is the refusal that actually exists in this product: P3-T01's
 * `workspace_standard` binding gives every *active* member `edit` across the
 * workspace, so "a member outside the space" is not a real refusal here and a
 * test asserting it would pass for the wrong reason.
 *
 * **The first assertion in this file is about a defect, not a feature.** Before
 * P4-T13b the three retrieval queries ran straight on the pool with no
 * `app.workspace_id`, and row-level security is forced on `embeddings`, so
 * retrieval returned an empty list for every caller no matter what was indexed.
 * Nothing called it yet, so nothing noticed.
 */
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { EmbeddingService } from "../src/embeddings/service.ts";
import { runEmbedJob } from "../src/embeddings/worker.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const OWNER = "retrieval-owner";
const READER = "retrieval-reader";

let workspaceId: string;
let cycleId: string;
let spaceId: string;
let ownerMemberId: string;
let readerMemberId: string;
let goalId: string;

const embed = async (inputs: readonly string[]) => ({
  vectors: inputs.map(() => [0.1, 0.2, 0.3]),
  dimensions: 3,
  model: "test-embed",
});

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

const retrieve = async (query: string, memberId: string, limit = 10) => {
  const wb = await workerDb();
  const service = new EmbeddingService(wb.appPool, embed);
  return service.retrieve({ workspaceId, memberId, query, limit });
};

/** Indexes one entity the way the relay would: read the job, run the worker. */
const indexEntity = async (entityType: string, entityId: string) => {
  const wb = await workerDb();
  return runEmbedJob(
    { workspaceId, entityType, entityId },
    { pool: wb.appPool, embed },
  );
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();

  await wb.admin.query(
    `insert into users (id, name, email) values ($1, 'Owner', $2), ($3, 'Reader', $4)`,
    [
      OWNER,
      "retrieval-owner@example.com",
      READER,
      "retrieval-reader@example.com",
    ],
  );

  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;

  const spaces = (await call("spaces.list", {})) as { id: string }[];
  spaceId = spaces[0]?.id as string;
  const current = (await call("cycles.current", { mode: "quarterly" })) as {
    id: string;
  };
  cycleId = current.id;

  const reader = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Reader', 'active') returning id`,
    [workspaceId, READER],
  );
  readerMemberId = reader.rows[0]?.id as string;
  await call("spaces.addMember", {
    spaceId,
    memberId: readerMemberId,
    role: "member",
  });

  const goal = (await call("goals.create", {
    title: "Become the platform mid-market teams reach for first",
    cycleId,
    spaceId,
    level: "team",
    ownerKind: "space",
    championId: ownerMemberId,
    reviewerId: ownerMemberId,
    weight: 1,
  })) as { id: string };
  goalId = goal.id;
  await indexEntity("goal", goalId);
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("full-text retrieval, which is the degradation the row asks for", () => {
  it("answers without pgvector", async () => {
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ present: boolean }>(
      "select exists (select 1 from pg_extension where extname = 'vector') as present",
    );
    // Stated so the run says which path it proved. With the extension present
    // this file exercises the hybrid path instead, and both are meant to answer.
    expect(typeof rows[0]?.present).toBe("boolean");

    const hits = await retrieve("mid-market platform", ownerMemberId);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.entityType).toBe("goal");
    expect(hits[0]?.entityId).toBe(goalId);
    expect(hits[0]?.content).toContain("mid-market");
  });

  it("ranks a whole sentence rather than requiring every word of it", async () => {
    // The defect the copilot found (P4-T14a-a). `plainto_tsquery` joins terms
    // with `&`, so this question matched nothing: no goal contains the word
    // "happening". A question is a sentence, and every retrieval caller from
    // here on passes one.
    const hits = await retrieve(
      "What is happening with mid-market activation?",
      ownerMemberId,
    );
    expect(hits.map((hit) => hit.entityId)).toEqual([goalId]);
  });

  it("prefers the passage that matches more of the question", async () => {
    const other = (await call("goals.create", {
      title: "Cut onboarding to two days",
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: ownerMemberId,
      reviewerId: ownerMemberId,
      weight: 1,
    })) as { id: string };
    await indexEntity("goal", other.id);

    // Both passages hold "days" or "market"; only one holds both halves of the
    // question. Ranking is what any-term matching leans on, so it is asserted.
    const hits = await retrieve(
      "mid-market platform onboarding",
      ownerMemberId,
    );
    expect(hits.length).toBeGreaterThan(1);
    expect(hits[0]?.entityId).toBe(goalId);
  });

  it("returns nothing for a question made only of stop words", async () => {
    // An empty tsquery, which matches nothing. The right answer to a question
    // with no content in it, and the one case any-term matching must not widen.
    expect(await retrieve("what is it about", ownerMemberId)).toHaveLength(0);
  });

  it("returns nothing for a query that matches nothing", async () => {
    expect(await retrieve("submarine cartography", ownerMemberId)).toHaveLength(
      0,
    );
  });

  it("respects the limit", async () => {
    for (const title of [
      "Raise mid-market activation to sixty per cent",
      "Cut mid-market onboarding to two days",
    ]) {
      const extra = (await call("goals.create", {
        title,
        cycleId,
        spaceId,
        level: "team",
        ownerKind: "space",
        championId: ownerMemberId,
        reviewerId: ownerMemberId,
        weight: 1,
      })) as { id: string };
      await indexEntity("goal", extra.id);
    }

    expect(await retrieve("mid-market", ownerMemberId, 2)).toHaveLength(2);
  });
});

describe("retrieval never returns a chunk the requester cannot read", () => {
  it("gives an active member of the room the goal's chunk", async () => {
    const hits = await retrieve("mid-market", readerMemberId);
    expect(hits.map((hit) => hit.entityId)).toEqual([goalId]);
  });

  it("gives a suspended member nothing, even though the chunk is indexed", async () => {
    const wb = await workerDb();
    // The chunk is there and the query matches it. What changes is only whether
    // this reader may see the goal it belongs to.
    const beforeSuspension = await retrieve("mid-market", readerMemberId);
    expect(beforeSuspension).toHaveLength(1);

    await wb.admin.query(
      "update workspace_members set status = 'suspended' where id = $1",
      [readerMemberId],
    );

    expect(await retrieve("mid-market", readerMemberId)).toHaveLength(0);
    // And the index is untouched: this is a read-time decision, not a reindex.
    const { rows } = await wb.admin.query<{ count: string }>(
      "select count(*) from embeddings where entity_id = $1",
      [goalId],
    );
    expect(rows[0]?.count).toBe("1");
  });

  it("withholds a chunk whose entity has been deleted since it was indexed", async () => {
    const wb = await workerDb();
    // Soft-deleted rather than removed, which is this repository's default. The
    // chunk survives; the thing it describes does not.
    await wb.admin.query("update goals set deleted_at = now() where id = $1", [
      goalId,
    ]);

    // An entity with no governing resource has no access to inherit, and
    // returning its chunk would let the index outlive what it describes.
    expect(await retrieve("mid-market", ownerMemberId)).toHaveLength(0);
  });

  it("filters session content by the space the review belonged to", async () => {
    const wb = await workerDb();
    const session = (await call("sessions.create", {
      spaceId,
      cycleId,
      kind: "quarterly",
      title: "Q1 review",
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
      facilitatorId: ownerMemberId,
    })) as { id: string };
    await call("sessions.open", { id: session.id });
    const note = (await call("sessions.addRetroNote", {
      sessionId: session.id,
      columnKey: "didnt",
      text: "The submarine dependency surfaced in week nine.",
      anonymous: false,
    })) as { id: string };
    await indexEntity("retro_note", note.id);

    // A retro note's own row names no space. Its access comes through the
    // session, which is why `governingResource` walks that way.
    expect(
      (await retrieve("submarine dependency", readerMemberId)).map(
        (hit) => hit.entityId,
      ),
    ).toEqual([note.id]);

    await wb.admin.query(
      "update workspace_members set status = 'suspended' where id = $1",
      [readerMemberId],
    );
    expect(await retrieve("submarine dependency", readerMemberId)).toHaveLength(
      0,
    );
  });
});
