import { describe, expect, it } from "vitest";
import { sameField } from "../src/operations/unchanged.ts";

/**
 * What "unchanged" means for a field (optimistic-concurrency.md V1 and V2,
 * plan 0.7.0 D3): numbers by value, blank text as nothing, everything else
 * as it is.
 */
describe("the same field", () => {
  it("compares numbers by value, whatever form they were read in", () => {
    expect(sameField(1, 1)).toBe(true);
    expect(sameField("1.50", 1.5)).toBe(true);
    expect(sameField(2, 3)).toBe(false);
  });

  it("reads blank text as nothing", () => {
    expect(sameField("", null)).toBe(true);
    expect(sameField("   ", null)).toBe(true);
    expect(sameField("Ship it", null)).toBe(false);
  });

  it("compares text and booleans as they are", () => {
    expect(sameField("Ship it", "Ship it")).toBe(true);
    expect(sameField("Ship it", "ship it")).toBe(false);
    expect(sameField(true, true)).toBe(true);
    expect(sameField(true, false)).toBe(false);
  });

  it("compares dates as the text they are stored as", () => {
    expect(sameField("2026-11-30", "2026-11-30")).toBe(true);
    expect(sameField("2026-11-30", "2026-12-01")).toBe(false);
  });
});
