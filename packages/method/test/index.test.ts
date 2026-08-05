import { expect, test } from "vitest";
import { PACKAGE_NAME } from "../src/index";

test("entry point resolves", () => {
  expect(PACKAGE_NAME).toBe("@openokr/method");
});
