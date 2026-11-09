import { describe, expect, it } from "vitest";
import { failuresAfter, holdSeconds } from "../src/auth/lockout.ts";

/**
 * The hold curve (docs/design/account-lockout.md D3, plan 0.7.0 P10): one
 * minute times two to the power of how far past the threshold, capped at
 * fifteen minutes; a run of failures forgotten after a quiet day.
 */

describe("the hold curve", () => {
  it("holds nothing below the threshold", () => {
    expect(holdSeconds(4, 5)).toBe(0);
    expect(holdSeconds(19, 20)).toBe(0);
  });

  it("starts at one minute when the count reaches the threshold", () => {
    expect(holdSeconds(5, 5)).toBe(60);
    expect(holdSeconds(20, 20)).toBe(60);
  });

  it("doubles with each failure past it", () => {
    expect(holdSeconds(6, 5)).toBe(120);
    expect(holdSeconds(7, 5)).toBe(240);
    expect(holdSeconds(8, 5)).toBe(480);
  });

  it("is capped at fifteen minutes, however long the run", () => {
    expect(holdSeconds(9, 5)).toBe(900);
    expect(holdSeconds(10_000, 5)).toBe(900);
  });
});

describe("counting failures in a row", () => {
  const now = new Date("2026-11-09T12:00:00Z");
  const hoursAgo = (hours: number) =>
    new Date(now.getTime() - hours * 60 * 60 * 1000);

  it("starts at one with no earlier failure", () => {
    expect(failuresAfter({ failures: 0, lastFailureAt: null }, now)).toBe(1);
  });

  it("adds one within a day of the last failure", () => {
    expect(
      failuresAfter({ failures: 3, lastFailureAt: hoursAgo(1) }, now),
    ).toBe(4);
    expect(
      failuresAfter({ failures: 3, lastFailureAt: hoursAgo(23.9) }, now),
    ).toBe(4);
  });

  it("starts again at one after a quiet day", () => {
    expect(
      failuresAfter({ failures: 30, lastFailureAt: hoursAgo(24.1) }, now),
    ).toBe(1);
  });
});
