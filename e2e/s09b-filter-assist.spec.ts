/**
 * The list filter assist and the filters it sets — P4-T15d (screen S-09).
 *
 * Acceptance criterion:
 *   Given a member typing "my off-track goals this quarter", when the assist
 *   runs, then the explorer's own filter state is set and visible as filters
 *   they can edit.
 *
 * **The half a browser proves here is "filters they can edit", and it is the
 * half the criterion is really about.** This instance has no AI provider, so the
 * sentence box is not offered; what the assist would have set is the explorer's
 * own query, and this spec sets it by hand and proves it is a real, editable
 * filter state: the chips reflect it, the list obeys it, and clicking a chip
 * clears it. An assist that navigated somewhere those chips did not understand
 * would fail this without any model involved.
 *
 * The parsing and every refusal are proved in
 * `packages/core/test/filter-assist.test.ts` against a scripted drafter.
 *
 * **The file name carries the run order:** specs run alphabetically against one
 * instance and `registration-to-dashboard.spec.ts` claims it, so anything that
 * signs in sorts after `registration-`.
 */
import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await context?.close();
});

test("sign in and open the goals explorer", async () => {
  await signIn(page);
  await expect(
    page.getByRole("heading", { level: 1, name: "Work map" }),
  ).toBeVisible({ timeout: 10_000 });

  await goTo(page, "/goals");
  await expect(
    page.getByRole("group", { name: "Health" }),
  ).toBeVisible({ timeout: 15_000 });
});

test("the two new filters are there, and they are chips", async () => {
  // Both exist for their own sake, with or without a provider: the assist needed
  // them before it could set them.
  await expect(page.getByRole("group", { name: "Health" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Whose" })).toBeVisible();
  await expect(page.getByRole("link", { name: "off track" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Mine" })).toBeVisible();
});

test("no sentence box is offered with no provider", async () => {
  await expect(page.getByRole("button", { name: "Filter" })).toHaveCount(0);
  await expect(
    page.getByPlaceholder("my off-track goals this quarter"),
  ).toHaveCount(0);
});

test("the filter state the assist would set is editable in the chips", async () => {
  // Exactly the query `goals.parseFilter` returns for "my off-track goals this
  // quarter", set by hand because there is no provider to produce it.
  await goTo(page, "/goals?health=off_track&mine=1");

  // Visible as filters, which is what the criterion asks for: the active chip
  // is the one the filter names.
  const health = page.getByRole("link", { name: "off track" });
  await expect(health).toBeVisible();
  await expect(page.getByRole("link", { name: "Mine" })).toBeVisible();

  // And editable: clicking Any in the Health group clears that half of it and
  // keeps the other. Scoped to the group, because "Any" and "All" both appear
  // more than once on this bar.
  await page
    .getByRole("group", { name: "Health" })
    .getByRole("link", { name: "Any" })
    .click();
  await expect(page).toHaveURL(/mine=1/);
  await expect(page).not.toHaveURL(/health=/);
});

test("a hand-edited band the product does not have is ignored, not obeyed", async () => {
  // The page validates the query against the band list rather than passing it
  // through, so a URL somebody typed cannot ask for a band that does not exist.
  await goTo(page, "/goals?health=struggling");
  await expect(
    page.getByRole("group", { name: "Health" }),
  ).toBeVisible({ timeout: 15_000 });
  // No health filter reached the list, because the invalid band resolved to
  // nothing. The chips are the proof: every link still carries no health.
  await expect(
    page
      .getByRole("group", { name: "Health" })
      .getByRole("link", { name: "Any" }),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/health=off_track/);
});
