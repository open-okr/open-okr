import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { FlakyReport } from "../src/flaky";

const run = promisify(execFile);
const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = join(packageDir, "fixtures", "flaky");
const reportPath = join(fixtureDir, ".flaky", "report.json");

// Runs a real Vitest process over a test that fails once then passes, which is the
// only honest way to prove the reporter sees a retry.
beforeAll(async () => {
  await rm(join(fixtureDir, ".flaky"), { recursive: true, force: true });

  // Vitest sets VITEST_* variables that a nested run must not inherit, or the
  // child tries to rejoin this run instead of starting its own.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("VITEST")),
  );

  await run(
    "pnpm",
    ["exec", "vitest", "run", "--config", join(fixtureDir, "vitest.config.ts")],
    {
      cwd: packageDir,
      env: { ...env, CI: "" },
    },
  );
}, 120_000);

afterAll(async () => {
  await rm(join(fixtureDir, ".flaky"), { recursive: true, force: true });
});

test("a deliberately flaky test appears in the report instead of passing silently", async () => {
  const report = JSON.parse(await readFile(reportPath, "utf8")) as FlakyReport;

  expect(report.flaky).toHaveLength(1);
  expect(report.flaky[0]?.name).toContain("passes on the second attempt");
  expect(report.flaky[0]?.retries).toBeGreaterThan(0);
});

test("the stable test in the same run is not reported as flaky", async () => {
  const report = JSON.parse(await readFile(reportPath, "utf8")) as FlakyReport;

  expect(report.flaky.map((entry) => entry.name).join()).not.toContain(
    "is stable",
  );
  expect(report.failed).toEqual([]);
});
