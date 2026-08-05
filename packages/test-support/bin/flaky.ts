#!/usr/bin/env node
/**
 * The flakiness command line CI drives.
 *
 *   flaky merge <report...>   Merge shard reports, write the summary, set the exit code
 *   flaky quarantine          Add every flaky test in the merged report to the list
 *
 * `merge` exits non-zero only for tests that failed outright and are not
 * quarantined. Flakiness is always reported and never fatal, which is the whole
 * point: the build keeps moving and the rot stays visible.
 */
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  applyAutoQuarantine,
  type FlakyReport,
  mergeReports,
  type QuarantineList,
  shouldFailBuild,
  summariseReport,
} from "../src/flaky.ts";

const QUARANTINE_PATH = resolve(process.cwd(), "test-quarantine.json");
const MERGED_PATH = resolve(process.cwd(), ".flaky/merged.json");

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function loadQuarantine(): Promise<QuarantineList> {
  return readJson<QuarantineList>(QUARANTINE_PATH, { tests: [] });
}

async function merge(paths: string[]): Promise<number> {
  const reports = await Promise.all(
    paths.map((path) =>
      readJson<FlakyReport>(resolve(process.cwd(), path), {
        flaky: [],
        failed: [],
      }),
    ),
  );

  const merged = mergeReports(reports);
  const quarantine = await loadQuarantine();
  const summary = summariseReport(merged, quarantine);

  await writeJson(MERGED_PATH, merged);
  process.stdout.write(`${summary}\n`);

  // GitHub renders this on the run page, so a flaky test is visible without
  // opening logs.
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`, "utf8");
  }

  if (shouldFailBuild(merged, quarantine)) {
    process.stderr.write("\nTests failed outside quarantine.\n");
    return 1;
  }

  return 0;
}

async function quarantine(): Promise<number> {
  const merged = await readJson<FlakyReport>(MERGED_PATH, {
    flaky: [],
    failed: [],
  });
  const before = await loadQuarantine();
  const today = new Date().toISOString().slice(0, 10);
  const after = applyAutoQuarantine(merged, before, today);

  const added = after.tests.length - before.tests.length;
  if (added === 0) {
    process.stdout.write("No new tests to quarantine.\n");
    return 0;
  }

  await writeJson(QUARANTINE_PATH, after);
  process.stdout.write(
    `Quarantined ${added} test(s). Commit test-quarantine.json.\n`,
  );
  return 0;
}

const [command, ...rest] = process.argv.slice(2);

const exitCode = await (async () => {
  switch (command) {
    case "merge":
      return merge(rest.length > 0 ? rest : [".flaky/report.json"]);
    case "quarantine":
      return quarantine();
    default:
      process.stderr.write("Usage: flaky <merge|quarantine> [report...]\n");
      return 2;
  }
})();

process.exit(exitCode);
