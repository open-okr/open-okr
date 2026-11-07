/**
 * The setups one release has to keep working, in a browser (PLAN.md §5.2).
 *
 * `packages/core/test/hosting-profiles.test.ts` proves what each setup does.
 * This file proves what a person meets, and starts with the setup every
 * self-hosted instance is on: the suite builds one with every switch at its
 * default, so no cloud screen may appear, for an administrator or anybody else.
 */
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe("one organisation with one workspace", () => {
  for (const route of ["/admin/plan", "/operator", "/operator/instance"]) {
    test(`${route} does not exist, even for the administrator`, async ({
      page,
    }) => {
      await signIn(page);
      await goTo(page, route);
      await expect(
        page.getByRole("heading", { level: 1, name: "Not found" }),
      ).toBeVisible({ timeout: 15_000 });
    });
  }
});
