/**
 * The flaky-test policy, as data and pure functions.
 *
 * The rule this encodes: a test that only passes on a retry has told us
 * something, and CI must not swallow it. Retries keep the build moving;
 * the report keeps the build honest.
 *
 * The CLI in `bin/flaky.ts` and the Vitest reporter both build on this file.
 */

export interface FlakyEntry {
  /** `file::name`, stable across shards and runs. */
  id: string;
  file: string;
  name: string;
  /** How many retries the test needed. Zero means it failed every attempt. */
  retries: number;
}

export interface FlakyReport {
  /** Tests that failed at least once and then passed. */
  flaky: FlakyEntry[];
  /** Tests that failed every attempt. */
  failed: FlakyEntry[];
}

export interface QuarantinedTest {
  id: string;
  reason: string;
  /** ISO date the test entered quarantine, so stale entries are visible. */
  addedAt: string;
}

export interface QuarantineList {
  tests: QuarantinedTest[];
}

export const EMPTY_REPORT: FlakyReport = { flaky: [], failed: [] };

export function testId(file: string, name: string): string {
  return `${file}::${name}`;
}

/**
 * Merges the per-shard reports CI produces into one. Sharding means the same
 * test can appear in more than one report; the worst result wins.
 */
export function mergeReports(reports: readonly FlakyReport[]): FlakyReport {
  return {
    flaky: mergeEntries(reports.flatMap((report) => report.flaky)),
    failed: mergeEntries(reports.flatMap((report) => report.failed)),
  };
}

function mergeEntries(entries: readonly FlakyEntry[]): FlakyEntry[] {
  const worst = new Map<string, FlakyEntry>();

  for (const entry of entries) {
    const seen = worst.get(entry.id);
    if (!seen || entry.retries > seen.retries) {
      worst.set(entry.id, entry);
    }
  }

  return [...worst.values()];
}

export function isQuarantined(id: string, list: QuarantineList): boolean {
  return list.tests.some((test) => test.id === id);
}

/**
 * Adds newly flaky tests to the quarantine list. Existing entries keep their
 * original reason and date, so quarantine age stays truthful.
 */
export function applyAutoQuarantine(
  report: FlakyReport,
  list: QuarantineList,
  today: string,
): QuarantineList {
  const additions = report.flaky
    .filter((entry) => !isQuarantined(entry.id, list))
    .map((entry) => ({
      id: entry.id,
      reason: `Passed only after ${entry.retries} retr${entry.retries === 1 ? "y" : "ies"} in CI. Quarantined automatically.`,
      addedAt: today,
    }));

  return { tests: [...list.tests, ...additions] };
}

/** Renders the report for the CI job summary, in Markdown. */
export function summariseReport(
  report: FlakyReport,
  list: QuarantineList,
): string {
  const lines: string[] = ["## Test flakiness", ""];

  if (report.flaky.length === 0) {
    lines.push("No flaky tests in this run.");
  } else {
    lines.push(`${report.flaky.length} test(s) **passed on retry**:`, "");
    lines.push("| Test | Retries | Quarantined |", "|---|---|---|");
    for (const entry of report.flaky) {
      lines.push(
        `| \`${entry.id}\` | ${entry.retries} | ${isQuarantined(entry.id, list) ? "yes" : "no"} |`,
      );
    }
  }

  const unquarantinedFailures = report.failed.filter(
    (entry) => !isQuarantined(entry.id, list),
  );
  if (unquarantinedFailures.length > 0) {
    lines.push(
      "",
      `${unquarantinedFailures.length} test(s) failed outright:`,
      "",
    );
    for (const entry of unquarantinedFailures) {
      lines.push(`- \`${entry.id}\``);
    }
  }

  if (list.tests.length > 0) {
    lines.push("", "### Quarantined tests", "");
    lines.push("These do not fail the build. Fix or delete them.", "");
    lines.push("| Test | Reason | Since |", "|---|---|---|");
    for (const test of list.tests) {
      lines.push(`| \`${test.id}\` | ${test.reason} | ${test.addedAt} |`);
    }
  }

  return lines.join("\n");
}

/**
 * The gate. A run fails only on tests that failed outright and are not
 * quarantined. Flakiness is reported, never fatal.
 */
export function shouldFailBuild(
  report: FlakyReport,
  list: QuarantineList,
): boolean {
  return report.failed.some((entry) => !isQuarantined(entry.id, list));
}
