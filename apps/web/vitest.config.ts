import { defineConfig } from "vitest/config";

// Next.js needs "jsx": "preserve" in tsconfig, but Vitest must compile JSX itself.
export default defineConfig({
  oxc: {
    jsx: {
      runtime: "automatic",
      importSource: "react",
    },
  },
});
