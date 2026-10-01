import { expect, test } from "vitest";
import { WORKSPACE_PACKAGES } from "../lib/app-info";

// `APP_NAME` used to be asserted here and was read by nothing else. The name
// a person sees is the instance's, resolved at run time (completeness review
// M-33), and `instance-name.test.ts` holds that.
test("entry point resolves with the package graph", () => {
  expect(WORKSPACE_PACKAGES).toContain("@openokr/core");
  expect(WORKSPACE_PACKAGES).toContain("@openokr/agents");
});

test("the root page is a component", async () => {
  // In the `(home)` route group since P6-G24b, which changes no url: the
  // group exists so `/` can have a layout that renders the shell, and
  // therefore an error boundary that renders inside it.
  const { default: Page } = await import("../app/(home)/page");
  expect(typeof Page).toBe("function");
});
