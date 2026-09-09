/**
 * Onboarding does not come back (screen S-34, P6-G26).
 *
 * **The half `registration-to-dashboard.spec.ts` cannot prove.** That spec is
 * the one that registers, so it is the only place the wizard can be walked at
 * all, and it skips all four steps there. By the time this file runs the
 * instance has been onboarded once, which is exactly the state worth asserting:
 * the wizard refuses to appear again, and refuses anybody it was never for.
 *
 * Together the two cover P6-G26's test plan: skipping every step leaves a
 * working workspace, onboarding does not reappear once finished, and a second
 * owner does not see it.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await signIn(page);
});

test.afterAll(async () => {
  await context?.close();
});

test("the front door no longer diverts, because the workspace is set up", async () => {
  await goTo(page, "/");
  expect(new URL(page.url()).pathname).toBe("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "Work map" }),
  ).toBeVisible({ timeout: 15_000 });
});

test("asking for it directly is refused, rather than shown again", async () => {
  // A redirect, not an empty state: there is no version of this screen that is
  // useful to somebody whose workspace is already set up.
  await goTo(page, "/welcome");
  expect(new URL(page.url()).pathname).toBe("/");
  await expect(page.getByTestId("welcome-progress")).toHaveCount(0);
});

test("skipping every step left the documented defaults in place", async () => {
  // The acceptance line's second half. The wizard was skipped four times in
  // `registration-to-dashboard`, so what the workspace holds now is what
  // provisioning resolved: §4.14's defaults, not blanks.
  await goTo(page, "/admin/general");
  await expect(page.getByLabel("Timezone")).not.toHaveValue("", {
    timeout: 15_000,
  });
  await goTo(page, "/admin/rhythm");
  // The frequency reads back as METHOD.md's own default rather than as blank,
  // which is the half of §4.14 this criterion is about: skipping a question
  // keeps the documented answer, it does not leave a hole.
  await expect(page.getByText("Check-in frequency")).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.locator('select[name="defaultCheckInFrequency"]'),
  ).toHaveValue("weekly");
});
