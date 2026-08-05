import { expect, test } from "vitest";

// Retries run in the same worker process, so a module-level counter is enough to
// make this test fail once and then pass. It exists to prove the flakiness report
// catches a passed-on-retry test. Do not "fix" it.
let attempts = 0;

test("passes on the second attempt", () => {
  attempts += 1;
  expect(attempts).toBeGreaterThan(1);
});

test("is stable", () => {
  expect(true).toBe(true);
});
