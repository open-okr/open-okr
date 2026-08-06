import { describe, expect, it } from "vitest";
import {
  type AuditRow,
  auditRowHash,
  canonicalJson,
  GENESIS_HASH,
  verifyChain,
} from "../src/audit/chain.ts";

/**
 * The audit hash chain (TECHNICAL-PLAN §8.2).
 *
 * Each row commits to the one before it, so a row cannot be altered, removed
 * or inserted after the fact without breaking every hash that follows. These
 * tests are pure: they prove the hashing and the verification, and the
 * database-level guarantees are proved in operation-pipeline.test.ts.
 */

const row = (overrides: Partial<AuditRow> = {}): AuditRow => ({
  workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  seq: 1,
  actorMemberId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  actorKind: "human",
  action: "workspace.rename",
  targetType: "workspace",
  targetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  payload: { from: "Old", to: "New" },
  at: new Date("2026-08-06T10:00:00.000Z"),
  prevHash: GENESIS_HASH,
  ...overrides,
});

describe("canonicalJson", () => {
  it("orders keys, so the same facts always hash the same", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it("orders nested keys too", () => {
    expect(canonicalJson({ x: { b: 1, a: 2 } })).toBe('{"x":{"a":2,"b":1}}');
  });

  it("keeps array order, which is meaningful", () => {
    expect(canonicalJson([2, 1])).toBe("[2,1]");
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it("does not confuse a null with a missing key", () => {
    expect(canonicalJson({ a: null })).not.toBe(canonicalJson({}));
  });

  it("distinguishes a number from its string", () => {
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: "1" }));
  });
});

describe("auditRowHash", () => {
  it("is a sha256 digest", () => {
    expect(auditRowHash(row())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable for the same row", () => {
    expect(auditRowHash(row())).toBe(auditRowHash(row()));
  });

  it("changes when any field changes", () => {
    const base = auditRowHash(row());
    expect(auditRowHash(row({ action: "workspace.archive" }))).not.toBe(base);
    expect(auditRowHash(row({ actorKind: "agent" }))).not.toBe(base);
    expect(
      auditRowHash(row({ payload: { from: "Old", to: "Other" } })),
    ).not.toBe(base);
    expect(
      auditRowHash(row({ at: new Date("2026-08-06T10:00:01Z") })),
    ).not.toBe(base);
    expect(auditRowHash(row({ seq: 2 }))).not.toBe(base);
  });

  it("changes when the previous hash changes, which is what chains it", () => {
    expect(auditRowHash(row({ prevHash: "f".repeat(64) }))).not.toBe(
      auditRowHash(row()),
    );
  });

  it("is unaffected by the order the payload's keys were written in", () => {
    expect(auditRowHash(row({ payload: { to: "New", from: "Old" } }))).toBe(
      auditRowHash(row({ payload: { from: "Old", to: "New" } })),
    );
  });
});

describe("verifyChain", () => {
  /** A valid chain of `count` rows. */
  const chain = (count: number): (AuditRow & { rowHash: string })[] => {
    const rows: (AuditRow & { rowHash: string })[] = [];
    let prevHash = GENESIS_HASH;
    for (let seq = 1; seq <= count; seq++) {
      const next = row({ seq, prevHash, action: `action.${seq}` });
      const rowHash = auditRowHash(next);
      rows.push({ ...next, rowHash });
      prevHash = rowHash;
    }
    return rows;
  };

  it("accepts an intact chain", () => {
    expect(verifyChain(chain(5))).toEqual({ ok: true, checked: 5 });
  });

  it("accepts an empty chain, which a new workspace has", () => {
    expect(verifyChain([])).toEqual({ ok: true, checked: 0 });
  });

  it("rejects a chain whose first row does not start from genesis", () => {
    const rows = chain(3);
    const [first] = rows;
    if (!first) {
      throw new Error("unreachable");
    }
    rows[0] = { ...first, prevHash: "a".repeat(64) };
    expect(verifyChain(rows)).toMatchObject({ ok: false, brokenAtSeq: 1 });
  });

  it("detects an edited payload", () => {
    // The whole point: changing history has to be visible.
    const rows = chain(5);
    const target = rows[2];
    if (!target) {
      throw new Error("unreachable");
    }
    rows[2] = { ...target, payload: { from: "Old", to: "Tampered" } };
    expect(verifyChain(rows)).toMatchObject({ ok: false, brokenAtSeq: 3 });
  });

  it("detects a row rewritten together with its own hash", () => {
    // A careful attacker recomputes the row's hash. That still breaks the
    // next row, which committed to the old one.
    const rows = chain(5);
    const target = rows[2];
    if (!target) {
      throw new Error("unreachable");
    }
    const edited = { ...target, payload: { from: "Old", to: "Tampered" } };
    rows[2] = { ...edited, rowHash: auditRowHash(edited) };
    expect(verifyChain(rows)).toMatchObject({ ok: false, brokenAtSeq: 4 });
  });

  it("detects a removed row", () => {
    const rows = chain(5);
    rows.splice(2, 1);
    expect(verifyChain(rows)).toMatchObject({ ok: false });
  });

  it("detects a deletion even when the whole tail was rebuilt around it", () => {
    // The thorough attacker: delete a row, then recompute every hash after it
    // so the chain is internally consistent. The sequence numbers still have a
    // hole, which is why verification checks contiguity and not only hashes.
    const original = chain(5);
    const kept = original.filter((entry) => entry.seq !== 3);

    let prevHash = GENESIS_HASH;
    const rebuilt = kept.map((entry) => {
      const next = { ...entry, prevHash };
      const rowHash = auditRowHash(next);
      prevHash = rowHash;
      return { ...next, rowHash };
    });

    expect(verifyChain(rebuilt)).toMatchObject({ ok: false });
  });
});
