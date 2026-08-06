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
