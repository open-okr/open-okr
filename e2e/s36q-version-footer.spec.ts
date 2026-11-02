/**
 * The version footer (docs/design/version-footer.md §5).
 *
 * Acceptance criteria:
 *   Given an administrator, when any signed-in screen renders, then the
 *   sidebar footer shows the running version.
 *   Given the check is off, as it is for this suite so that it never calls
 *   GitHub, then no newer release is named.
 *   Given an administrator on Admin, General, then the Update check card says
 *   which version runs and saves the switch.
 *
 * The member who sees no footer is proved in `apps/web/test/version-footer.test.ts`.
 */
import { readFileSync } from "node:fs";
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

const { version } = JSON.parse(
  readFileSync(new URL("../apps/web/package.json", import.meta.url), "utf8"),
) as { version: string };

let context: BrowserContext;
let page: Page;

const checkbox = () =>
  page.getByLabel("Check GitHub once a day for a newer release");

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await signIn(page);
});

test.afterAll(async () => {
  // Left as the environment says, so no later spec reads a stored value.
  await context?.close();
});

test("an administrator sees the running version in the sidebar", async () => {
  await goTo(page, "/");
  const footer = page.getByTestId("version-footer");
  await expect(footer).toContainText(`v${version}`);
  await expect(footer).not.toContainText("available");
});

test("Admin, General offers the switch, off from the environment here", async () => {
  await goTo(page, "/admin/general");
  await expect(
    page.getByRole("heading", { name: "Update check" }),
  ).toBeVisible();
  await expect(page.getByText(`This instance runs v${version}.`)).toBeVisible();
  await expect(checkbox()).not.toBeChecked();
});
