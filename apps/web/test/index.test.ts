import { expect, test } from "vitest";
import { APP_NAME, WORKSPACE_PACKAGES } from "../lib/app-info";

test("entry point resolves with the package graph", () => {
  expect(APP_NAME).toBe("OpenOKR");
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
