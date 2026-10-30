import { CATALOGUES, translate } from "@openokr/ui";
import { describe, expect, it } from "vitest";
import { keyResultValueText } from "../app/goal-nodes.ts";

/**
 * The value line a key result row prints on Home, the OKRs list and a space
 * page (OKRGoal UX review, findings T2 and T3).
 *
 * One template, "{current} of {target}", read backwards on a key result that
 * reduces ("101 of 95 $") and printed the top of a maintain band as if it were
 * the target ("99.95 of 100 %" for "at or above 99.9%").
 */

const t = (key: string, values?: Readonly<Record<string, string | number>>) =>
  translate(CATALOGUES.en, key, values);

const base = {
  kind: "metric" as const,
  direction: "increase" as const,
  baselineValue: 0,
  targetValue: 100 as number | null,
  currentValue: 0,
  unit: null as string | null,
};

describe("a key result's value line", () => {
  it("reads an increase as current of target", () => {
    expect(
      keyResultValueText(t, {
        ...base,
        baselineValue: 158,
        targetValue: 200,
        currentValue: 172,
        unit: "seats",
      }),
    ).toBe("172 of 200 seats");
  });

  it("reads a reduce as where it is now and where it is going", () => {
    expect(
      keyResultValueText(t, {
        ...base,
        direction: "reduce",
        baselineValue: 110,
        targetValue: 95,
        currentValue: 101,
        unit: "$",
      }),
    ).toBe("101 now, target 95 $");
    expect(
      keyResultValueText(t, {
        ...base,
        direction: "reduce",
        baselineValue: 45,
        targetValue: 35,
        currentValue: 38,
      }),
    ).toBe("38 now, target 35");
  });

  it("reads a maintain key result as its band, lower end first", () => {
    expect(
      keyResultValueText(t, {
        ...base,
        kind: "maintain",
        direction: "maintain",
        baselineValue: 99.9,
        targetValue: 100,
        currentValue: 99.95,
        unit: "%",
      }),
    ).toBe("99.95 now, hold 99.9 to 100 %");
    // Endpoints stored high to low still print low to high.
    expect(
      keyResultValueText(t, {
        ...base,
        direction: "maintain",
        baselineValue: 100,
        targetValue: 92,
        currentValue: 93,
      }),
    ).toBe("93 now, hold 92 to 100");
  });

  it("says when there is no target yet", () => {
    expect(
      keyResultValueText(t, { ...base, targetValue: null, currentValue: 4 }),
    ).toBe("4, no target yet");
  });
});
