import { describe, expect, it } from "vitest";
import { idTimestamp, newId } from "../src/id.ts";

/** Time-ordered primary keys (TECHNICAL-PLAN §3). */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("newId", () => {
  it("looks like a UUID", () => {
    expect(newId()).toMatch(UUID);
  });

  it("declares version 7 and the RFC variant", () => {
    for (let i = 0; i < 200; i++) {
      const id = newId();
      expect(id[14], `version nibble of ${id}`).toBe("7");
      expect("89ab", `variant nibble of ${id}`).toContain(id[19] as string);
    }
  });

  it("is unique across a tight loop", () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => newId()));
    expect(ids.size).toBe(10_000);
  });

  it("carries the current time in its first 48 bits", () => {
    const before = Date.now();
    const id = newId();
    const after = Date.now();
    expect(idTimestamp(id)).toBeGreaterThanOrEqual(before);
    expect(idTimestamp(id)).toBeLessThanOrEqual(after);
  });

  it("sorts in generation order across milliseconds, which is the point", async () => {
    const first = newId();
    await new Promise((resolve) => setTimeout(resolve, 3));
    const second = newId();
    await new Promise((resolve) => setTimeout(resolve, 3));
    const third = newId();

    expect([third, first, second].sort()).toEqual([first, second, third]);
  });
});

/**
 * Minting an id at a stated millisecond (P7-T01a).
 *
 * The performance dataset needs a workspace whose rows were written over
 * months, because that is what the index locality this key exists for is
 * measured against. A million ids all stamped `Date.now()` share one
 * timestamp prefix and land in one region of the B-tree, which is the
 * opposite of the shape production has and would make every number the
 * budget harness reports optimistic.
 *
 * A parameter rather than a second generator: two implementations of the
 * same bit layout is how the seeded data stops matching what the product
 * writes.
 */
describe("newId at a stated time", () => {
  it("carries the millisecond it was given", () => {
    const when = Date.UTC(2026, 0, 15, 9, 30, 0);
    expect(idTimestamp(newId(when))).toBe(when);
  });

  it("still declares version 7 and the RFC variant", () => {
    const when = Date.UTC(2025, 5, 1);
    for (let i = 0; i < 200; i++) {
      const id = newId(when + i);
      expect(id[14], `version nibble of ${id}`).toBe("7");
      expect("89ab", `variant nibble of ${id}`).toContain(id[19] as string);
    }
  });

  it("sorts by the time it was given, not the time it was called", () => {
    const day = 24 * 60 * 60 * 1000;
    const base = Date.UTC(2026, 0, 1);
    // Minted newest first, so an implementation that ignored the argument
    // would produce the reverse of what this asserts.
    const third = newId(base + 2 * day);
    const second = newId(base + day);
    const first = newId(base);

    expect([third, first, second].sort()).toEqual([first, second, third]);
  });

  it("is still unique when a whole batch shares one millisecond", () => {
    const when = Date.UTC(2026, 2, 3);
    const ids = new Set(Array.from({ length: 10_000 }, () => newId(when)));
    expect(ids.size).toBe(10_000);
  });

  it("defaults to now, so every existing caller is unchanged", () => {
    const before = Date.now();
    const id = newId();
    const after = Date.now();
    expect(idTimestamp(id)).toBeGreaterThanOrEqual(before);
    expect(idTimestamp(id)).toBeLessThanOrEqual(after);
  });
});
