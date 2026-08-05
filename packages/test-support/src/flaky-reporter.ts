import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import type { Reporter, TestModule } from "vitest/node";
import { type FlakyEntry, type FlakyReport, testId } from "./flaky";

export interface FlakyReporterOptions {
  /** Where to write the report, relative to the Vitest root. */
  outFile?: string;
  /** Root the reported file paths are made relative to. Defaults to the process
   * working directory, which is the repository root under Turbo. */
  root?: string;
}

/**
 * Records every test that passed only after a retry, plus every test that failed
 * outright, into a JSON report.
 *
 * Vitest retries keep a merge queue moving when a test is briefly unreliable.
 * Without this reporter that recovery is invisible: the run is green and nobody
 * learns the test is rotting. One report per shard; `flaky merge` combines them.
 */
export class FlakyReporter implements Reporter {
  private readonly outFile: string;
  private readonly root: string;

  constructor(options: FlakyReporterOptions = {}) {
    this.outFile = options.outFile ?? ".flaky/report.json";
    this.root = options.root ?? process.cwd();
  }

  async onTestRunEnd(testModules: readonly TestModule[]): Promise<void> {
    const report: FlakyReport = { flaky: [], failed: [] };

    for (const module of testModules) {
      const file = relative(this.root, module.moduleId);

      for (const test of module.children.allTests()) {
        const diagnostic = test.diagnostic();
        if (!diagnostic) {
          continue;
        }

        const entry: FlakyEntry = {
          id: testId(file, test.fullName),
          file,
          name: test.fullName,
          retries: diagnostic.retryCount,
        };

        if (diagnostic.flaky) {
          report.flaky.push(entry);
        } else if (test.result().state === "failed") {
          report.failed.push(entry);
        }
      }
    }

    const target = resolve(this.root, this.outFile);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
}
