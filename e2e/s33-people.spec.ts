/**
 * The people directory and profile (screen S-33, P6-G09).
 *
 * Acceptance criterion:
 *   Given a workspace with a manager chain, when a member opens the directory,
 *   then every member they may see is listed and the chart draws the chain.
 *
 * The e2e instance has only one member (the founding admin), so this spec
 * proves the happy path: the directory lists that member, the profile page
 * renders with editable fields, and the org chart tab shows them as a root
 * node. Multi-member scenarios (suspended visibility, manager cycle
 * prevention) are tested in `packages/core/test/people.test.ts`.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { INSTANCE_ACCOUNT, goTo, signIn } from "./instance-account.ts";

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

test("sign in and reach the directory from the work map", async () => {
  await signIn(page);
  // The work map has a "Who is here" link.
  await expect(page.getByRole("link", { name: "Who is here" })).toBeVisible();
  await page.getByRole("link", { name: "Who is here" }).click();
  await page.waitForURL("/people");
  await expect(page).toHaveURL("/people");
});

test("the directory lists the signed-in member", async () => {
  await goTo(page, "/people");
  // The sidebar names "Ada Lovelace's workspace" in two places, so
  // getByText is ambiguous. The directory entry is a link whose href starts
  // with /people/ and whose text contains the member name.
  const directoryLink = page.locator("a[href^='/people/']", {
    hasText: INSTANCE_ACCOUNT.name,
  });
  await expect(directoryLink).toBeVisible();
});

test("search filters the member list", async () => {
  await goTo(page, "/people");
  const searchInput = page.getByPlaceholder("Search by name or title");
  await expect(searchInput).toBeVisible();
  // Search for a name that does not exist.
  await searchInput.fill("zzz-no-match");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("No members match")).toBeVisible();
  // Clear and find the real member.
  await searchInput.fill(INSTANCE_ACCOUNT.name.split(" ")[0]);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(
    page.locator("a[href^='/people/']", {
      hasText: INSTANCE_ACCOUNT.name,
    }),
  ).toBeVisible();
});

test("the org chart tab renders at least one node", async () => {
  await goTo(page, "/people?view=chart");
  // The signed-in member has no manager, so they appear as a root node.
  // Scoped to links inside the chart (href starts with /people/).
  await expect(
    page.locator("a[href^='/people/']", {
      hasText: INSTANCE_ACCOUNT.name,
    }),
  ).toBeVisible();
});

test("the profile page loads for the signed-in member", async () => {
  await goTo(page, "/people");
  await page.getByRole("link", { name: INSTANCE_ACCOUNT.name }).first().click();
  await page.waitForURL(/\/people\//);
  // The profile shows the member's name and has a self-edit section.
  await expect(
    page.getByRole("heading", { name: INSTANCE_ACCOUNT.name }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Edit your profile" }),
  ).toBeVisible();
});

test("the profile has a timezone field", async () => {
  // Already on the profile page from the previous test.
  const timezone = page.locator("input[name='timezone']");
  await expect(timezone).toBeVisible();
});
