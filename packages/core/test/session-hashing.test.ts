import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  hashSessionToken,
  withHashedSessionTokens,
} from "../src/auth/session-hashing.ts";

/**
 * The session-token hashing wrapper (TECHNICAL-PLAN §8.2, "tokens hashed at
 * rest"). Better Auth generates a token, hands it to the browser in a cookie
 * and stores it; this wrapper makes sure what reaches the database is only
 * ever the SHA-256 of it.
 *
 * The wrapper has to be symmetric: hash on the way in, hash the predicate on
 * lookup. It also has to be idempotent, because Better Auth reads a session
 * row back (whose token column now holds the hash) and re-queries with it.
 * Raw tokens are 32 characters of [a-zA-Z0-9] and a hash is 64 of [0-9a-f],
 * so the two can never be confused.
 */

const RAW_TOKEN = "aB3xY7zQ1mN4pR8sT2vW5yZ0cD6fH9jK";
const HASHED = createHash("sha256").update(RAW_TOKEN).digest("hex");

// The adapter surface is deliberately loose in the wrapper (see the note in
// session-hashing.ts), so the stand-in matches that shape.
// biome-ignore lint/suspicious/noExplicitAny: mirrors the adapter contract.
type SpyMethod = (query: any) => Promise<any>;

interface SpyAdapter {
  id: string;
  create: SpyMethod;
  findOne: SpyMethod;
  findMany: SpyMethod;
  update: SpyMethod;
  updateMany: SpyMethod;
  delete: SpyMethod;
  deleteMany: SpyMethod;
  count: SpyMethod;
  options: Record<string, unknown>;
  transaction?: unknown;
  [key: string]: unknown;
}

/** A stand-in adapter that records what it was asked to do. */
const spyAdapter = (): {
  calls: { method: string; argument: unknown }[];
  adapter: SpyAdapter;
} => {
  const calls: { method: string; argument: unknown }[] = [];
  const record = (method: string) => (argument: unknown) => {
    calls.push({ method, argument });
    return Promise.resolve(
      method === "findMany" ? [] : method === "count" ? 0 : { id: "row" },
    );
  };
  return {
    calls,
    adapter: {
      id: "spy",
      create: vi.fn(record("create")),
      findOne: vi.fn(record("findOne")),
      findMany: vi.fn(record("findMany")),
      update: vi.fn(record("update")),
      updateMany: vi.fn(record("updateMany")),
      delete: vi.fn(record("delete")),
      deleteMany: vi.fn(record("deleteMany")),
      count: vi.fn(record("count")),
      options: {},
    },
  };
};

describe("hashSessionToken", () => {
  it("is SHA-256 hex of the token", () => {
    expect(hashSessionToken(RAW_TOKEN)).toBe(HASHED);
    expect(hashSessionToken(RAW_TOKEN)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("passes an already-hashed value through unchanged", () => {
    expect(hashSessionToken(HASHED)).toBe(HASHED);
  });
});

describe("withHashedSessionTokens", () => {
  it("stores the hash, never the token Better Auth generated", async () => {
    const { adapter, calls } = spyAdapter();
    const wrapped = withHashedSessionTokens(adapter);

    await wrapped.create({
      model: "session",
      data: { id: "s1", token: RAW_TOKEN, userId: "u1" },
    });

    const stored = calls[0]?.argument as { data: { token: string } };
    expect(stored.data.token).toBe(HASHED);
    expect(JSON.stringify(calls)).not.toContain(RAW_TOKEN);
  });

  it("returns the raw token to the caller, so the cookie stays usable", async () => {
    const { adapter } = spyAdapter();
    adapter.create = vi.fn(
      async ({ data }: { data: Record<string, unknown> }) => data,
    );
    const wrapped = withHashedSessionTokens(adapter);

    const created = (await wrapped.create({
      model: "session",
      data: { id: "s1", token: RAW_TOKEN, userId: "u1" },
    })) as unknown as { token: string };

    expect(created.token).toBe(RAW_TOKEN);
  });

  it("hashes the predicate when a session is looked up by token", async () => {
    const { adapter, calls } = spyAdapter();
    const wrapped = withHashedSessionTokens(adapter);

    await wrapped.findOne({
      model: "session",
      where: [{ field: "token", value: RAW_TOKEN }],
    });

    const query = calls[0]?.argument as { where: { value: string }[] };
    expect(query.where[0]?.value).toBe(HASHED);
  });

  it("hashes the predicate on update, delete and their bulk forms", async () => {
    const { adapter, calls } = spyAdapter();
    const wrapped = withHashedSessionTokens(adapter);
    const where = [{ field: "token", value: RAW_TOKEN }];

    await wrapped.update({
      model: "session",
      where,
      update: { ipAddress: "127.0.0.1" },
    });
    await wrapped.updateMany({ model: "session", where, update: {} });
    await wrapped.delete({ model: "session", where });
    await wrapped.deleteMany({ model: "session", where });
    await wrapped.findMany({ model: "session", where });
    await wrapped.count({ model: "session", where });

    for (const call of calls) {
      const query = call.argument as { where: { value: string }[] };
      expect(query.where[0]?.value).toBe(HASHED);
    }
  });

  it("is idempotent, so a token read back and re-queried still matches", async () => {
    const { adapter, calls } = spyAdapter();
    const wrapped = withHashedSessionTokens(adapter);

    // Better Auth reads a session row (token column holds the hash) and then
    // re-queries with that value. Hashing it twice would never match.
    await wrapped.findOne({
      model: "session",
      where: [{ field: "token", value: HASHED }],
    });

    const query = calls[0]?.argument as { where: { value: string }[] };
    expect(query.where[0]?.value).toBe(HASHED);
  });

  it("leaves every other model alone", async () => {
    const { adapter, calls } = spyAdapter();
    const wrapped = withHashedSessionTokens(adapter);

    await wrapped.create({
      model: "verification",
      data: { id: "v1", value: RAW_TOKEN, identifier: "reset" },
    });
    await wrapped.findOne({
      model: "user",
      where: [{ field: "token", value: RAW_TOKEN }],
    });

    for (const call of calls) {
      expect(JSON.stringify(call.argument)).toContain(RAW_TOKEN);
    }
  });

  it("leaves other fields of the session model alone", async () => {
    const { adapter, calls } = spyAdapter();
    const wrapped = withHashedSessionTokens(adapter);

    await wrapped.findOne({
      model: "session",
      where: [{ field: "userId", value: "u1" }],
    });

    const query = calls[0]?.argument as { where: { value: string }[] };
    expect(query.where[0]?.value).toBe("u1");
  });

  it("hashes inside a transaction too", async () => {
    // Better Auth creates sessions inside a transaction, and the handle it
    // hands the callback comes from the adapter underneath. Unwrapped, that
    // is a way into the session table that stores raw tokens, which is
    // exactly the bug this test exists to keep fixed.
    const inner = spyAdapter();
    const outer = {
      ...inner.adapter,
      transaction: async (
        callback: (trx: typeof inner.adapter) => Promise<unknown>,
      ) => callback(inner.adapter),
    };

    const wrapped = withHashedSessionTokens(outer);
    await (
      wrapped.transaction as (
        callback: (trx: typeof inner.adapter) => Promise<unknown>,
      ) => Promise<unknown>
    )(async (trx) =>
      trx.create({
        model: "session",
        data: { id: "s1", token: RAW_TOKEN, userId: "u1" },
      }),
    );

    const stored = inner.calls[0]?.argument as { data: { token: string } };
    expect(stored.data.token).toBe(HASHED);
  });

  it("leaves an adapter without transactions alone", () => {
    const { adapter } = spyAdapter();
    const wrapped = withHashedSessionTokens(adapter);
    expect(wrapped.transaction).toBeUndefined();
  });

  it("keeps the adapter's other properties reachable", () => {
    const { adapter } = spyAdapter();
    const wrapped = withHashedSessionTokens(adapter);
    expect(wrapped.id).toBe("spy");
    expect(wrapped.options).toEqual({});
  });
});
