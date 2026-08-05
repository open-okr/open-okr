import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The fixtures directory holds a deliberately flaky test that the reporter
    // suite runs in its own Vitest process. It must not run here.
    exclude: ["**/node_modules/**", "fixtures/**"],
    testTimeout: 120_000,
  },
});
