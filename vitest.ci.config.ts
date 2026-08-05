import { defineConfig } from "vitest/config";
import { FlakyReporter } from "./packages/test-support/src/flaky-reporter";

/**
 * The whole-repository test run, used by CI and by `pnpm test:ci`.
 *
 * Seeing every package as one suite is what makes `--shard` split the work
 * evenly and lets a single flakiness report cover the repository. It is named
 * `vitest.ci.config.ts` rather than `vitest.config.ts` so a per-package
 * `vitest run` does not walk up and find it.
 *
 * `pnpm test` runs Turbo's per-package tasks instead, because those cache and
 * only re-run what changed.
 */

// Each shard writes its own report; `pnpm flaky merge` combines them.
const shardSuffix = process.env.SHARD_INDEX ? `-${process.env.SHARD_INDEX}` : "";

const inGitHubActions = process.env.GITHUB_ACTIONS === "true";

export default defineConfig({
  test: {
    projects: ["packages/*", "apps/*"],
    reporters: [
      "default",
      ...(inGitHubActions ? (["github-actions"] as const) : []),
      new FlakyReporter({ outFile: `.flaky/report${shardSuffix}.json` }),
    ],
  },
});
