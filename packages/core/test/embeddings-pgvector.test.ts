/**
 * Retrieval where vectors can and cannot be compared (plan 0.8.0 H5,
 * docs/design/pgvector-migration.md §3.4 and §4).
 *
 * Two faults sat beside 0031's. `hasPgvector()` asked for the extension and
 * not the column, so an instance whose column stayed text and gained the
 * extension later took the vector path and raised on `text <=> vector`. And
 * the vector query compared chunks of every size, so after the embedding
 * model changed pgvector raised "different vector dimensions".
 *
 * The first test runs on any stack. The others need the column to be a
 * vector, which only CI's pgvector leg gives (`TEST_PGVECTOR=1`, where a
 * missing extension fails rather than skips); elsewhere they skip and say so.
 */
import { testDbEnv, workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { EmbeddingService } from "../src/embeddings/service.ts";
import { runEmbedJob } from "../src/embeddings/worker.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const OWNER = "pgvector-owner";

let workspaceId: string;
let ownerMemberId: string;
let cycleId: string;
let spaceId: string;
/** What the model was asked to embed, in order. */
let asked: string[];

/** A model whose vectors have `size` numbers, the same for every text. */
const modelOfSize = (size: number) => async (inputs: readonly string[]) => {
  asked.push(...inputs);
  return {
    vectors: inputs.map(() =>
      Array.from({ length: size }, (_, index) => (index + 1) / 10),
    ),
    dimensions: size,
    model: `test-embed-${size}`,
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

const goal = async (title: string): Promise<string> =>
  (
    (await call("goals.create", {
      title,
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: ownerMemberId,
      reviewerId: ownerMemberId,
      weight: 1,
    })) as { id: string }
  ).id;

/** The embedding column's type in this worker's database. */
const columnType = async (): Promise<string | undefined> => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ type: string }>(
    `select format_type(atttypid, atttypmod) as type from pg_attribute
      where attrelid = 'embeddings'::regclass and attname = 'embedding'`,
  );
  return rows[0]?.type;
};

/** Skips a test that needs a vector column, unless the leg says it must be one. */
const needsVectorColumn = async (skip: () => void): Promise<void> => {
  if ((await columnType()) === "vector") {
    return;
  }
  if (testDbEnv.pgvector) {
    throw new Error(
      "TEST_PGVECTOR=1, but embeddings.embedding is not a vector here.",
    );
  }
  skip();
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  asked = [];
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, 'Owner', $2)",
    [OWNER, `${OWNER}@example.com`],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
  const spaces = (await call("spaces.list", {})) as { id: string }[];
  spaceId = spaces[0]?.id as string;
  cycleId = (
    (await call("cycles.current", { mode: "quarterly" })) as {
      id: string;
    }
  ).id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("which path retrieval takes", () => {
  it("keeps to full text while the column is text, whatever the extension, and raises nothing", async () => {
    const wb = await workerDb();
    // On the pgvector leg this is an instance that applied 0031 without the
    // extension and gained it later; elsewhere the column is text already.
    const wasVector = (await columnType()) === "vector";
    if (wasVector) {
      await wb.admin.query(
        "alter table embeddings alter column embedding type text",
      );
    }
    try {
      const embed = modelOfSize(3);
      const service = new EmbeddingService(wb.appPool, embed);
      expect(await service.hasPgvector()).toBe(false);

      const id = await goal("Grow mid-market revenue");
      await runEmbedJob(
        { workspaceId, entityType: "goal", entityId: id },
        { pool: wb.appPool, embed },
      );
      const hits = await service.retrieve({
        workspaceId,
        memberId: ownerMemberId,
        query: "mid-market",
      });

      expect(hits.map((hit) => hit.entityId)).toEqual([id]);
      // Neither the chunk nor the question went to the model.
      expect(asked).toEqual([]);
    } finally {
      if (wasVector) {
        await wb.admin.query(
          "alter table embeddings alter column embedding type vector using embedding::vector",
        );
      }
    }
  });
});

describe("retrieval by vector", () => {
  it("finds a passage that shares no word with the question", async (context) => {
    await needsVectorColumn(() => context.skip());
    const wb = await workerDb();
    const embed = modelOfSize(3);
    const id = await goal("Grow mid-market revenue");
    await runEmbedJob(
      { workspaceId, entityType: "goal", entityId: id },
      { pool: wb.appPool, embed },
    );

    const service = new EmbeddingService(wb.appPool, embed);
    expect(await service.hasPgvector()).toBe(true);
    const hits = await service.retrieve({
      workspaceId,
      memberId: ownerMemberId,
      query: "quarterly hiring plan",
    });

    expect(hits.map((hit) => hit.entityId)).toEqual([id]);
    expect(asked).toContain("quarterly hiring plan");
  });

  it("compares only chunks of the question's size, so a model change raises nothing", async (context) => {
    await needsVectorColumn(() => context.skip());
    const wb = await workerDb();
    // Embedded under the old model, three numbers a vector.
    const older = await goal("Grow mid-market revenue");
    await runEmbedJob(
      { workspaceId, entityType: "goal", entityId: older },
      { pool: wb.appPool, embed: modelOfSize(3) },
    );
    // And one under the new model, two numbers a vector.
    const newer = await goal("Ship the onboarding redesign");
    await runEmbedJob(
      { workspaceId, entityType: "goal", entityId: newer },
      { pool: wb.appPool, embed: modelOfSize(2) },
    );

    const service = new EmbeddingService(wb.appPool, modelOfSize(2));
    const hits = await service.retrieve({
      workspaceId,
      memberId: ownerMemberId,
      query: "quarterly hiring plan",
    });

    // The older chunk is left out of the comparison rather than raising, and
    // the full-text half still finds it by its words.
    expect(hits.map((hit) => hit.entityId)).toEqual([newer]);
    const byWord = await service.retrieve({
      workspaceId,
      memberId: ownerMemberId,
      query: "mid-market",
    });
    expect(byWord.map((hit) => hit.entityId)).toContain(older);
  });
});
