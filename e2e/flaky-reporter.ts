import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import type { FlakyEntry, FlakyReport } from "@openokr/test-support/flaky";
import { testId } from "@openokr/test-support/flaky";
import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

/**
 * The end-to-end suite's flakiness report (P8-T15).
 *
 * **The unit suites have had one since P7-T09 and the browser suite never
 * did.** `packages/test-support/src/flaky-reporter.ts` records every Vitest
 * test that passed only after a retry, and `pnpm flaky merge` turns those into
 * the summary on the run. Playwright retries once in continuous integration
 * and reported nothing, so a spec that failed and recovered was indistinguishable
 * from one that passed first time: green run, no record, nobody learns the
 * spec is rotting.
 *
 * That gap is the reason P8-T15 exists as a task. Two specs were failing about
 * one run in four and it took somebody running the suite eleven times in a day
 * to notice, because every one of those recoveries was invisible.
 *
 * Same shape as the Vitest reporter's output and the same `testId`, so
 * `flaky merge` reads both without knowing which produced which and one
 * quarantine list covers the whole repository.
 */

export interface PlaywrightFlakyOptions {
  /** Where to write the report, relative to the repository root. */
  outFile?: string;
}

export default class PlaywrightFlakyReporter implements Reporter {
  private readonly outFile: string;
  private readonly root = process.cwd();
  private readonly report: FlakyReport = { flaky: [], failed: [] };

  constructor(options: PlaywrightFlakyOptions = {}) {
    // `report-` on purpose: `pnpm flaky merge .flaky/report-*.json` in
    // ci.yml already globs that shape for the unit shards, and a browser
    // report named anything else would be uploaded, downloaded and silently
    // not merged.
    this.outFile = options.outFile ?? ".flaky/report-e2e.json";
  }

  /**
   * Recorded on the last attempt only.
   *
   * Playwright calls this once per attempt, so a spec that failed and then
   * passed arrives twice. `test.outcome()` is the verdict across every attempt
   * and is what decides which list the entry belongs in; reading
   * `result.status` instead would file the first attempt as a failure and the
   * second as a pass.
   */
  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.retry < test.retries) {
      // Another attempt is coming. Wait for the verdict.
      return;
    }

    const outcome = test.outcome();
    if (outcome !== "flaky" && outcome !== "unexpected") {
      return;
    }

    const entry: FlakyEntry = {
      id: testId(relative(this.root, test.location.file), test.titlePath().join(" > ")),
      file: relative(this.root, test.location.file),
      name: test.titlePath().join(" > "),
      retries: result.retry,
    };

    if (outcome === "flaky") {
      this.report.flaky.push(entry);
    } else {
      this.report.failed.push(entry);
    }
  }

  /**
   * Written even when the run is clean.
   *
   * An empty report is the record that the suite ran and nothing recovered,
   * which is a different statement from no file at all. `flaky merge` treats a
   * missing file as an empty report, so writing it is what lets a run with no
   * report be read as a run that did not happen.
   */
  async onEnd(_result: FullResult): Promise<void> {
    const target = resolve(this.root, this.outFile);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(
      target,
      `${JSON.stringify(this.report, null, 2)}\n`,
      "utf8",
    );
  }
}
