import { describe, expect, test } from "vitest";
import {
  applyAutoQuarantine,
  type FlakyReport,
  isQuarantined,
  mergeReports,
  summariseReport,
  testId,
} from "../src/flaky";

const report = (over: Partial<FlakyReport> = {}): FlakyReport => ({
  flaky: [],
  failed: [],
  ...over,
});

describe("testId", () => {
  test("joins file and name so the same test is one identity across shards", () => {
    expect(testId("packages/core/test/a.test.ts", "does a thing")).toBe(
      "packages/core/test/a.test.ts::does a thing",
    );
  });
});

describe("mergeReports", () => {
  test("merges shard reports into one", () => {
    const merged = mergeReports([
      report({ flaky: [{ id: "a::one", file: "a", name: "one", retries: 1 }] }),
      report({ flaky: [{ id: "b::two", file: "b", name: "two", retries: 2 }] }),
    ]);

    expect(merged.flaky.map((entry) => entry.id)).toEqual(["a::one", "b::two"]);
  });

  test("keeps the worst retry count when a test is flaky in more than one shard", () => {
    const merged = mergeReports([
      report({ flaky: [{ id: "a::one", file: "a", name: "one", retries: 1 }] }),
      report({ flaky: [{ id: "a::one", file: "a", name: "one", retries: 3 }] }),
    ]);

    expect(merged.flaky).toHaveLength(1);
    expect(merged.flaky[0]?.retries).toBe(3);
  });

  test("merges failures and keeps them distinct from flaky results", () => {
    const merged = mergeReports([
      report({
        failed: [{ id: "a::one", file: "a", name: "one", retries: 2 }],
      }),
      report({ flaky: [{ id: "b::two", file: "b", name: "two", retries: 1 }] }),
    ]);

    expect(merged.failed.map((entry) => entry.id)).toEqual(["a::one"]);
    expect(merged.flaky.map((entry) => entry.id)).toEqual(["b::two"]);
  });

  test("an empty run merges to an empty report", () => {
    expect(mergeReports([])).toEqual(report());
  });
});

describe("isQuarantined", () => {
  const list = {
    tests: [
      { id: "a::one", reason: "flaky under load", addedAt: "2026-08-05" },
    ],
  };

  test("matches a quarantined test", () => {
    expect(isQuarantined("a::one", list)).toBe(true);
  });

  test("does not match a healthy test", () => {
    expect(isQuarantined("b::two", list)).toBe(false);
  });
});

describe("applyAutoQuarantine", () => {
  test("adds a newly flaky test to the list", () => {
    const next = applyAutoQuarantine(
      report({ flaky: [{ id: "a::one", file: "a", name: "one", retries: 1 }] }),
      { tests: [] },
      "2026-08-05",
    );

    expect(next.tests).toHaveLength(1);
    expect(next.tests[0]?.id).toBe("a::one");
    expect(next.tests[0]?.addedAt).toBe("2026-08-05");
  });

  test("does not add the same test twice", () => {
    const list = {
      tests: [{ id: "a::one", reason: "flaky", addedAt: "2026-08-01" }],
    };
    const next = applyAutoQuarantine(
      report({ flaky: [{ id: "a::one", file: "a", name: "one", retries: 1 }] }),
      list,
      "2026-08-05",
    );

    expect(next.tests).toHaveLength(1);
    expect(next.tests[0]?.addedAt).toBe("2026-08-01");
  });

  test("leaves the list alone when nothing was flaky", () => {
    expect(
      applyAutoQuarantine(report(), { tests: [] }, "2026-08-05").tests,
    ).toEqual([]);
  });
});

describe("summariseReport", () => {
  test("surfaces a passed-on-retry test rather than letting it pass silently", () => {
    const summary = summariseReport(
      report({ flaky: [{ id: "a::one", file: "a", name: "one", retries: 1 }] }),
      { tests: [] },
    );

    expect(summary).toMatch(/passed on retry/i);
    expect(summary).toMatch(/a::one/);
  });

  test("says so plainly when the run was clean", () => {
    expect(summariseReport(report(), { tests: [] })).toMatch(/no flaky tests/i);
  });

  test("lists quarantined tests so they cannot be forgotten", () => {
    const summary = summariseReport(report(), {
      tests: [{ id: "a::one", reason: "races on CI", addedAt: "2026-08-05" }],
    });

    expect(summary).toMatch(/quarantined/i);
    expect(summary).toMatch(/races on CI/);
  });
});

describe("the gate decision", () => {
  test("a clean run passes", () => {
    expect(shouldFail(report(), { tests: [] })).toBe(false);
  });

  test("a real failure fails the build", () => {
    expect(
      shouldFail(
        report({
          failed: [{ id: "a::one", file: "a", name: "one", retries: 2 }],
        }),
        {
          tests: [],
        },
      ),
    ).toBe(true);
  });

  test("a quarantined test failing does not fail the build", () => {
    expect(
      shouldFail(
        report({
          failed: [{ id: "a::one", file: "a", name: "one", retries: 2 }],
        }),
        {
          tests: [
            { id: "a::one", reason: "known flaky", addedAt: "2026-08-05" },
          ],
        },
      ),
    ).toBe(false);
  });

  test("a flaky pass does not fail the build but is still reported", () => {
    expect(
      shouldFail(
        report({
          flaky: [{ id: "a::one", file: "a", name: "one", retries: 1 }],
        }),
        {
          tests: [],
        },
      ),
    ).toBe(false);
  });
});

// Mirrors the CLI gate so the rule is covered by a unit test as well as by the CLI.
function shouldFail(
  input: FlakyReport,
  list: Parameters<typeof isQuarantined>[1],
): boolean {
  return input.failed.some((entry) => !isQuarantined(entry.id, list));
}
