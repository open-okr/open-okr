import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workerDb } from "@openokr/test-support/db";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { OffAIProvider } from "../src/drivers/ai/off.ts";
import { InProcessCache } from "../src/drivers/cache/in-process.ts";
import { PostgresCache } from "../src/drivers/cache/postgres.ts";
import { NoneChannel } from "../src/drivers/channel/none.ts";
import { ConsoleMailer } from "../src/drivers/mail/console.ts";
import { PostgresSearch } from "../src/drivers/search/postgres.ts";
import { LocalDiskStorage } from "../src/drivers/storage/local-disk.ts";
import { AIUnavailableError } from "../src/ports/ai.ts";
import { ObjectNotFoundError } from "../src/ports/storage.ts";

/**
 * Contract tests for the default drivers: the set a fresh install runs with,
 * where nothing has been configured. Every one of these must work with no
 * credentials, no cloud account and no network.
 */

const WORKSPACE = "66666666-6666-4666-8666-666666666666";
const OTHER_WORKSPACE = "77777777-7777-4777-8777-777777777777";

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("LocalDiskStorage", () => {
  let dir: string;
  let storage: LocalDiskStorage;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "openokr-storage-"));
    storage = new LocalDiskStorage({ root: dir, signingSecret: "test-secret" });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips a blob", async () => {
    const stored = await storage.put("w1/files/a.txt", Buffer.from("hello"), {
      contentType: "text/plain",
    });
    expect(stored).toMatchObject({ key: "w1/files/a.txt", size: 5 });
    expect((await storage.get("w1/files/a.txt")).toString()).toBe("hello");
  });

  it("reports a missing object rather than returning empty content", async () => {
    await expect(storage.get("w1/missing")).rejects.toBeInstanceOf(
      ObjectNotFoundError,
    );
  });

  it("deletes a blob, and deleting twice is not an error", async () => {
    await storage.put("w1/a", Buffer.from("x"));
    await storage.delete("w1/a");
    await expect(storage.delete("w1/a")).resolves.toBeUndefined();
    await expect(storage.get("w1/a")).rejects.toBeInstanceOf(
      ObjectNotFoundError,
    );
  });

  it("refuses a key that escapes the storage root", async () => {
    await expect(storage.put("../escape", Buffer.from("x"))).rejects.toThrow(
      /key/i,
    );
    await expect(storage.get("w1/../../etc/passwd")).rejects.toThrow(/key/i);
  });

  it("signs a URL that expires and cannot be tampered with", async () => {
    await storage.put("w1/a", Buffer.from("x"));
    const url = await storage.signedUrl("w1/a", 60);
    expect(url).toContain("w1/a");
    expect(storage.verifySignedUrl(url)).toBe(true);

    const tampered = url.replace("w1/a", "w1/b");
    expect(storage.verifySignedUrl(tampered)).toBe(false);
  });

  it("rejects a signed URL after it expires", async () => {
    vi.useFakeTimers();
    try {
      await storage.put("w1/a", Buffer.from("x"));
      const url = await storage.signedUrl("w1/a", 60);
      vi.advanceTimersByTime(61_000);
      expect(storage.verifySignedUrl(url)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ConsoleMailer", () => {
  it("returns a message id and records what it would have sent", async () => {
    const written: string[] = [];
    const mailer = new ConsoleMailer({ write: (line) => written.push(line) });

    const sent = await mailer.send({
      to: "person@example.com",
      subject: "Your weekly check-in is due",
      text: "Two key results have no update.",
    });

    expect(sent.messageId).toMatch(/.+/);
    expect(written.join("\n")).toContain("person@example.com");
    expect(written.join("\n")).toContain("Your weekly check-in is due");
  });

  it("keeps every sent message for assertions in tests", async () => {
    const mailer = new ConsoleMailer({ write: () => {} });
    await mailer.send({ to: "a@example.com", subject: "one", text: "1" });
    await mailer.send({ to: "b@example.com", subject: "two", text: "2" });
    expect(mailer.sent.map((message) => message.to)).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });
});

describe("InProcessCache", () => {
  it("stores, reads and deletes", async () => {
    const cache = new InProcessCache();
    expect(await cache.get("missing")).toBeUndefined();
    await cache.set("k", { a: 1 });
    expect(await cache.get("k")).toEqual({ a: 1 });
    await cache.delete("k");
    expect(await cache.get("k")).toBeUndefined();
  });

  it("expires an entry once its lifetime passes", async () => {
    vi.useFakeTimers();
    try {
      const cache = new InProcessCache();
      await cache.set("k", "v", 10);
      expect(await cache.get("k")).toBe("v");
      vi.advanceTimersByTime(11_000);
      expect(await cache.get("k")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("increments atomically from absent", async () => {
    const cache = new InProcessCache();
    expect(await cache.incr("hits")).toBe(1);
    expect(await cache.incr("hits", 5)).toBe(6);
  });

  it("allows a burst up to the limit, then refuses within the window", async () => {
    const cache = new InProcessCache();
    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(await cache.rateLimit("member:1", 3, 60));
    }
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[2]?.remaining).toBe(0);
    expect(results[3]?.resetSeconds).toBeGreaterThan(0);
  });

  it("never grows past its cap, even for keys that never come back (P2-T09)", async () => {
    // The unbounded-keyspace defect: a rate limit key per subject, most of
    // whom never return to have their expired entry swept. A tiny cap makes
    // the bound provable without inserting ten thousand real entries.
    const cache = new InProcessCache({ maxEntries: 5 });
    for (let i = 0; i < 50; i++) {
      await cache.rateLimit(`address:${i}`, 10, 60);
    }
    // Reach in through the public surface only: the most recent subjects are
    // still tracked (the eviction is FIFO, oldest first), the earliest ones
    // are not.
    expect((await cache.get("ratelimit:address:49")) as number).toBe(1);
    expect(await cache.get("ratelimit:address:0")).toBeUndefined();
  });
});

describe("PostgresCache", () => {
  beforeEach(async () => {
    const wb = await workerDb();
    await wb.truncateAllTables();
  });

  it("stores, reads and deletes across connections", async () => {
    const wb = await workerDb();
    const cache = new PostgresCache(wb.admin);
    expect(await cache.get("missing")).toBeUndefined();
    await cache.set("k", { a: 1 });
    expect(await cache.get("k")).toEqual({ a: 1 });
    await cache.delete("k");
    expect(await cache.get("k")).toBeUndefined();
  });

  it("overwrites an existing key rather than failing", async () => {
    const wb = await workerDb();
    const cache = new PostgresCache(wb.admin);
    await cache.set("k", "first");
    await cache.set("k", "second");
    expect(await cache.get("k")).toBe("second");
  });

  it("never serves an expired entry", async () => {
    const wb = await workerDb();
    const cache = new PostgresCache(wb.admin);
    await cache.set("k", "v", -1);
    expect(await cache.get("k")).toBeUndefined();
  });

  it("increments atomically", async () => {
    const wb = await workerDb();
    const cache = new PostgresCache(wb.admin);
    const values = await Promise.all(
      Array.from({ length: 10 }, () => cache.incr("counter")),
    );
    expect(values.sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  it("enforces a rate limit shared across processes", async () => {
    const wb = await workerDb();
    const cache = new PostgresCache(wb.admin);
    const other = new PostgresCache(wb.admin);

    expect((await cache.rateLimit("ip:1", 2, 60)).allowed).toBe(true);
    expect((await other.rateLimit("ip:1", 2, 60)).allowed).toBe(true);
    expect((await cache.rateLimit("ip:1", 2, 60)).allowed).toBe(false);
  });
});

describe("PostgresSearch", () => {
  beforeEach(async () => {
    const wb = await workerDb();
    await wb.truncateAllTables();
  });

  const seed = async () => {
    const wb = await workerDb();
    const search = new PostgresSearch(wb.admin);
    await search.index({
      workspaceId: WORKSPACE,
      entityType: "goal",
      entityId: "11111111-1111-4111-8111-111111111111",
      title: "Reduce onboarding time for new customers",
      body: "Customers reach first value faster",
    });
    await search.index({
      workspaceId: WORKSPACE,
      entityType: "kpi",
      entityId: "22222222-2222-4222-8222-222222222222",
      title: "Support ticket backlog",
    });
    await search.index({
      workspaceId: OTHER_WORKSPACE,
      entityType: "goal",
      entityId: "33333333-3333-4333-8333-333333333333",
      title: "Onboarding overhaul in another workspace",
    });
    return search;
  };

  it("finds a document by a word from its title", async () => {
    const search = await seed();
    const hits = await search.query({
      workspaceId: WORKSPACE,
      text: "onboarding",
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      entityType: "goal",
      title: "Reduce onboarding time for new customers",
    });
    expect(hits[0]?.rank).toBeGreaterThan(0);
  });

  it("never returns another workspace's documents", async () => {
    const search = await seed();
    const hits = await search.query({
      workspaceId: WORKSPACE,
      text: "overhaul",
    });
    expect(hits).toEqual([]);
  });

  it("matches stemmed words from the body", async () => {
    const search = await seed();
    const hits = await search.query({
      workspaceId: WORKSPACE,
      text: "customer",
    });
    expect(hits.length).toBeGreaterThan(0);
  });

  it("filters by entity type", async () => {
    const search = await seed();
    const hits = await search.query({
      workspaceId: WORKSPACE,
      text: "backlog",
      entityTypes: ["goal"],
    });
    expect(hits).toEqual([]);

    const kpis = await search.query({
      workspaceId: WORKSPACE,
      text: "backlog",
      entityTypes: ["kpi"],
    });
    expect(kpis).toHaveLength(1);
  });

  it("reindexes in place rather than duplicating a document", async () => {
    const wb = await workerDb();
    const search = await seed();
    await search.index({
      workspaceId: WORKSPACE,
      entityType: "goal",
      entityId: "11111111-1111-4111-8111-111111111111",
      title: "Retitled goal",
    });

    const rows = await wb.admin.query(
      "select count(*)::int as n from search_documents",
    );
    expect(rows.rows[0].n).toBe(3);
    const hits = await search.query({
      workspaceId: WORKSPACE,
      text: "retitled",
    });
    expect(hits).toHaveLength(1);
  });

  it("removes a document so a deleted subject stops appearing", async () => {
    const search = await seed();
    await search.remove(
      "goal",
      "11111111-1111-4111-8111-111111111111",
      WORKSPACE,
    );
    expect(
      await search.query({ workspaceId: WORKSPACE, text: "onboarding" }),
    ).toEqual([]);
  });

  it("returns nothing for an empty or punctuation-only query", async () => {
    const search = await seed();
    expect(await search.query({ workspaceId: WORKSPACE, text: "   " })).toEqual(
      [],
    );
    expect(await search.query({ workspaceId: WORKSPACE, text: "!!!" })).toEqual(
      [],
    );
  });

  it("treats user input as text, not as query syntax", async () => {
    const search = await seed();
    // A stray operator must not raise; it is someone typing, not a query DSL.
    await expect(
      search.query({ workspaceId: WORKSPACE, text: "onboarding & | ! <->" }),
    ).resolves.toBeInstanceOf(Array);
  });

  it("honours the limit", async () => {
    const search = await seed();
    const hits = await search.query({
      workspaceId: WORKSPACE,
      text: "onboarding or backlog",
      limit: 1,
    });
    expect(hits.length).toBeLessThanOrEqual(1);
  });
});

describe("OffAIProvider", () => {
  const ai = new OffAIProvider();

  it("reports every capability as unavailable", () => {
    const capabilities = ai.capabilities("any-model");
    expect(capabilities.available).toBe(false);
    expect(capabilities.tools).toBe(false);
    expect(capabilities.streaming).toBe(false);
  });

  it("refuses every call with a typed error", async () => {
    const request = {
      model: "m",
      messages: [{ role: "user" as const, content: "hi" }],
    };
    await expect(ai.chat(request)).rejects.toBeInstanceOf(AIUnavailableError);
    await expect(
      ai.chatWithTools({ ...request, tools: [] }),
    ).rejects.toBeInstanceOf(AIUnavailableError);
    await expect(ai.embed({ model: "m", input: ["a"] })).rejects.toBeInstanceOf(
      AIUnavailableError,
    );
    await expect(ai.extract({ ...request, schema: {} })).rejects.toBeInstanceOf(
      AIUnavailableError,
    );
  });

  it("refuses to stream", async () => {
    await expect(async () => {
      for await (const _chunk of new OffAIProvider().stream({
        model: "m",
        messages: [],
      })) {
        // Never reached.
      }
    }).rejects.toBeInstanceOf(AIUnavailableError);
  });
});

describe("NoneChannel", () => {
  const channel = new NoneChannel();

  it("suppresses rather than fails, with a reason", async () => {
    const result = await channel.send({ memberId: "m1" }, { text: "hello" });
    expect(result.delivered).toBe(false);
    expect(result.suppressedReason).toMatch(/no channel/i);
  });

  it("reports no capabilities at all", () => {
    expect(channel.capabilities()).toMatchObject({
      outbound: false,
      inbound: false,
      buttons: false,
    });
  });

  it("never verifies an inbound payload", async () => {
    expect(await channel.verifyInbound({ headers: {}, rawBody: "{}" })).toBe(
      false,
    );
    expect(await channel.parseInbound("{}")).toBeNull();
  });
});
