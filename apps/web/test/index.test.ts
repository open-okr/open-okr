import { expect, test } from "vitest";
import { APP_NAME, WORKSPACE_PACKAGES } from "../lib/app-info";

test("entry point resolves with the package graph", () => {
  expect(APP_NAME).toBe("OpenOKR");
  expect(WORKSPACE_PACKAGES).toContain("@openokr/core");
  expect(WORKSPACE_PACKAGES).toContain("@openokr/agents");
});

test("the root page is a component", async () => {
  const { default: Page } = await import("../app/page");
  expect(typeof Page).toBe("function");
});
