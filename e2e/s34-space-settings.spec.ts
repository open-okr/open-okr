/**
 * The space settings card (TECHNICAL-PLAN §4.14's space scope, P6-G18b,
 * GAP-AUDIT B-09).
 *
 * Acceptance criterion:
 *   Given a space that has configured nothing, when every space setting is
 *   read, then each returns its documented default, and a space that turns
 *   team voting off stops offering it.
 *
 * The defaults, the merge, the inheritance and both enforcement points are
 * proved against a real database in `packages/core`. What only a browser
 * proves is that the card is reachable on the space it belongs to, that it
 * offers "the workspace's" rather than a pre-selected copy of the workspace's
 * current value, and that a change made here is read back.
 *
 * **Everything this spec changes, it changes back.** The instance is shared
 * with every spec after it, and a space left on strict coaching or with voting
 * off would fail specs that have nothing to do with this one. Restoring is
 * also the better test: it proves null goes back to meaning "the workspace's"
 * rather than sticking at whatever was chosen.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let spaceUrl: string;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await signIn(page);
});

test.afterAll(async () => {
  await context?.close();
});

test("the card is on the space it belongs to", async () => {
  await goTo(page, "/spaces");
  await page.locator("a[href^='/spaces/']").first().click();
  await page.waitForURL(/\/spaces\/[0-9a-f-]{36}/);
  spaceUrl = new URL(page.url()).pathname;

  await expect(
    page.getByRole("heading", { name: "Space settings" }),
  ).toBeVisible();
});

test("a space that configured nothing shows its documented defaults", async () => {
  // Voting on, and both overrides following the workspace rather than holding
  // a copy of what the workspace happens to say today.
  await expect(page.locator("input[name='teamVoting']")).toBeChecked();
  await expect(page.locator("select[name='coachStrictness']")).toHaveValue("");
  await expect(
    page.locator("select[name='defaultCheckInFrequency']"),
  ).toHaveValue("");
  // And "the workspace's" names the value it inherits, so the choice is
  // readable rather than a blank option.
  //
  // Asserted on the option's text, not its visibility: an option inside a
  // closed select is hidden as far as Playwright is concerned, so
  // `toBeVisible` on one fails against a card that renders perfectly.
  await expect(
    page.locator("select[name='coachStrictness'] option[value='']"),
  ).toHaveText("The workspace's (warn)");
  await expect(
    page.locator("select[name='defaultCheckInFrequency'] option[value='']"),
  ).toHaveText("The workspace's (weekly)");
});

test("a change is written and read back", async () => {
  await page.locator("input[name='teamVoting']").uncheck();
  await page
    .locator("select[name='coachStrictness']")
    .selectOption("strict");
  await page.getByRole("button", { name: "Save space settings" }).click();

  // **Waited for, not assumed.** The first version of this asserted that no
  // error had appeared, which is true before the action has even started, and
  // then navigated: the page rendered the old value while the write was still
  // in flight and the database turned out to hold the new one all along. A
  // save now says it saved, and this waits for that.
  await expect(page.getByTestId("space-settings-saved")).toBeVisible({
    timeout: 15_000,
  });

  await goTo(page, spaceUrl);
  await expect(page.locator("input[name='teamVoting']")).not.toBeChecked();
  await expect(page.locator("select[name='coachStrictness']")).toHaveValue(
    "strict",
  );
});

test("and setting it back to the workspace's means the workspace's again", async () => {
  await page.locator("input[name='teamVoting']").check();
  await page.locator("select[name='coachStrictness']").selectOption("");
  await page.getByRole("button", { name: "Save space settings" }).click();
  await expect(page.getByTestId("space-settings-saved")).toBeVisible({
    timeout: 15_000,
  });

  await goTo(page, spaceUrl);
  await expect(page.locator("input[name='teamVoting']")).toBeChecked();
  // Empty, not "warn": the space stores that it has no opinion, so a
  // workspace that later changes its own strictness carries this space with
  // it.
  await expect(page.locator("select[name='coachStrictness']")).toHaveValue("");
});
