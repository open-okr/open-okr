import { defineConfig } from "vitest/config";
import { FlakyReporter } from "../../src/flaky-reporter";

// A self-contained run used by the reporter suite. `root` is pinned to this
// directory so the report lands here no matter where the run was started from.
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ["**/*.fixture.test.ts"],
    retry: 2,
    reporters: [
      "default",
      new FlakyReporter({
        outFile: ".flaky/report.json",
        root: import.meta.dirname,
      }),
    ],
  },
});
