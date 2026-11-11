/**
 * The cycles new work may be tied to, and their order (plan 0.8.0 I1, plan
 * 0.8.1 A1). The screens' key result pickers and the copilot read the same
 * function, so this is the one place the order is pinned.
 */
import { describe, expect, it } from "vitest";
import { cyclesOpenForWork } from "../src/cycles/open-for-work.ts";

const cycle = (
  name: string,
  status: string,
  mode: string,
  startsOn: string,
) => ({ name, status, mode, startsOn });

describe("cycles open for work", () => {
  it("puts the running quarter first, then the running year, then cycles being planned", () => {
    // `cycles.list` order: newest first.
    const listed = [
      cycle("Q1 2027", "planning", "quarterly", "2027-01-01"),
      cycle("2027", "planning", "annual", "2027-01-01"),
      cycle("Q4 2026", "active", "quarterly", "2026-10-01"),
      cycle("2026", "active", "annual", "2026-01-01"),
      cycle("Q3 2026", "closed", "quarterly", "2026-07-01"),
      cycle("Q2 2026", "closing", "quarterly", "2026-04-01"),
    ];
    expect(cyclesOpenForWork(listed).map((one) => one.name)).toEqual([
      "Q4 2026",
      "2026",
      "Q1 2027",
      "2027",
    ]);
  });

  it("puts this quarter before next when neither has started yet", () => {
    const listed = [
      cycle("Q1 2027", "planning", "quarterly", "2027-01-01"),
      cycle("Q4 2026", "planning", "quarterly", "2026-10-01"),
    ];
    expect(cyclesOpenForWork(listed).map((one) => one.name)).toEqual([
      "Q4 2026",
      "Q1 2027",
    ]);
  });
});
