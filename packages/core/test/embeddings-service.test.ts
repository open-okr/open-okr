/**
 * EmbeddingService integration tests (AI-NATIVE-PLAN.md §9, P4-T13).
 *
 * Tests run against a real database. The RLS policy on the embeddings table
 * means these are the only tests that can prove workspace scoping works:
 * mocks do not exercise the policy.
 *
 * All retrieve tests use the full-text fallback, because pgvector may not be
 * installed on every developer machine and is not in the CI container. The
 * vector path is structurally the same (both now go through `withWorkspace`),
 * so the full-text tests cover the scoping invariant for both.
 */
import { embeddings, withWorkspace } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { EmbeddingService } from "../src/embeddings/service.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const USER = "embedding-test-user";
const OTHER_USER = "embedding-test-other-user";

let workspaceId: string;
let otherWorkspaceId: string;

async function countChunks(
  entityType: string,
  entityId: string,
): Promise<number> {
  const wb = await workerDb();
  return withWorkspace(drizzle(wb.appPool), workspaceId, async (tx) => {
    const result = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(embeddings)
      .where(
        and(
          eq(embeddings.workspaceId, workspaceId),
          eq(embeddings.entityType, entityType),
          eq(embeddings.entityId, entityId),
        ),
      );
    return result[0]?.count ?? 0;
  });
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();

  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [
      USER,
      "Embedding Tester",
      "embedding@example.com",
      OTHER_USER,
      "Other Tester",
      "embedding-other@example.com",
    ],
  );

  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: USER,
    name: "Embedding Tester",
  });
  workspaceId = provisioned.workspaceId;

  // A genuinely distinct second workspace (different user) so workspace
  // scoping tests have somewhere to send the wrong query.
  const other = await provisionWorkspaceForUser(wb.appPool, {
    id: OTHER_USER,
    name: "Other Tester",
  });
  otherWorkspaceId = other.workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("EmbeddingService.index()", () => {
  it("stores one chunk for a short document", async () => {
    const wb = await workerDb();
    const service = new EmbeddingService(wb.appPool, null);

    await service.index({
      workspaceId,
      entityType: "goal",
      entityId: "00000000-0000-0000-0000-000000000001",
      content: "Grow monthly active users by 20 percent this quarter",
    });

    const count = await countChunks(
      "goal",
      "00000000-0000-0000-0000-000000000001",
    );
    expect(count).toBe(1);
  });

  it("stores multiple chunks for a long document", async () => {
    const wb = await workerDb();
    // Small chunk size so the test does not depend on real-world text length.
    const service = new EmbeddingService(wb.appPool, null, {
      maxChunkSize: 100,
      overlap: 20,
    });

    const longContent = "word ".repeat(60).trim(); // ~300 chars
    await service.index({
      workspaceId,
      entityType: "goal",
      entityId: "00000000-0000-0000-0000-000000000002",
      content: longContent,
    });

    const count = await countChunks(
      "goal",
      "00000000-0000-0000-0000-000000000002",
    );
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("skips rows when the content hash is unchanged", async () => {
    const wb = await workerDb();
    const service = new EmbeddingService(wb.appPool, null);
    const entityId = "00000000-0000-0000-0000-000000000003";
    const content = "Increase net promoter score above 50";

    await service.index({ workspaceId, entityType: "goal", entityId, content });
    await service.index({ workspaceId, entityType: "goal", entityId, content });

    // One row, not two: the second call is a no-op because the hash matches.
    const count = await countChunks("goal", entityId);
    expect(count).toBe(1);
  });

  it("replaces stale chunks when content changes", async () => {
    const wb = await workerDb();
    const service = new EmbeddingService(wb.appPool, null, {
      maxChunkSize: 100,
      overlap: 20,
    });
    const entityId = "00000000-0000-0000-0000-000000000004";

    await service.index({
      workspaceId,
      entityType: "goal",
      entityId,
      content: "word ".repeat(60).trim(), // multiple chunks
    });
    const countBefore = await countChunks("goal", entityId);

    await service.index({
      workspaceId,
      entityType: "goal",
      entityId,
      content: "Short updated objective title", // one chunk
    });
    const countAfter = await countChunks("goal", entityId);

    expect(countBefore).toBeGreaterThanOrEqual(2);
    expect(countAfter).toBe(1);
  });

  it("removes trailing chunks when content shrinks", async () => {
    const wb = await workerDb();
    const service = new EmbeddingService(wb.appPool, null, {
      maxChunkSize: 100,
      overlap: 20,
    });
    const entityId = "00000000-0000-0000-0000-000000000005";

    await service.index({
      workspaceId,
      entityType: "goal",
      entityId,
      content: "word ".repeat(60).trim(),
    });
    const countBefore = await countChunks("goal", entityId);

    await service.index({
      workspaceId,
      entityType: "goal",
      entityId,
      content: "Reduce infrastructure spend by fifteen percent",
    });
    const countAfter = await countChunks("goal", entityId);

    expect(countBefore).toBeGreaterThan(countAfter);
    expect(countAfter).toBe(1);
  });
});

describe("EmbeddingService.remove()", () => {
  it("deletes all chunks for an entity", async () => {
    const wb = await workerDb();
    const service = new EmbeddingService(wb.appPool, null, {
      maxChunkSize: 100,
      overlap: 20,
    });
    const entityId = "00000000-0000-0000-0000-000000000006";

    await service.index({
      workspaceId,
      entityType: "goal",
      entityId,
      content: "word ".repeat(60).trim(),
    });

    await service.remove(workspaceId, "goal", entityId);

    const count = await countChunks("goal", entityId);
    expect(count).toBe(0);
  });

  it("does not remove chunks for other entities in the same workspace", async () => {
    const wb = await workerDb();
    const service = new EmbeddingService(wb.appPool, null);
    const entityA = "00000000-0000-0000-0000-000000000007";
    const entityB = "00000000-0000-0000-0000-000000000008";

    await service.index({
      workspaceId,
      entityType: "goal",
      entityId: entityA,
      content: "Retain enterprise customers at 95 percent",
    });
    await service.index({
      workspaceId,
      entityType: "goal",
      entityId: entityB,
      content: "Expand into the APAC market this year",
    });

    await service.remove(workspaceId, "goal", entityA);

    expect(await countChunks("goal", entityA)).toBe(0);
    expect(await countChunks("goal", entityB)).toBe(1);
  });
});

describe("EmbeddingService.retrieve() — full-text fallback", () => {
  it("returns a hit for matching content", async () => {
    const wb = await workerDb();
    const service = new EmbeddingService(wb.appPool, null);
    const entityId = "00000000-0000-0000-0000-000000000009";

    await service.index({
      workspaceId,
      entityType: "goal",
      entityId,
      content: "Improve customer satisfaction scores across support channels",
    });

    const hits = await service.retrieve({
      workspaceId,
      query: "customer satisfaction",
    });

    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.some((h) => h.entityId === entityId)).toBe(true);
  });

  it("returns nothing for a non-matching query", async () => {
    const wb = await workerDb();
    const service = new EmbeddingService(wb.appPool, null);

    await service.index({
      workspaceId,
      entityType: "goal",
      entityId: "00000000-0000-0000-0000-00000000000a",
      content: "Launch the new onboarding flow in Q2",
    });

    const hits = await service.retrieve({
      workspaceId,
      query: "xyzzy fluorescent giraffe",
    });

    expect(hits).toHaveLength(0);
  });

  it("returns nothing for the wrong workspaceId — workspace scoping enforced by RLS", async () => {
    const wb = await workerDb();
    const service = new EmbeddingService(wb.appPool, null);

    // Index into the primary workspace.
    await service.index({
      workspaceId,
      entityType: "goal",
      entityId: "00000000-0000-0000-0000-00000000000b",
      content: "Drive platform adoption among mid-market accounts",
    });

    // Query from the other workspace — must return nothing.
    const hits = await service.retrieve({
      workspaceId: otherWorkspaceId,
      query: "platform adoption mid-market",
    });

    expect(hits).toHaveLength(0);
  });

  it("respects the entityTypes filter", async () => {
    const wb = await workerDb();
    const service = new EmbeddingService(wb.appPool, null);
    const goalId = "00000000-0000-0000-0000-00000000000c";
    const krId = "00000000-0000-0000-0000-00000000000d";

    await service.index({
      workspaceId,
      entityType: "goal",
      entityId: goalId,
      content: "Reduce churn below five percent annually",
    });
    await service.index({
      workspaceId,
      entityType: "key_result",
      entityId: krId,
      content: "Churn rate measured monthly by the data team",
    });

    const hits = await service.retrieve({
      workspaceId,
      query: "churn",
      entityTypes: ["key_result"],
    });

    expect(hits.every((h) => h.entityType === "key_result")).toBe(true);
    expect(hits.some((h) => h.entityType === "goal")).toBe(false);
  });

  it("returns entity refs, not direct access decisions", async () => {
    // The service hands back entityType + entityId. The caller (copilot, P4-T14)
    // is responsible for reloading each hit through the access-aware getter.
    // This test verifies the shape, not the filtering — that invariant is
    // enforced at the caller.
    const wb = await workerDb();
    const service = new EmbeddingService(wb.appPool, null);
    const entityId = "00000000-0000-0000-0000-00000000000e";

    await service.index({
      workspaceId,
      entityType: "goal",
      entityId,
      content: "Achieve carbon neutrality across all operations by year end",
    });

    const hits = await service.retrieve({
      workspaceId,
      query: "carbon neutrality operations",
    });

    const hit = hits.find((h) => h.entityId === entityId);
    expect(hit).toBeDefined();
    expect(hit?.entityType).toBe("goal");
    expect(typeof hit?.score).toBe("number");
    expect(typeof hit?.content).toBe("string");
  });
});
